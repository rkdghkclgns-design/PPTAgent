// Supabase Edge Function: generate (v15)
//
// Resolution chain for the LLM key:
//   ENV GOOGLE_API_KEY → ENV GEMINI_API_KEY → ENV ANTHROPIC_API_KEY
//   → vault GOOGLE_API_KEY / GEMINI_API_KEY → vault ANTHROPIC_API_KEY
//   → sample (graceful fallback, never 500)
//
// What v15 changes over v14:
//  - Nano-banana (Gemini 2.5 Flash Image) is now the PRIMARY image generator
//    for every style; Imagen 4 is only a fallback when nano-banana fails.
//  - Attachment budget raised to 20k chars per file (from 8k) and the
//    system prompt now *requires* the outline to cover the structure /
//    headings of the attached material end-to-end, including a recap in
//    the summary slide — fixes cases where the deck ran out before the
//    attachment's content was exhausted.
//  - Art direction sharpened (explicit "award-winning editorial",
//    "ultra-detailed", "1024+ resolution" cues) so nano-banana returns
//    crisper, higher-fidelity imagery.

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

type SlideKind = "cover" | "objectives" | "content" | "summary" | "qna";
type ImageStyle = "photo" | "illustration" | "diagram" | "abstract";
type LayoutVariant = "hero" | "split-right" | "split-left" | "stacked" | "quote";
interface Source { label: string; url?: string }
interface Slide {
  kind?: SlideKind;
  title: string;
  bullets: string[];
  notes?: string;
  imagePrompt?: string;
  imageB64?: string | null;
  /** Art-direction hint so the image generator produces appropriate imagery. */
  imageStyle?: ImageStyle;
  /** Composition hint so the slide renderer varies layout across the deck. */
  layoutVariant?: LayoutVariant;
  /** Mermaid source for a flowchart / sequence diagram. Rendered by the client. */
  diagram?: string;
  /** Citations for stats / quotes on this slide. */
  sources?: Source[];
}

