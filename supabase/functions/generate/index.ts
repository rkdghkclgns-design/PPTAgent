// Supabase Edge Function: generate
//
// Takes a prompt, a slide count (1..100), optional image flag, language, and
// optional attachments (text excerpts + inline image data URLs) and returns a
// deck as JSON. Each slide has { title, bullets[], notes, imagePrompt,
// imageB64 | null }. The browser then hands the JSON to pptxgenjs.
//
// Graceful fallback: if GOOGLE_API_KEY is not configured we return a
// deterministic sample deck so the UI never hits a hard 500. The frontend
// surfaces a small banner letting the operator know the API key needs to be
// registered to get real output.

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const GOOGLE_API_KEY = Deno.env.get("GOOGLE_API_KEY") ?? "";
const GENAI_BASE = "https://generativelanguage.googleapis.com/v1beta";

if (!GOOGLE_API_KEY) console.warn("generate: GOOGLE_API_KEY not set - sample mode active");

const ALLOWED_ORIGINS = new Set(
  (Deno.env.get("ALLOWED_ORIGINS") ?? "https://rkdghkclgns-design.github.io,http://localhost:3000")
    .split(",").map((s) => s.trim()).filter(Boolean),
);

function cors(origin: string | null): HeadersInit {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "null";
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "3600",
  };
}

function ok(body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...cors(origin), "content-type": "application/json" },
  });
}

function bad(origin: string | null, status: number, message: string, details?: unknown): Response {
  if (details) console.warn("generate error", { status, message, details });
  return new Response(JSON.stringify({ error: { status, message } }), {
    status,
    headers: { ...cors(origin), "content-type": "application/json" },
  });
}

interface Slide {
  title: string;
  bullets: string[];
  notes?: string;
  imagePrompt?: string;
  imageB64?: string | null;
}

interface Attachment {
  /** File display name (for prompt context). */
  name: string;
  /** MIME type, used to route between text excerpt vs inline image. */
  mime_type: string;
  /** Plain-text content for text/* attachments. */
  text?: string;
  /** Base64 (no data: prefix) for image/* attachments. */
  image_b64?: string;
}

// ---------------------------------------------------------------------------
// Sample / fallback deck
// ---------------------------------------------------------------------------

const SAMPLE_COVERS = [
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
];

