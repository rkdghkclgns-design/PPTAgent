// Supabase Edge Function: generate (v16)
//
// Resolution chain for the LLM key:
//   ENV GOOGLE_API_KEY → ENV GEMINI_API_KEY → ENV ANTHROPIC_API_KEY
//   → vault GOOGLE_API_KEY / GEMINI_API_KEY → vault ANTHROPIC_API_KEY
//   → sample (graceful fallback, never 500)
//
// What v16 changes over v15:
//  - Image pipeline is now nano-banana ONLY (Gemini 2.5 Flash Image).
//    Imagen chain removed entirely — single model family keeps every deck
//    visually coherent.
//  - The image prompt now carries the slide's actual content (title + top
//    bullets + kind) so the generated image matches what the slide says,
//    not just a loose `imagePrompt` phrase. Premium-quality art direction
//    ("cover of a top-tier design magazine", "8K", "master-level color")
//    added.
//  - Two-shot retry: if nano-banana returns no image on the first call
//    (safety filter hit, transient error) we retry once with a safer
//    prompt variant before giving up.

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
// Image generation: nano-banana (Gemini 2.5 Flash Image) ONLY. One model
// family keeps every deck visually coherent, and nano-banana's editorial
// strength matches the premium aesthetic we want. The art prompt feeds the
// slide's real content (title + bullets + kind) into the generator so the
// image is actually ABOUT what the slide covers, not a loose abstract.
// Retries once with a simplified prompt when the safety filter trips.
// ---------------------------------------------------------------------------

// Per-style art direction. Every entry leans on premium-magazine cues so
// nano-banana trends toward cover-quality, cohesive, high-end imagery.
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
    "Hero full-bleed composition with a commanding focal point on a rule-of-thirds line, generous negative space on the left or bottom-left for a title overlay; conveys the deck's core theme at a glance.",
  objectives:
    "Conceptual illustration evoking goals / learning targets (pathway, summit, roadmap, signposts — metaphor over literal). Composed to read cleanly as a half-slide side panel.",
  content:
    "Balanced mid-distance composition with one clear subject plus supporting environmental detail; reads crisply at ~42% slide width and reinforces the specific idea of this slide.",
  summary:
    "Hero full-bleed composition echoing the cover — closing / recap feeling, negative space for title overlay, thematically consistent with the deck.",
  qna:
    "Minimal contemplative composition suggesting open dialogue or reflection; low visual noise, one soft focal point.",
};

function pickSubjectHints(title: string, bullets: string[], userPrompt?: string): string {
  const top = bullets.slice(0, 2).map((b) => `• ${b}`).join(" ");
  const extra = userPrompt ? `Additional direction: ${userPrompt}` : "";
  return [
    `Slide title: "${title}".`,
    top ? `Key points this slide covers: ${top}` : "",
    extra,
  ].filter(Boolean).join(" ");
}

function buildArtPrompt(slide: Slide, style: ImageStyle, kind: SlideKind): string {
  const subject = pickSubjectHints(slide.title, slide.bullets ?? [], slide.imagePrompt);
  return [
    "Design a single high-end presentation illustration that visually represents the slide below.",
    subject,
    `STYLE: ${STYLE_DIRECTION[style]}`,
    `FRAMING: ${FRAMING[kind]}`,
    "OUTPUT: 16:9 aspect ratio, render at 1600x900 or higher, clean editorial composition, consistent with a premium design-magazine visual identity.",
    "STRICT: the image MUST contain absolutely no written text, letters, numbers, captions, labels, watermarks, signage, subtitles, UI chrome, or logos. Communicate the idea purely through imagery — any pixel that looks like text is a failure.",
  ].join("\n");
}

// Simpler, safer re-prompt used when the first attempt returns no image
// (typically a safety-filter trip on the enriched prompt).
function buildSafeArtPrompt(slide: Slide, style: ImageStyle, kind: SlideKind): string {
  const topic = slide.imagePrompt || slide.title;
  return [
    `Create a tasteful ${style === "photo" ? "photograph" : style === "diagram" ? "infographic" : style === "abstract" ? "abstract composition" : "editorial illustration"} representing: ${topic}.`,
    `FRAMING: ${FRAMING[kind]}`,
    "16:9 aspect ratio, premium editorial quality, no text or letters anywhere.",
  ].join("\n");
}

async function callGeminiImage(
  apiKey: string,
  text: string,
  temperature: number,
): Promise<{ b64: string | null; err?: string }> {
  const model = "gemini-2.5-flash-image";
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

async function generateSlideImage(
  apiKey: string,
  slide: Slide,
  style: ImageStyle,
  kind: SlideKind,
): Promise<{ b64: string | null; modelUsed?: string; errors: string[] }> {
  const errors: string[] = [];
  // Attempt 1: rich content-aware prompt, mid temperature.
  const first = await callGeminiImage(apiKey, buildArtPrompt(slide, style, kind), 0.75);
  if (first.b64) return { b64: first.b64, modelUsed: "gemini-2.5-flash-image", errors };
  if (first.err) errors.push(first.err);

  // Attempt 2: safer, narrower prompt — often clears a safety-filter hit.
  const second = await callGeminiImage(apiKey, buildSafeArtPrompt(slide, style, kind), 0.6);
  if (second.b64) return { b64: second.b64, modelUsed: "gemini-2.5-flash-image", errors };
  if (second.err) errors.push(second.err);

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
  // image_model is accepted for backward compatibility but ignored — image
  // generation is hard-pinned to nano-banana (Gemini 2.5 Flash Image).
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
            if (!ip && !slides[i].title) continue;
            const style = slides[i].imageStyle ?? "illustration";
            const kind = slides[i].kind ?? "content";
            const r = await generateSlideImage(key, slides[i], style, kind);
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
          if (!ip && !slides[i].title) continue;
          const style = slides[i].imageStyle ?? "illustration";
          const kind = slides[i].kind ?? "content";
          const r = await generateSlideImage(googleKey, slides[i], style, kind);
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