const VALID_IMAGE_STYLES: ImageStyle[] = ["photo", "illustration", "diagram", "abstract"];
const VALID_LAYOUT_VARIANTS: LayoutVariant[] = ["hero", "split-right", "split-left", "stacked", "quote"];
interface Attachment { name: string; mime_type: string; text?: string; image_b64?: string }
type Provider = "google" | "anthropic" | "sample";
type DeckType = "lecture" | "pitch" | "report" | "analysis" | "generic";

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
      headers: { "content-type": "application/json", apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
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
  for (const name of ["GOOGLE_API_KEY", "GEMINI_API_KEY"]) {
    const v = Deno.env.get(name);
    if (v) return { provider: "google", key: v };
  }
  const envAnthropic = Deno.env.get("ANTHROPIC_API_KEY");
  if (envAnthropic) return { provider: "anthropic", key: envAnthropic };
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
// Prompt
// ---------------------------------------------------------------------------

const DECK_FLAVOR: Record<DeckType, string> = {
  lecture:
    "Lecture flavor: slide 2 objectives are '학습 목표', closing summary reviews key takeaways, optionally end with kind='qna'.",
  pitch:
    "Pitch flavor: after the objectives slide walk through problem → solution → market → product → business model → traction → team → ask before the closing summary.",
  report:
    "Report flavor: after objectives cover executive summary → background → findings → analysis → recommendations before the closing summary. Optional appendix slides use kind='content'.",
  analysis:
    "Analysis flavor: after objectives cover context → data → insights → options → recommendation before the closing summary. Cite every statistic in the sources array.",
  generic:
    "Generic flavor: middle slides cover the key themes of the topic; pick a meaningful progression.",
};

function systemPrompt(slideCount: number, language: string, deckType: DeckType): string {
  const hasObjectives = slideCount >= 3;
  const hasSummary = slideCount >= 3;
  const structure = [
    "Mandatory deck structure (ALL deck types):",
    "  slide 1 = kind='cover' (title + 1-line subtitle).",
    hasObjectives ? "  slide 2 = kind='objectives' (3-5 learning goals or talking points that preview the deck)." : "",
    "  middle slides = kind='content' (substantive material).",
    hasSummary ? `  slide ${slideCount} = kind='summary' (결론/Key takeaways — recap of the whole deck).` : "",
  ].filter(Boolean).join("\n");

  return [
    "You are a senior presentation designer producing editorial-quality decks.",
    `Write an outline for a ${slideCount}-slide deck.`,
    language === "ko"
      ? "Write every user-facing field (title, bullets, notes, sources.label) in natural Korean. Avoid machine-translation tone."
      : "Write concisely in the requested language.",
    structure,
    DECK_FLAVOR[deckType],
    "Do NOT prefix titles with slide numbers (e.g., write 'Market Overview', not '3. Market Overview').",
    "Keep output compact: title <=60 chars, each bullet <=80 chars, notes <=220 chars, imagePrompt <=220 chars.",
    "Every slide MUST have: title, bullets (3-5 items), notes (1-2 speaker notes sentences), imagePrompt (vivid ENGLISH description of ONE illustrative image, NO text in the image), imageStyle, layoutVariant.",
    "Set `kind` on every slide exactly following the structure above.",
    "Set `imageStyle` to one of: 'photo' (realistic editorial photography — best for case studies, real-world subjects), 'illustration' (flat/vector editorial illustration — best for concepts, objectives, summaries), 'diagram' (schematic infographic — when the content is a system/process), 'abstract' (moody gradient/texture — for transitions, cover slides).",
    "Set `layoutVariant` to one of: 'hero' (full-bleed image with overlaid title — prefer for cover and summary), 'split-right' (text left, image right — default for content), 'split-left' (image left, text right — alternate every other content slide), 'stacked' (text on top, image below — for objectives or numbered lists), 'quote' (centered large text, no image — for punchline/pivot slides). VARY across the deck so no two adjacent slides share a layoutVariant.",
    "imagePrompt should be CITATION-QUALITY: explicitly describe subject, setting, action, lighting, color palette, camera/style hints. Example: 'A Korean high-school classroom, students analyzing a climate data chart on screen, late-afternoon golden light, shallow depth of field, editorial photography, muted teal-orange palette'.",
    "When a slide visualises a process, comparison, hierarchy or timeline, ALSO provide a `diagram` field containing valid Mermaid syntax (flowchart, sequenceDiagram, pie, gantt, mindmap). Prefer flowchart LR for steps.",
    "When you cite a statistic, quotation or specific claim, populate the `sources` array: [{\"label\": \"Source title, Publisher (Year)\", \"url\": \"https://...\" optional}]. Leave empty when content is generic.",
    "CRITICAL: If the user supplied attachment material, the deck MUST cover it end-to-end — walk through every major heading of the attached document in order, do not stop halfway. Infer the document's outline from its headings (#, ##, ###) and allocate slides proportionally across sections, not just the first section. Concrete facts, numbers, definitions and examples must come from the attachment — do NOT invent facts the attachment doesn't support. Every slide that uses attachment material must cite it as {\"label\":\"첨부: <filename>\"} in sources.",
    "The final summary slide must RECAP the key sections of the attached material (or the deck's own content when no attachment is present) — name each major section or theme, do not just restate the title.",
    "Return ONLY valid JSON matching {\"slides\":[{kind,title,bullets,notes,imagePrompt,imageStyle,layoutVariant,diagram?,sources?}]}. No markdown, no prose outside the JSON.",
  ].filter(Boolean).join(" ");
}

// Total text budget across all attachments. Gemini 2.5 Flash handles ~1M
// tokens; 80k chars (~20k tokens) leaves plenty of headroom for the system
// prompt + slide JSON output.
const PER_ATTACHMENT_CAP = 20000;
const TOTAL_ATTACHMENT_CAP = 80000;

function attachmentText(prompt: string, attachments: Attachment[]): string {
  const textBlobs: string[] = [];
  let remaining = TOTAL_ATTACHMENT_CAP;
  for (const a of attachments) {
    if (!a.text || remaining <= 0) continue;
    const take = Math.min(PER_ATTACHMENT_CAP, remaining, a.text.length);
    textBlobs.push(`### Attachment: ${a.name}\n${a.text.slice(0, take)}`);
    remaining -= take;
  }
  if (textBlobs.length === 0) return prompt;
  return prompt + "\n\n---\nReference material from attachments (cover the WHOLE material, not just the opening):\n\n" + textBlobs.join("\n\n");
}

function cleanTitle(raw: string): string {
  return raw.replace(/^\s*\d+\s*[.)\]:\-]\s*/, "").slice(0, 120);
}

