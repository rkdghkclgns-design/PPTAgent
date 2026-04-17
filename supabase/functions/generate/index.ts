// Supabase Edge Function: generate (v5)
//
// Provider resolution chain:
//   1. Edge Function secret GOOGLE_API_KEY     -> Gemini + Imagen
//   2. Edge Function secret ANTHROPIC_API_KEY   -> Claude + procedural cover
//   3. vault.decrypted_secrets via public.get_api_secret() RPC:
//        - GOOGLE_API_KEY (same family)
//        - ANTHROPIC_API_KEY, CCGS_ANTHROPIC_API_KEY (Claude family)
//   4. Sample mode (deterministic filler, no outbound calls)
//
// Every upstream failure falls back to sample + embeds the underlying
// message in `note`. The frontend switches banner style on `provider`.

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const GENAI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const ANTHROPIC_BASE = "https://api.anthropic.com/v1";

const ALLOWED_ORIGINS = new Set(
  (Deno.env.get("ALLOWED_ORIGINS") ??
    "https://rkdghkclgns-design.github.io,http://localhost:3000")
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
  name: string;
  mime_type: string;
  text?: string;
  image_b64?: string;
}

type Provider = "google" | "anthropic" | "sample";

// ---------------------------------------------------------------------------
// Key resolution
// ---------------------------------------------------------------------------

async function readFromVault(secretName: string): Promise<string | null> {
  const supaUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supaUrl || !serviceKey) return null;
  try {
    const res = await fetch(`${supaUrl}/rest/v1/rpc/get_api_secret`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ key_name: secretName }),
    });
    if (!res.ok) return null;
    const txt = (await res.text()).trim();
    if (!txt || txt === "null") return null;
    return txt.replace(/^"|"$/g, "");
  } catch (err) {
    console.warn("vault read failed", String(err));
    return null;
  }
}

async function resolveProvider(): Promise<{ provider: Provider; key: string }> {
  // Edge Function secrets (Dashboard → Functions → Secrets)
  for (const name of ["GOOGLE_API_KEY", "GEMINI_API_KEY"]) {
    const v = Deno.env.get(name);
    if (v) return { provider: "google", key: v };
  }
  const envAnthropic = Deno.env.get("ANTHROPIC_API_KEY");
  if (envAnthropic) return { provider: "anthropic", key: envAnthropic };

  // Fall back to Postgres vault secrets via the service-role RPC.
  for (const name of ["GOOGLE_API_KEY", "GEMINI_API_KEY"]) {
    const v = await readFromVault(name);
    if (v) return { provider: "google", key: v };
  }
  for (const name of ["ANTHROPIC_API_KEY", "CCGS_ANTHROPIC_API_KEY"]) {
    const v = await readFromVault(name);
    if (v) return { provider: "anthropic", key: v };
  }
  return { provider: "sample", key: "" };
}

// ---------------------------------------------------------------------------
// Shared prompt helpers
// ---------------------------------------------------------------------------

const SAMPLE_COVER =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function systemPrompt(slideCount: number, language: string): string {
  return [
    "You are a senior presentation designer.",
    `Write an outline for a ${slideCount}-slide deck.`,
    language === "ko"
      ? "Write all title, bullets, notes and imagePrompt fields in Korean."
      : "Write concisely in the requested language.",
    "Each slide MUST have: title (<=60 chars), 3-5 bullets (each <=90 chars), notes (1-2 sentence speaker notes), and imagePrompt (a vivid English description of a single illustrative image for that slide, no text in the image).",
    "If the user supplied attachments, mine their facts, data and examples to fill the slides.",
    "Return ONLY valid JSON with the shape {\"slides\": [{...}]}.",
  ].join(" ");
}

function attachmentText(prompt: string, attachments: Attachment[]): string {
  const textBlobs: string[] = [];
  for (const a of attachments) {
    if (a.text) textBlobs.push(`### Attachment: ${a.name}\n${a.text.slice(0, 8000)}`);
  }
  if (textBlobs.length === 0) return prompt;
  return prompt + "\n\n---\nReference material from attachments:\n\n" + textBlobs.join("\n\n");
}