function sampleSlides(prompt: string, slideCount: number, includeImages: boolean, language: string): Slide[] {
  const ko = language === "ko";
  const titles = ko
    ? [
      "개요 - " + prompt.slice(0, 20),
      "문제 정의",
      "시장 현황",
      "핵심 제안",
      "경쟁 구도",
      "실행 로드맵",
      "기대 효과",
      "리스크와 대응",
      "재무 전망",
      "요약과 다음 단계",
    ]
    : [
      "Overview - " + prompt.slice(0, 20),
      "Problem Statement",
      "Market Landscape",
      "Core Proposition",
      "Competitive Setting",
      "Execution Roadmap",
      "Expected Impact",
      "Risks and Mitigation",
      "Financial Outlook",
      "Summary and Next Steps",
    ];
  return Array.from({ length: slideCount }, (_, i) => {
    const title = titles[i % titles.length] + (i >= titles.length ? ` (${i + 1})` : "");
    const bullets = ko
      ? [
        "샘플 응답입니다. GOOGLE_API_KEY를 Supabase Secret에 등록하면 실제 AI 생성이 시작됩니다.",
        "현재 슬라이드 수량: " + slideCount + "장",
        "참고 이미지 포함: " + (includeImages ? "예" : "아니오"),
      ]
      : [
        "This is a sample deck. Register GOOGLE_API_KEY in Supabase Secrets to enable real AI output.",
        "Current slide count: " + slideCount,
        "Reference images: " + (includeImages ? "enabled" : "disabled"),
      ];
    return {
      title,
      bullets,
      notes: ko
        ? "이 슬라이드는 키 없이도 동작함을 보여주는 샘플입니다."
        : "This slide is a sample shown when no API key is configured.",
      imagePrompt: ko ? "미니멀한 추상 일러스트" : "minimal abstract illustration",
      imageB64: includeImages ? SAMPLE_COVERS[0] : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Gemini outline (structured JSON)
// ---------------------------------------------------------------------------

function buildUserParts(prompt: string, attachments: Attachment[]): any[] {
  const parts: any[] = [];
  // Inline images go first so Gemini sees them as visual context before reading text.
  for (const a of attachments) {
    if (a.mime_type?.startsWith("image/") && a.image_b64) {
      parts.push({ inlineData: { mimeType: a.mime_type, data: a.image_b64 } });
    }
  }
  // Collate text excerpts, capped so we never blow the context window.
  const textBlobs: string[] = [];
  for (const a of attachments) {
    if (a.text) {
      const snippet = a.text.slice(0, 8000);
      textBlobs.push(`### Attachment: ${a.name}\n${snippet}`);
    }
  }
  let body = prompt;
  if (textBlobs.length > 0) {
    body += "\n\n---\nReference material from attachments:\n\n" + textBlobs.join("\n\n");
  }
  parts.push({ text: body });
  return parts;
}

async function callGeminiForOutline(
  prompt: string,
  slideCount: number,
  language: string,
  model: string,
  attachments: Attachment[],
): Promise<Slide[]> {
  const sys = [
    "You are a senior presentation designer.",
    `Write an outline for a ${slideCount}-slide deck.`,
    language === "ko"
      ? "Write all title, bullets, notes and imagePrompt fields in Korean."
      : "Write concisely in the requested language.",
    "Each slide MUST have: title (<=60 chars), 3-5 bullets (each <=90 chars), notes (1-2 sentence speaker notes), and imagePrompt (a vivid English description of a single illustrative image for that slide, no text in the image).",
    "If the user supplied attachments, use them as source material - mine their facts, data and examples to fill the slides.",
    "Return ONLY valid JSON with the shape {\"slides\": [{...}]}.",
  ].join(" ");

  const maxOutputTokens = Math.min(32000, 1500 + slideCount * 380);

  const payload = {
    contents: [{ role: "user", parts: buildUserParts(prompt, attachments) }],
    systemInstruction: { parts: [{ text: sys }] },
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.6,
      maxOutputTokens,
    },
  };

  const res = await fetch(
    `${GENAI_BASE}/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": GOOGLE_API_KEY },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { throw new Error(`gemini returned non-json: ${text.slice(0, 200)}`); }
  const slides = (parsed.slides ?? parsed) as Slide[];
  if (!Array.isArray(slides) || slides.length === 0) throw new Error("gemini returned empty slides");
  return slides.slice(0, slideCount).map((s) => ({
    title: String(s.title ?? "").slice(0, 120),
    bullets: Array.isArray(s.bullets) ? s.bullets.map(String).slice(0, 6) : [],
    notes: s.notes ? String(s.notes).slice(0, 400) : undefined,
    imagePrompt: s.imagePrompt ? String(s.imagePrompt).slice(0, 400) : undefined,
  }));
}

// ---------------------------------------------------------------------------
// Imagen
// ---------------------------------------------------------------------------

async function callImagen(prompt: string, model: string): Promise<string | null> {
  const body = {
    instances: [{ prompt }],
    parameters: { sampleCount: 1, aspectRatio: "16:9", safetyFilterLevel: "block_few", personGeneration: "allow_adult" },
  };
  const res = await fetch(`${GENAI_BASE}/models/${encodeURIComponent(model)}:predict`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": GOOGLE_API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) { console.warn(`imagen ${res.status}: ${(await res.text()).slice(0, 200)}`); return null; }
  const data = await res.json();
  const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
  return typeof b64 === "string" ? b64 : null;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
  if (req.method !== "POST") return bad(origin, 405, "method not allowed");

  let body: any;
  try { body = await req.json(); } catch { return bad(origin, 400, "invalid JSON body"); }

  const prompt = String(body.prompt ?? "").trim();
  const slideCount = Math.max(1, Math.min(100, Number(body.slide_count ?? 8)));
  const includeImages = body.include_images !== false;
  const language = String(body.language ?? "ko");
  const chatModel = String(body.chat_model ?? "gemini-2.0-flash");
  const imageModel = String(body.image_model ?? "imagen-3.0-generate-002");
  const attachments: Attachment[] = Array.isArray(body.attachments) ? body.attachments.slice(0, 8) : [];
  if (prompt.length < 2) return bad(origin, 400, "prompt too short");

  // --- Sample-mode fallback ------------------------------------------------
  if (!GOOGLE_API_KEY) {
    const slides = sampleSlides(prompt, slideCount, includeImages, language);
    return ok({
      created: Math.floor(Date.now() / 1000),
      slide_count: slides.length,
      slides,
      sample_mode: true,
      message: "GOOGLE_API_KEY not configured - returning sample slides",
    }, origin);
  }

  try {
    const slides = await callGeminiForOutline(prompt, slideCount, language, chatModel, attachments);

    if (includeImages) {
      const limit = 6;
      const results: (string | null)[] = new Array(slides.length).fill(null);
      let cursor = 0;
      const worker = async () => {
        while (true) {
          const i = cursor++;
          if (i >= slides.length) return;
          const ip = slides[i].imagePrompt;
          if (!ip) continue;
          results[i] = await callImagen(ip, imageModel);
        }
      };
      await Promise.all(Array.from({ length: limit }, worker));
      for (let i = 0; i < slides.length; i++) slides[i].imageB64 = results[i];
    }

    return ok({ created: Math.floor(Date.now() / 1000), slide_count: slides.length, slides }, origin);
  } catch (err) {
    return bad(origin, 500, "generation failed", String(err));
  }
});