const VALID_KINDS: SlideKind[] = ["cover", "objectives", "content", "summary", "qna"];

function clampSlides(slides: Slide[], slideCount: number): Slide[] {
  const cleaned = slides.slice(0, slideCount).map<Slide>((s, i) => {
    const rawKind = (VALID_KINDS as string[]).includes(String(s.kind))
      ? (s.kind as SlideKind) : undefined;
    const rawStyle = (VALID_IMAGE_STYLES as string[]).includes(String(s.imageStyle))
      ? (s.imageStyle as ImageStyle) : undefined;
    const rawVariant = (VALID_LAYOUT_VARIANTS as string[]).includes(String(s.layoutVariant))
      ? (s.layoutVariant as LayoutVariant) : undefined;
    return {
      kind: rawKind ?? (i === 0 ? "cover" : "content"),
      title: cleanTitle(String(s.title ?? "")),
      bullets: Array.isArray(s.bullets) ? s.bullets.map((b) => String(b).slice(0, 160)).slice(0, 6) : [],
      notes: s.notes ? String(s.notes).slice(0, 500) : undefined,
      imagePrompt: s.imagePrompt ? String(s.imagePrompt).slice(0, 500) : undefined,
      imageStyle: rawStyle,
      layoutVariant: rawVariant,
      diagram: s.diagram ? String(s.diagram).slice(0, 2000) : undefined,
      sources: Array.isArray(s.sources)
        ? s.sources
            .map((src: any) => ({
              label: String(src?.label ?? "").slice(0, 200),
              url: typeof src?.url === "string" && /^https?:\/\//.test(src.url) ? src.url : undefined,
            }))
            .filter((src) => src.label)
            .slice(0, 6)
        : undefined,
    };
  });

  // Enforce the mandatory cover → objectives → content... → summary contract
  // even when the outline model forgets. Fill in defaults for missing slots.
  if (cleaned.length > 0) {
    cleaned[0].kind = "cover";
    if (!cleaned[0].layoutVariant) cleaned[0].layoutVariant = "hero";
    if (!cleaned[0].imageStyle) cleaned[0].imageStyle = "abstract";
  }
  if (cleaned.length >= 3) {
    cleaned[1].kind = "objectives";
    if (!cleaned[1].layoutVariant) cleaned[1].layoutVariant = "stacked";
    if (!cleaned[1].imageStyle) cleaned[1].imageStyle = "illustration";
    const last = cleaned.length - 1;
    // Don't clobber explicit qna slides as summary.
    if (cleaned[last].kind !== "qna") cleaned[last].kind = "summary";
    if (!cleaned[last].layoutVariant) cleaned[last].layoutVariant = "hero";
    if (!cleaned[last].imageStyle) cleaned[last].imageStyle = "abstract";
  }
  // Break adjacent layoutVariant collisions among content slides and ensure
  // every slide has *some* variant so the renderer never falls back to a
  // single default.
  const rotation: LayoutVariant[] = ["split-right", "split-left", "stacked", "split-right"];
  for (let i = 0; i < cleaned.length; i++) {
    const s = cleaned[i];
    if (!s.layoutVariant) {
      s.layoutVariant = s.kind === "content" ? rotation[i % rotation.length] : "split-right";
    }
    if (!s.imageStyle) {
      s.imageStyle = s.kind === "content" ? (i % 2 === 0 ? "photo" : "illustration") : "illustration";
    }
    if (i > 0 && cleaned[i - 1].layoutVariant === s.layoutVariant && s.kind === "content") {
      s.layoutVariant = s.layoutVariant === "split-right" ? "split-left" : "split-right";
    }
  }
  return cleaned;
}

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
    const salvaged = findLastCompleteSlide(body);
    if (salvaged) {
      try {
        const parsed = JSON.parse(salvaged);
        const slides = (parsed.slides ?? parsed) as Slide[];
        if (Array.isArray(slides) && slides.length > 0) {
          console.warn(`recovered ${slides.length} slides from truncated JSON`);
          return slides;
        }
      } catch (_err) { /* fall through */ }
    }
    throw firstErr;
  }
}