function cleanTitle(raw: string): string {
  // Strip leading "12. ", "12) ", "12: " etc. that Gemini sometimes prepends
  // when the prompt says "Generate slides X-Y" - purely cosmetic.
  return raw.replace(/^\s*\d+\s*[.)\]:\-]\s*/, "").slice(0, 120);
}

function clampSlides(slides: Slide[], slideCount: number): Slide[] {
  return slides.slice(0, slideCount).map((s) => ({
    title: cleanTitle(String(s.title ?? "")),
    bullets: Array.isArray(s.bullets) ? s.bullets.map(String).slice(0, 6) : [],
    notes: s.notes ? String(s.notes).slice(0, 400) : undefined,
    imagePrompt: s.imagePrompt ? String(s.imagePrompt).slice(0, 400) : undefined,
  }));
}

/**
 * Parse Gemini's JSON response even when the model got cut off mid-object.
 *
 * Gemini 2.5 Flash can exhaust the output budget on large slide counts and
 * return an unterminated string. We keep trimming back to the last completed
 * slide object so the user still sees N-1 good slides instead of a sample.
 */
function parseSlidesFromText(raw: string): Slide[] {
  let body = raw.trim();
  if (!body.startsWith("{")) {
    const m = body.match(/\{[\s\S]*\}/);
    if (m) body = m[0];
  }

  try {
    const parsed = JSON.parse(body);
    const slides = (parsed.slides ?? parsed) as Slide[];
    if (Array.isArray(slides) && slides.length > 0) return slides;
    throw new Error("empty slides array");
  } catch (firstErr) {
    // Truncated? Cut after the last balanced `}` inside the slides array and
    // re-parse. Pattern:   ...{..."slides":[ {...}, {...}, {truncated...
    const lastGood = findLastCompleteSlide(body);
    if (lastGood) {
      try {
        const parsed = JSON.parse(lastGood);
        const slides = (parsed.slides ?? parsed) as Slide[];
        if (Array.isArray(slides) && slides.length > 0) {
          console.warn(`parseSlidesFromText recovered ${slides.length} slides from truncated JSON`);
          return slides;
        }
      } catch (_err) {
        // fall through to the original error
      }
    }
    throw firstErr;
  }
}

/** Walk `body` keeping a stack of {}/[]/quotes; return the substring ending at
 *  the last position where the stack was balanced at depth 2 (one `slides` array
 *  plus one slide object) OR the outermost object closed naturally. */
function findLastCompleteSlide(body: string): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  let lastGoodEnd = -1;
  // Find "slides":[ so we know where the array starts.
  const slidesIdx = body.search(/"slides"\s*:\s*\[/);
  if (slidesIdx < 0) return null;
  const arrayStart = body.indexOf("[", slidesIdx);
  if (arrayStart < 0) return null;

  for (let i = arrayStart; i < body.length; i++) {
    const ch = body[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      // depth 1 after closing = just finished a slide object inside the array
      if (depth === 1 && ch === "}") lastGoodEnd = i;
      if (depth === 0) break;
    }
  }
  if (lastGoodEnd < 0) return null;
  // Reassemble a valid envelope: everything up to the last good `}` + ]}
  return body.slice(0, lastGoodEnd + 1) + "]}";
}

// ---------------------------------------------------------------------------
// Google Gemini + Imagen
// ---------------------------------------------------------------------------

function buildGeminiUserParts(prompt: string, attachments: Attachment[]): any[] {
  const parts: any[] = [];
  for (const a of attachments) {
    if (a.mime_type?.startsWith("image/") && a.image_b64) {
      parts.push({ inlineData: { mimeType: a.mime_type, data: a.image_b64 } });
    }
  }
  parts.push({ text: attachmentText(prompt, attachments) });
  return parts;
}

/**
 * Public entry point - chunks big requests into 12-slide calls so we don't
 * hit the 65k output-token ceiling on Gemini 2.5 Flash.
 */
