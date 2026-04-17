// Supabase Edge Function: generate
//
// Takes a prompt, a slide count, optional image flag + language, and returns
// a deck as JSON. Each slide has { title, bullets[], notes, imagePrompt,
// imageB64 | null }. The browser then hands the JSON to pptxgenjs to build
// the actual .pptx file so no server-side Python or Docker is needed.
//
// Flow:
//   1. Call Gemini with a structured-output prompt -> [{title, bullets, notes,
//      imagePrompt}, ...]
//   2. If include_images, call Imagen once per slide in parallel.
//   3. Return the combined payload.
//
// Timeouts: Supabase Edge Functions cap at ~150s wall clock. 15 slides with
// images comfortably fit under a minute.

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const GOOGLE_API_KEY = Deno.env.get("GOOGLE_API_KEY") ?? "";
const GENAI_BASE = "https://generativelanguage.googleapis.com/v1beta";

if (!GOOGLE_API_KEY) {
  console.error("generate: GOOGLE_API_KEY missing - requests will 500");
}

// ----------------------------------------------------------------------------
// CORS
// ----------------------------------------------------------------------------

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

// ----------------------------------------------------------------------------
// Gemini (outline)
// ----------------------------------------------------------------------------

interface Slide {
  title: string;
  bullets: string[];
  notes?: string;
  imagePrompt?: string;
  imageB64?: string | null;
}

async function callGeminiForOutline(
  prompt: string,
  slideCount: number,
  language: string,
  model: string,
): Promise<Slide[]> {
  const sys = [
    "You are a senior presentation designer.",
    `Write an outline for a ${slideCount}-slide deck.`,
    language === "ko"
      ? "Write all title, bullets, notes and imagePrompt fields in Korean."
      : "Write concisely in the requested language.",
    "Each slide MUST have: title (<=60 chars), 3-5 bullets (each <=90 chars),",
    "notes (1-2 sentence speaker notes), and imagePrompt (a vivid English",
    "description of a single illustrative image for that slide, no text in the image).",
    "Return ONLY valid JSON with the shape {\"slides\": [{...}]}.",
  ].join(" ");

  const payload = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: sys }] },
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.6,
      maxOutputTokens: 4096,
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
  if (!res.ok) throw new Error(`gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`gemini returned non-json: ${text.slice(0, 200)}`);
  }
  const slides = (parsed.slides ?? parsed) as Slide[];
  if (!Array.isArray(slides) || slides.length === 0) {
    throw new Error("gemini returned empty slides array");
  }
  // Clamp to the requested count even if the model over-produced.
  return slides.slice(0, slideCount).map((s) => ({
    title: String(s.title ?? "").slice(0, 120),
    bullets: Array.isArray(s.bullets) ? s.bullets.map(String).slice(0, 6) : [],
    notes: s.notes ? String(s.notes).slice(0, 400) : undefined,
    imagePrompt: s.imagePrompt ? String(s.imagePrompt).slice(0, 400) : undefined,
  }));
}

// ----------------------------------------------------------------------------
// Imagen (cover + slide images)
// ----------------------------------------------------------------------------

async function callImagen(prompt: string, model: string): Promise<string | null> {
  const body = {
    instances: [{ prompt }],
    parameters: {
      sampleCount: 1,
      aspectRatio: "16:9",
      safetyFilterLevel: "block_few",
      personGeneration: "allow_adult",
    },
  };
  const res = await fetch(
    `${GENAI_BASE}/models/${encodeURIComponent(model)}:predict`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": GOOGLE_API_KEY },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    console.warn(`imagen ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return null;
  }
  const data = await res.json();
  const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
  return typeof b64 === "string" ? b64 : null;
}

// ----------------------------------------------------------------------------
// Router
// ----------------------------------------------------------------------------

serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
  if (req.method !== "POST") return bad(origin, 405, "method not allowed");
  if (!GOOGLE_API_KEY) return bad(origin, 500, "GOOGLE_API_KEY not configured");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad(origin, 400, "invalid JSON body");
  }

  const prompt = String(body.prompt ?? "").trim();
  const slideCount = Math.max(1, Math.min(25, Number(body.slide_count ?? 8)));
  const includeImages = body.include_images !== false;
  const language = String(body.language ?? "ko");
  const chatModel = String(body.chat_model ?? "gemini-2.0-flash");
  const imageModel = String(body.image_model ?? "imagen-3.0-generate-002");

  if (prompt.length < 2) return bad(origin, 400, "prompt too short");

  try {
    const slides = await callGeminiForOutline(prompt, slideCount, language, chatModel);

    if (includeImages) {
      // Parallelise Imagen calls but cap concurrency at 4 so a big deck
      // doesn't hammer the quota.
      const limit = 4;
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

    return ok({
      created: Math.floor(Date.now() / 1000),
      slide_count: slides.length,
      slides,
    }, origin);
  } catch (err) {
    return bad(origin, 500, "generation failed", String(err));
  }
});