function findLastCompleteSlide(body: string): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  let lastGoodEnd = -1;
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
      if (depth === 1 && ch === "}") lastGoodEnd = i;
      if (depth === 0) break;
    }
  }
  if (lastGoodEnd < 0) return null;
  return body.slice(0, lastGoodEnd + 1) + "]}";
}

// ---------------------------------------------------------------------------
// Gemini
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

async function callGemini(
  apiKey: string,
  prompt: string,
  slideCount: number,
  language: string,
  deckType: DeckType,
  model: string,
  attachments: Attachment[],
): Promise<Slide[]> {
  const CHUNK = 10; // smaller chunks for richer per-slide payloads (diagram + sources)
  if (slideCount <= CHUNK) {
    return callGeminiOnce(apiKey, prompt, slideCount, language, deckType, model, attachments);
  }
  const all: Slide[] = [];
  for (let start = 0; start < slideCount; start += CHUNK) {
    const chunkSize = Math.min(CHUNK, slideCount - start);
    const priorTitles = all.map((s, i) => `${i + 1}. ${s.title}`).slice(-30).join("\n");
    const augmented = [
      `You are continuing a ${slideCount}-slide deck (${deckType}). This call produces exactly ${chunkSize} more slide objects to append after the existing ones.`,
      priorTitles ? `Already-written slides (do NOT repeat these titles):\n${priorTitles}` : "",
      `Original topic / instructions:\n${prompt}`,
    ].filter(Boolean).join("\n\n");
    const chunkAttachments = start === 0 ? attachments : [];
    const chunkSlides = await callGeminiOnce(apiKey, augmented, chunkSize, language, deckType, model, chunkAttachments);
    all.push(...chunkSlides);
  }
  return all.slice(0, slideCount);
}