async function callGemini(
  apiKey: string,
  prompt: string,
  slideCount: number,
  language: string,
  model: string,
  attachments: Attachment[],
): Promise<Slide[]> {
  const CHUNK = 12;
  if (slideCount <= CHUNK) {
    return callGeminiOnce(apiKey, prompt, slideCount, language, model, attachments);
  }
  const all: Slide[] = [];
  for (let start = 0; start < slideCount; start += CHUNK) {
    const chunkSize = Math.min(CHUNK, slideCount - start);
    const priorTitles = all.map((s, i) => `${i + 1}. ${s.title}`).slice(-30).join("\n");
    const augmented = [
      `Generate slides ${start + 1}-${start + chunkSize} of a ${slideCount}-slide deck (this call produces ${chunkSize} slide objects).`,
      priorTitles ? `Previous slide titles for continuity:\n${priorTitles}` : "",
      `Original topic / instructions:\n${prompt}`,
    ].filter(Boolean).join("\n\n");
    // Only the first chunk carries attachments - they're already in the
    // context by the time subsequent chunks run.
    const chunkAttachments = start === 0 ? attachments : [];
    const chunkSlides = await callGeminiOnce(
      apiKey,
      augmented,
      chunkSize,
      language,
      model,
      chunkAttachments,
    );
    all.push(...chunkSlides);
  }
  return all.slice(0, slideCount);
}

async function callGeminiOnce(
  apiKey: string,
  prompt: string,
  slideCount: number,
  language: string,
  model: string,
  attachments: Attachment[],
): Promise<Slide[]> {
  const payload = {
    contents: [{ role: "user", parts: buildGeminiUserParts(prompt, attachments) }],
    systemInstruction: { parts: [{ text: systemPrompt(slideCount, language) }] },
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.6,
      maxOutputTokens: Math.min(60000, 2500 + slideCount * 700),
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  const res = await fetch(`${GENAI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
  return clampSlides(parseSlidesFromText(text), slideCount);
}

async function callImagen(apiKey: string, prompt: string, model: string): Promise<string | null> {
  const body = {
    instances: [{ prompt }],
    parameters: {
      sampleCount: 1,
      aspectRatio: "16:9",
      safetyFilterLevel: "block_few",
      personGeneration: "allow_adult",
    },
  };
  const res = await fetch(`${GENAI_BASE}/models/${encodeURIComponent(model)}:predict`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.warn(`imagen ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return null;
  }
  const data = await res.json();
  const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
  return typeof b64 === "string" ? b64 : null;
}

// ---------------------------------------------------------------------------
// Anthropic Claude
// ---------------------------------------------------------------------------

function buildClaudeContent(prompt: string, attachments: Attachment[]): any[] {
  const content: any[] = [];
  for (const a of attachments) {
    if (a.mime_type?.startsWith("image/") && a.image_b64) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: a.mime_type, data: a.image_b64 },
      });
    }
  }
  content.push({ type: "text", text: attachmentText(prompt, attachments) });
  return content;
}

async function callClaude(
  apiKey: string,
  prompt: string,
  slideCount: number,
  language: string,
  attachments: Attachment[],
): Promise<Slide[]> {
  const payload = {
    model: "claude-3-5-sonnet-latest",
    max_tokens: Math.min(8192, 1500 + slideCount * 200),
    system: systemPrompt(slideCount, language),
    messages: [{ role: "user", content: buildClaudeContent(prompt, attachments) }],
  };
  const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 500);
    let human = body;
    try {
      const j = JSON.parse(body);
      human = j?.error?.message ?? body;
    } catch { /* ignore */ }
    throw new Error(`claude ${res.status}: ${human}`);
  }
  const data = await res.json();
  const text = (data?.content ?? [])
    .map((b: any) => (b?.type === "text" ? b.text ?? "" : ""))
    .join("");
  return clampSlides(parseSlidesFromText(text), slideCount);
}

/** Deterministic procedural cover when no image generator is available. */
function proceduralCoverSvg(title: string, idx: number): string {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  const g1 = `hsl(${hue} 70% 55%)`;
  const g2 = `hsl(${(hue + 50) % 360} 65% 35%)`;
  const safe = (title || `Slide ${idx + 1}`)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .slice(0, 40);
  const svg =
    `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0%" stop-color="${g1}"/><stop offset="100%" stop-color="${g2}"/>` +
    `</linearGradient></defs>` +
    `<rect width="1600" height="900" fill="${g1}"/>` +
    `<rect width="1600" height="900" fill="url(#g)" opacity="0.85"/>` +
    `<g fill="rgba(255,255,255,0.08)"><circle cx="1350" cy="220" r="220"/><circle cx="230" cy="760" r="320"/></g>` +
    `<text x="90" y="500" font-family="Inter,system-ui" font-size="72" font-weight="700" fill="white">${safe}</text>` +
    `</svg>`;
  return btoa(unescape(encodeURIComponent(svg)));
}

