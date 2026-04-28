// Supabase Edge Function: regenerate-image
//
// Single-slide image regeneration. Pinned to gemini-3.1-flash-image-preview
// (next-gen nano-banana) for higher fidelity than the 2.5 generation.
// Client sends { title, bullets, imagePrompt, imageStyle, kind }; we return
// { b64: string } on success or { error } on failure.

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const GENAI_BASE = "https://generativelanguage.googleapis.com/v1beta";

const ALLOWED_ORIGINS = new Set(
  (Deno.env.get("ALLOWED_ORIGINS") ??
    "https://rkdghkclgns-design.github.io,http://localhost:3000")
    .split(",").map((s) => s.trim()).filter(Boolean),
);

type SlideKind = "cover" | "objectives" | "content" | "summary" | "qna";
type ImageStyle = "photo" | "illustration" | "diagram" | "abstract";

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
function json(status: number, body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "content-type": "application/json" },
  });
}

async function readFromVault(secretName: string): Promise<string | null> {
  const supaUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supaUrl || !serviceKey) return null;
  try {
    const res = await fetch(`${supaUrl}/rest/v1/rpc/get_api_secret`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ key_name: secretName }),
    });
    if (!res.ok) return null;
    const txt = (await res.text()).trim();
    if (!txt || txt === "null") return null;
    return txt.replace(/^"|"$/g, "");
  } catch {
    return null;
  }
}

async function resolveGoogleKey(): Promise<string | null> {
  for (const name of ["GOOGLE_API_KEY", "GEMINI_API_KEY"]) {
    const v = Deno.env.get(name);
    if (v) return v;
  }
  for (const name of ["GOOGLE_API_KEY", "GEMINI_API_KEY"]) {
    const v = await readFromVault(name);
    if (v) return v;
  }
  return null;
}

const STYLE_DIRECTION: Record<ImageStyle, string> = {
  photo:
    "Master-level editorial documentary photograph, full-frame camera, anamorphic lens, natural key light, shallow depth of field, cinematic teal-and-amber color grade, high dynamic range, ultra-sharp focus on the subject, realistic skin and fabric texture, film-grain finish, cover of a top-tier magazine.",
  illustration:
    "Premium editorial vector illustration, award-winning design-magazine aesthetic, flat forms layered over soft noise-grain gradients, generous negative space, cohesive palette of deep indigo / warm amber / off-white, rounded geometric forms, confident linework, ultra-crisp edges, evocative mood.",
  diagram:
    "Elegant isometric infographic, clean vector shapes, abstract glyphs stand in for every label (no letters), muted dark-academia palette with a single vivid accent, subtle drop shadows, pixel-perfect edges, editorial magazine polish.",
  abstract:
    "Cinematic abstract art, layered volumetric gradients, film-grain texture, soft bokeh particles, deep indigo drifting into warm ember, chiaroscuro lighting, gallery-quality, ultra-detailed, mood-forward, no subject clutter.",
};

const FRAMING: Record<SlideKind, string> = {
  cover:
    "Hero full-bleed composition with a commanding focal point, rule-of-thirds subject, negative space on the left or bottom for title overlay.",
  objectives:
    "Conceptual illustration evoking goals/learning targets (pathway, summit, roadmap — metaphor over literal), composed for a half-slide side panel.",
  content:
    "Balanced mid-distance composition with one clear subject plus supporting environmental detail; reads crisply at ~42% slide width.",
  summary:
    "Hero full-bleed composition with closing/recap feeling, negative space for title overlay, thematically consistent with the deck.",
  qna:
    "Minimal contemplative composition suggesting open dialogue or reflection; low visual noise, one soft focal point.",
};

function buildArtPrompt(title: string, bullets: string[], imagePrompt: string, style: ImageStyle, kind: SlideKind): string {
  const top = bullets.slice(0, 2).map((b) => `• ${b}`).join(" ");
  return [
    "Design a single high-end presentation illustration that visually represents the slide below.",
    `Slide title: "${title}".`,
    top ? `Key points this slide covers: ${top}` : "",
    imagePrompt ? `Additional direction: ${imagePrompt}` : "",
    `STYLE: ${STYLE_DIRECTION[style]}`,
    `FRAMING: ${FRAMING[kind]}`,
    "OUTPUT: 16:9 aspect ratio, render at 1600x900 or higher, clean editorial composition, premium design-magazine identity.",
    "STRICT: no written text, letters, numbers, captions, labels, watermarks, signage, or logos inside the image.",
  ].filter(Boolean).join("\n");
}

async function callGeminiImage(apiKey: string, text: string, temperature: number): Promise<{ b64: string | null; err?: string }> {
  const model = "gemini-3.1-flash-image-preview";
  const payload = {
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: { responseModalities: ["IMAGE"], temperature },
  };
  try {
    const res = await fetch(`${GENAI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errText = (await res.text()).slice(0, 200);
      return { b64: null, err: `gemini-image ${res.status}: ${errText}` };
    }
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    for (const p of parts) {
      const inline = p?.inlineData ?? p?.inline_data;
      if (inline?.data && typeof inline.data === "string") return { b64: inline.data };
    }
    return { b64: null, err: "gemini-image: no inline image in response (safety filter?)" };
  } catch (err) {
    return { b64: null, err: `gemini-image ${String(err).slice(0, 200)}` };
  }
}

serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
  if (req.method !== "POST") return json(405, { error: "method not allowed" }, origin);

  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: "invalid JSON body" }, origin); }

  const title = String(body.title ?? "").slice(0, 200);
  const bullets: string[] = Array.isArray(body.bullets) ? body.bullets.slice(0, 6).map((b: any) => String(b).slice(0, 200)) : [];
  const imagePrompt = String(body.imagePrompt ?? body.image_prompt ?? "").slice(0, 500);
  const rawStyle = String(body.imageStyle ?? body.image_style ?? "illustration");
  const style: ImageStyle = (["photo", "illustration", "diagram", "abstract"] as ImageStyle[]).includes(rawStyle as ImageStyle)
    ? (rawStyle as ImageStyle) : "illustration";
  const rawKind = String(body.kind ?? "content");
  const kind: SlideKind = (["cover", "objectives", "content", "summary", "qna"] as SlideKind[]).includes(rawKind as SlideKind)
    ? (rawKind as SlideKind) : "content";

  if (!title && !imagePrompt) return json(400, { error: "title or imagePrompt required" }, origin);

  const key = await resolveGoogleKey();
  if (!key) return json(503, { error: "Google API key not configured" }, origin);

  const prompt = buildArtPrompt(title, bullets, imagePrompt, style, kind);
  const first = await callGeminiImage(key, prompt, 0.75);
  if (first.b64) return json(200, { b64: first.b64, modelUsed: "gemini-3.1-flash-image-preview" }, origin);

  // Retry with a safer, narrower prompt.
  const safe = [
    `Create a tasteful ${style === "photo" ? "photograph" : style === "diagram" ? "infographic" : style === "abstract" ? "abstract composition" : "editorial illustration"} representing: ${imagePrompt || title}.`,
    `FRAMING: ${FRAMING[kind]}`,
    "16:9 aspect ratio, premium editorial quality, no text or letters anywhere.",
  ].join("\n");
  const second = await callGeminiImage(key, safe, 0.6);
  if (second.b64) return json(200, { b64: second.b64, modelUsed: "gemini-3.1-flash-image-preview" }, origin);

  return json(502, { error: second.err ?? first.err ?? "image generation failed" }, origin);
});