async function callGeminiOnce(
  apiKey: string,
  prompt: string,
  slideCount: number,
  language: string,
  deckType: DeckType,
  model: string,
  attachments: Attachment[],
): Promise<Slide[]> {
  const payload = {
    contents: [{ role: "user", parts: buildGeminiUserParts(prompt, attachments) }],
    systemInstruction: { parts: [{ text: systemPrompt(slideCount, language, deckType) }] },
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.6,
      maxOutputTokens: Math.min(60000, 3000 + slideCount * 900),
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

// ---------------------------------------------------------------------------
// Image generation chain: Imagen 4 → Imagen 4 Fast → Gemini 2.5 Flash Image.
// Every returned slide either has a REAL AI-generated PNG or b64=null. We do
// NOT synthesise procedural "dummy" gradients — the UI skips slides without
// an imageB64 entirely.
// ---------------------------------------------------------------------------

// Nano-banana first for every style (per user request for higher-quality,
// more consistent imagery across the deck), then Imagen 4 as quality fallback.
const IMAGE_FALLBACK_CHAIN = ["imagen-4.0-generate-001", "imagen-4.0-fast-generate-001"] as const;

// Art-direction scaffold applied to every image prompt so results feel like a
// coherent editorial deck instead of 10 disparate stock images. Each entry
// leans on explicit quality cues ("award-winning", "ultra-detailed") which
// nano-banana responds to strongly.
const STYLE_DIRECTION: Record<ImageStyle, string> = {
  photo:
    "Award-winning editorial documentary photography, shot on full-frame camera, natural window light, shallow depth of field, cinematic color grading with muted teal-orange palette, magazine-cover composition, ultra-sharp focus, realistic skin and fabric texture, high dynamic range, 4K quality.",
  illustration:
    "Premium editorial vector illustration with subtle texture, award-winning design-magazine aesthetic, flat forms layered over soft noise-grain gradients, generous negative space, cohesive palette of deep indigo / warm amber / off-white, rounded geometric forms, confident linework, ultra-crisp at any size.",
  diagram:
    "Sleek isometric infographic, clean vector shapes, abstract glyph annotations in place of any real letters, muted dark-academia palette with a single vivid accent, subtle shadows, minimal and editorially refined, pixel-perfect edges.",
  abstract:
    "Cinematic abstract composition: layered volumetric gradients, film-grain texture, soft bokeh particles, deep indigo drifting into warm ember, moody chiaroscuro lighting, gallery-quality, ultra-detailed, evocative mood.",
};

function buildArtPrompt(userPrompt: string, style: ImageStyle, kind: SlideKind): string {
  const framing = kind === "cover" || kind === "summary"
    ? "Hero full-bleed composition with strong focal point, subject on rule-of-thirds line, large negative space on the left or bottom-left so a title can overlay without clipping the subject."
    : kind === "objectives"
      ? "Conceptual illustration representing goals/learning targets, composed as a vertical or side-panel image that reads cleanly at half-slide size."
      : kind === "qna"
        ? "Minimal ambient composition with an open, contemplative mood — suggestive of dialogue or reflection, low visual noise."
        : "Balanced mid-distance composition with one clear subject and supporting environmental detail; reads well at 42% slide width.";
  return [
    `SUBJECT: ${userPrompt}`,
    `STYLE: ${STYLE_DIRECTION[style]}`,
    `FRAMING: ${framing}`,
    "Resolution: render at 1600x900 or higher, 16:9 aspect ratio. Photorealistic detail where applicable; crisp edges on illustrations.",
    "STRICT: absolutely no written text, letters, numbers, captions, labels, watermarks, signage, or logos inside the image. The image must be text-free.",
  ].join("\n");
}

async function callImagen(
  apiKey: string,
  prompt: string,
  model: string,
  style: ImageStyle,
  kind: SlideKind,
): Promise<{ b64: string | null; err?: string }> {
  const body = {
    instances: [{ prompt: buildArtPrompt(prompt, style, kind) }],
    parameters: {
      sampleCount: 1,
      aspectRatio: "16:9",
      safetyFilterLevel: "block_few",
      personGeneration: "allow_adult",
    },
  };
  try {
    const res = await fetch(`${GENAI_BASE}/models/${encodeURIComponent(model)}:predict`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = (await res.text()).slice(0, 200);
      return { b64: null, err: `imagen[${model}] ${res.status}: ${errText}` };
    }
    const data = await res.json();
    const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
    if (typeof b64 === "string" && b64.length > 0) return { b64 };
    return { b64: null, err: `imagen[${model}] empty response (safety filter?)` };
  } catch (err) {
    return { b64: null, err: `imagen[${model}] ${String(err).slice(0, 200)}` };
  }
}

// Gemini 2.5 Flash Image (nano-banana). Uses the standard generateContent
// endpoint with responseModalities=["IMAGE"] and full art direction so the
// resulting image is citation-quality, not a generic cartoon.
async function callGeminiImage(
  apiKey: string,
  prompt: string,
  style: ImageStyle,
  kind: SlideKind,
): Promise<{ b64: string | null; err?: string }> {
  const model = "gemini-2.5-flash-image";
  const text = buildArtPrompt(prompt, style, kind);
  const payload = {
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      temperature: 0.7,
    },
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

async function generateSlideImage(
  apiKey: string,
  prompt: string,
  primaryModel: string,
  style: ImageStyle,
  kind: SlideKind,
): Promise<{ b64: string | null; modelUsed?: string; errors: string[] }> {
  const errors: string[] = [];
  const tried = new Set<string>();

  const tryModel = async (model: string): Promise<string | null> => {
    if (tried.has(model)) return null;
    tried.add(model);
    if (model.startsWith("gemini-")) {
      const r = await callGeminiImage(apiKey, prompt, style, kind);
      if (r.b64) return r.b64;
      if (r.err) errors.push(r.err);
      return null;
    }
    const r = await callImagen(apiKey, prompt, model, style, kind);
    if (r.b64) return r.b64;
    if (r.err) errors.push(r.err);
    return null;
  };

  // Nano-banana (Gemini 2.5 Flash Image) is the primary generator for EVERY
  // style. The user-selected Imagen model and its fast sibling are only
  // tried if nano-banana fails (safety filter, transient error). This keeps
  // the deck visually consistent — every image comes from the same model
  // family — and maximises quality per nano-banana's editorial strengths.
  const chain = ["gemini-2.5-flash-image", primaryModel, ...IMAGE_FALLBACK_CHAIN];

  for (const m of chain) {
    const b64 = await tryModel(m);
    if (b64) return { b64, modelUsed: m, errors };
  }
  return { b64: null, errors };
}

// ---------------------------------------------------------------------------
// Anthropic Claude (text-only path)
// ---------------------------------------------------------------------------

function buildClaudeContent(prompt: string, attachments: Attachment[]): any[] {
  const content: any[] = [];
  for (const a of attachments) {
    if (a.mime_type?.startsWith("image/") && a.image_b64) {
      content.push({ type: "image", source: { type: "base64", media_type: a.mime_type, data: a.image_b64 } });
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
  deckType: DeckType,
  attachments: Attachment[],
): Promise<Slide[]> {
  const payload = {
    model: "claude-3-5-sonnet-latest",
    max_tokens: Math.min(8192, 2000 + slideCount * 280),
    system: systemPrompt(slideCount, language, deckType),
    messages: [{ role: "user", content: buildClaudeContent(prompt, attachments) }],
  };
  const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 500);
    let human = body;
    try { const j = JSON.parse(body); human = j?.error?.message ?? body; } catch { /* ignore */ }
    throw new Error(`claude ${res.status}: ${human}`);
  }
  const data = await res.json();
  const text = (data?.content ?? []).map((b: any) => (b?.type === "text" ? b.text ?? "" : "")).join("");
  return clampSlides(parseSlidesFromText(text), slideCount);
}

// ---------------------------------------------------------------------------
// Sample deck
// ---------------------------------------------------------------------------

const SAMPLE_COVER = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function sampleSlides(prompt: string, slideCount: number, includeImages: boolean, language: string, deckType: DeckType): Slide[] {
  const ko = language === "ko";
  const isLecture = deckType === "lecture";
  const titles = ko
    ? isLecture
      ? ["표지", "학습 목표", "핵심 개념", "예시와 응용", "실습 안내", "정리", "질의응답"]
      : ["개요", "문제 정의", "시장 현황", "핵심 제안", "경쟁 구도", "실행 로드맵", "요약"]
    : isLecture
      ? ["Cover", "Learning Objectives", "Core Concepts", "Examples", "Practice", "Summary", "Q&A"]
      : ["Overview", "Problem Statement", "Market", "Core Proposition", "Competitive", "Roadmap", "Summary"];
  return Array.from({ length: slideCount }, (_, i) => {
    const title = (i < titles.length ? titles[i] : `${titles[i % titles.length]} (${i + 1})`) + " - " + prompt.slice(0, 20);
    const kind: SlideKind = i === 0 ? "cover" : i === slideCount - 1 ? "summary" : isLecture && i === 1 ? "objectives" : "content";
    const bullets = ko
      ? ["샘플 응답입니다", "슬라이드 수량: " + slideCount, "이미지: " + (includeImages ? "포함" : "비포함")]
      : ["Sample response.", "Slide count: " + slideCount, "Images: " + (includeImages ? "on" : "off")];
    return {
      kind,
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
  try { body = await req.json(); } catch { return bad(origin, 400, "invalid JSON body"); }

  const prompt = String(body.prompt ?? "").trim();
  const slideCount = Math.max(1, Math.min(100, Number(body.slide_count ?? 8)));
  const includeImages = body.include_images !== false;
  const language = String(body.language ?? "ko");
  const rawDeckType = String(body.deck_type ?? "generic");
  const deckType: DeckType = (["lecture", "pitch", "report", "analysis", "generic"] as DeckType[]).includes(rawDeckType as DeckType)
    ? (rawDeckType as DeckType) : "generic";
  const chatModel = String(body.chat_model ?? "gemini-2.5-flash");
  const rawImageModel = String(body.image_model ?? "gemini-2.5-flash-image")
    .replace(/^google\//, "");
  // Imagen 3 was shut down on 2025-11-10 — transparently upgrade any stale
  // client-sent model ids to the Imagen 4 equivalents so old builds still work.
  const imageModel =
    rawImageModel === "imagen-3.0-generate-002" ? "imagen-4.0-generate-001"
    : rawImageModel === "imagen-3.0-fast-generate-001" ? "imagen-4.0-fast-generate-001"
    : rawImageModel;
  const attachments: Attachment[] = Array.isArray(body.attachments) ? body.attachments.slice(0, 8) : [];
  if (prompt.length < 2) return bad(origin, 400, "prompt too short");

  const { provider, key } = await resolveProvider();
  const respond = (slides: Slide[], p: Provider, note?: string, extras?: Record<string, unknown>) =>
    ok({
      created: Math.floor(Date.now() / 1000),
      slide_count: slides.length,
      provider: p,
      deck_type: deckType,
      note,
      ...(extras ?? {}),
      slides,
    }, origin);
  const sample = (note?: string) => respond(sampleSlides(prompt, slideCount, includeImages, language, deckType), "sample", note);

  if (provider === "sample") {
    return sample("GOOGLE_API_KEY / GEMINI_API_KEY / ANTHROPIC_API_KEY 가 구성되지 않았습니다.");
  }

  if (provider === "google") {
    try {
      const slides = await callGemini(key, prompt, slideCount, language, deckType, chatModel, attachments);
      let imageNote: string | undefined;
      const modelCounts: Record<string, number> = {};
      if (includeImages) {
        const limit = 4;
        const results: Array<{ b64: string | null; modelUsed?: string }> = slides.map(() => ({ b64: null }));
        const errors: string[] = [];
        let cursor = 0;
        const worker = async () => {
          while (true) {
            const i = cursor++;
            if (i >= slides.length) return;
            const ip = slides[i].imagePrompt;
            if (!ip) continue;
            const style = slides[i].imageStyle ?? "illustration";
            const kind = slides[i].kind ?? "content";
            const r = await generateSlideImage(key, ip, imageModel, style, kind);
            results[i] = { b64: r.b64, modelUsed: r.modelUsed };
            if (r.errors.length > 0) errors.push(...r.errors);
          }
        };
        await Promise.all(Array.from({ length: limit }, worker));
        let succeeded = 0;
        for (let i = 0; i < slides.length; i++) {
          const r = results[i];
          if (r.b64) {
            slides[i].imageB64 = r.b64;
            succeeded++;
            if (r.modelUsed) modelCounts[r.modelUsed] = (modelCounts[r.modelUsed] ?? 0) + 1;
          } else {
            // Root requirement: never fabricate "dummy" covers. Leave null so
            // the UI lays out the slide without a placeholder image.
            slides[i].imageB64 = null;
          }
        }
        const missing = slides.filter((s) => s.imagePrompt && !s.imageB64).length;
        if (succeeded === 0 && errors.length > 0) {
          imageNote = `이미지 생성 전체 실패. 첫 오류: ${errors[0]}`;
        } else if (missing > 0) {
          imageNote = `${missing}장은 이미지 생성 실패(안전 필터/쿼터). 나머지는 ${Object.entries(modelCounts).map(([m, c]) => `${m}×${c}`).join(", ")}.`;
        } else if (Object.keys(modelCounts).length > 0) {
          imageNote = `이미지 모델 사용: ${Object.entries(modelCounts).map(([m, c]) => `${m}×${c}`).join(", ")}.`;
        }
      }
      return respond(slides, "google", imageNote);
    } catch (err) {
      return sample(`Google API failed: ${String(err).slice(0, 300)}`);
    }
  }

  try {
    const slides = await callClaude(key, prompt, slideCount, language, deckType, attachments);
    if (includeImages) {
      // Anthropic path: try Gemini 2.5 Flash Image if we happen to have a
      // Google key available; otherwise leave null (no dummy).
      const googleKey = Deno.env.get("GOOGLE_API_KEY") ?? Deno.env.get("GEMINI_API_KEY") ?? "";
      if (googleKey) {
        for (let i = 0; i < slides.length; i++) {
          const ip = slides[i].imagePrompt;
          if (!ip) continue;
          const style = slides[i].imageStyle ?? "illustration";
          const kind = slides[i].kind ?? "content";
          const r = await callGeminiImage(googleKey, ip, style, kind);
          slides[i].imageB64 = r.b64;
        }
      } else {
        for (let i = 0; i < slides.length; i++) slides[i].imageB64 = null;
      }
    }
    return respond(slides, "anthropic", "Anthropic Claude 텍스트 + Gemini 이미지(키 있을 때).");
  } catch (err) {
    return sample(`Anthropic API failed: ${String(err).slice(0, 300)}`);
  }
});