// ---------------------------------------------------------------------------
// Sample deck
// ---------------------------------------------------------------------------

function sampleSlides(
  prompt: string,
  slideCount: number,
  includeImages: boolean,
  language: string,
): Slide[] {
  const ko = language === "ko";
  const titles = ko
    ? ["개요", "문제 정의", "시장 현황", "핵심 제안", "경쟁 구도", "실행 로드맵", "기대 효과", "리스크와 대응", "재무 전망", "요약과 다음 단계"]
    : ["Overview", "Problem Statement", "Market Landscape", "Core Proposition", "Competitive Setting", "Execution Roadmap", "Expected Impact", "Risks and Mitigation", "Financial Outlook", "Summary and Next Steps"];
  return Array.from({ length: slideCount }, (_, i) => {
    const title = (i < titles.length ? titles[i] : `${titles[i % titles.length]} (${i + 1})`) +
      " - " + prompt.slice(0, 20);
    const bullets = ko
      ? [
        "샘플 응답입니다",
        "슬라이드 수량: " + slideCount,
        "이미지: " + (includeImages ? "포함" : "비포함"),
      ]
      : [
        "Sample response.",
        "Slide count: " + slideCount,
        "Images: " + (includeImages ? "on" : "off"),
      ];
    return {
      title,
      bullets,
      notes: ko ? "샘플 모드 슬라이드입니다." : "Sample mode slide.",
      imagePrompt: ko ? "추상적인 그라디언트" : "abstract gradient",
      imageB64: includeImages ? SAMPLE_COVER : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
  if (req.method !== "POST") return bad(origin, 405, "method not allowed");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad(origin, 400, "invalid JSON body");
  }

  const prompt = String(body.prompt ?? "").trim();
  const slideCount = Math.max(1, Math.min(100, Number(body.slide_count ?? 8)));
  const includeImages = body.include_images !== false;
  const language = String(body.language ?? "ko");
  const chatModel = String(body.chat_model ?? "gemini-2.5-flash");
  const imageModel = String(body.image_model ?? "imagen-3.0-generate-002");
  const attachments: Attachment[] = Array.isArray(body.attachments)
    ? body.attachments.slice(0, 8)
    : [];
  if (prompt.length < 2) return bad(origin, 400, "prompt too short");

  const { provider, key } = await resolveProvider();

  const respond = (slides: Slide[], p: Provider, note?: string) =>
    ok({
      created: Math.floor(Date.now() / 1000),
      slide_count: slides.length,
      provider: p,
      note,
      slides,
    }, origin);

  const sample = (note?: string) =>
    respond(sampleSlides(prompt, slideCount, includeImages, language), "sample", note);

  if (provider === "sample") {
    return sample(
      "GOOGLE_API_KEY 또는 ANTHROPIC_API_KEY 가 Supabase 에 등록되지 않았습니다. 샘플 모드로 응답합니다.",
    );
  }

  if (provider === "google") {
    try {
      const slides = await callGemini(key, prompt, slideCount, language, chatModel, attachments);
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
            results[i] = await callImagen(key, ip, imageModel);
          }
        };
        await Promise.all(Array.from({ length: limit }, worker));
        for (let i = 0; i < slides.length; i++) slides[i].imageB64 = results[i];
      }
      return respond(slides, "google");
    } catch (err) {
      return sample(`Google API failed: ${String(err).slice(0, 300)}`);
    }
  }

  // Anthropic path - falls back to sample if Claude rejects (e.g. low credits).
  try {
    const slides = await callClaude(key, prompt, slideCount, language, attachments);
    if (includeImages) {
      for (let i = 0; i < slides.length; i++) {
        slides[i].imageB64 = proceduralCoverSvg(slides[i].title, i);
      }
    }
    return respond(
      slides,
      "anthropic",
      "Anthropic Claude 텍스트 + 프로시저럴 커버 이미지. 실제 AI 이미지 원하시면 GOOGLE_API_KEY 등록.",
    );
  } catch (err) {
    return sample(`Anthropic API failed: ${String(err).slice(0, 300)}`);
  }
});
