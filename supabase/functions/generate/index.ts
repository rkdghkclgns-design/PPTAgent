// Supabase Edge Function: generate (v11)
//
// Resolution chain for the LLM key:
//   ENV GOOGLE_API_KEY → ENV GEMINI_API_KEY → ENV ANTHROPIC_API_KEY
//   → vault GOOGLE_API_KEY / GEMINI_API_KEY → vault ANTHROPIC_API_KEY
//   → sample (graceful fallback, never 500)
//
// What v11 adds over v10:
//  - deck_type hint (lecture / pitch / report / analysis / generic) that
//    reshapes the slide sequence (cover → objectives → body → summary …).
//  - Per-slide `kind` field ("cover" | "objectives" | "content" | "summary"
//    | "qna") so the frontend can render each slide with a dedicated layout.
//  - Optional `diagram` field carrying mermaid code for flowcharts or
//    sequence diagrams - rendered client-side.
//  - `sources` array for citations (facts, stats, quotations).
//  - Imagen fallback: if Imagen fails (quota, auth, content filter) we
//    substitute a procedural SVG cover so slides never render empty.

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
interface Source { label: string; url?: string }
interface Slide {
  kind?: SlideKind;
  title: string;
  bullets: string[];
  notes?: string;
  imagePrompt?: string;
  imageB64?: string | null;
  /** Mermaid source for a flowchart / sequence diagram. Rendered by the client. */
  diagram?: string;
  /** Citations for stats / quotes on this slide. */
  sources?: Source[];
}
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

const DECK_STRUCTURE: Record<DeckType, string> = {
  lecture:
    "Structure (for lectures / 교과 자료): slide 1 = cover (course title, one-line summary), slide 2 = objectives (3-5 learning goals with kind='objectives'), slides 3..N-2 = content (kind='content'), slide N-1 = summary (kind='summary' - key takeaways), slide N = qna (kind='qna').",
  pitch:
    "Structure (for investor pitches): cover → problem → solution → market → product → business model → traction → team → ask. Use kind='cover' on slide 1 and kind='summary' on the final slide.",
  report:
    "Structure (for business reports): cover → executive summary → background → findings → analysis → recommendations → summary → appendix. Use kind='cover' first, kind='summary' near the end.",
  analysis:
    "Structure (for analytical decks): cover → context → data → insights → options → recommendation → summary. Cite every statistic in the `sources` array on that slide.",
  generic:
    "Structure: start with a cover slide (kind='cover'). If the deck has more than 4 slides, close with a summary (kind='summary'). Middle slides use kind='content'.",
};

function systemPrompt(slideCount: number, language: string, deckType: DeckType): string {
  return [
    "You are a senior presentation designer.",
    `Write an outline for a ${slideCount}-slide deck.`,
    language === "ko"
      ? "Write all user-facing fields (title, bullets, notes, sources.label) in Korean."
      : "Write concisely in the requested language.",
    DECK_STRUCTURE[deckType],
    "Do NOT prefix titles with slide numbers (e.g., write 'Market Overview', not '3. Market Overview').",
    "Keep output compact: title <=60 chars, each bullet <=80 chars, notes <=220 chars, imagePrompt <=180 chars.",
    "Every slide MUST have: title, bullets (3-5 items), notes (1-2 speaker notes sentences), imagePrompt (vivid ENGLISH description of ONE illustrative image, NO text in the image).",
    "Set `kind` on every slide - one of: 'cover', 'objectives', 'content', 'summary', 'qna'. Default to 'content' if unsure.",
    "When a slide visualises a process, comparison, hierarchy or timeline, ALSO provide a `diagram` field containing valid Mermaid syntax (flowchart, sequenceDiagram, pie, gantt, mindmap). Prefer flowchart LR for steps.",
    "When you cite a statistic, quotation or specific claim, populate the `sources` array: [{\"label\": \"Source title, Publisher (Year)\", \"url\": \"https://...\" optional}]. Leave empty when content is generic.",
    "If the user supplied attachments, mine their facts, data and examples to fill the slides and cite them as {\"label\":\"첨부: <filename>\"}.",
    "Return ONLY valid JSON matching {\"slides\":[{kind,title,bullets,notes,imagePrompt,diagram?,sources?}]}. No markdown, no prose outside the JSON.",
  ].filter(Boolean).join(" ");
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
  return raw.replace(/^\s*\d+\s*[.)\]:\-]\s*/, "").slice(0, 120);
}

const VALID_KINDS: SlideKind[] = ["cover", "objectives", "content", "summary", "qna"];

function clampSlides(slides: Slide[], slideCount: number): Slide[] {
  return slides.slice(0, slideCount).map((s, i) => ({
    kind: (VALID_KINDS as string[]).includes(String(s.kind))
      ? (s.kind as SlideKind)
      : (i === 0 ? "cover" : "content"),
    title: cleanTitle(String(s.title ?? "")),
    bullets: Array.isArray(s.bullets) ? s.bullets.map((b) => String(b).slice(0, 160)).slice(0, 6) : [],
    notes: s.notes ? String(s.notes).slice(0, 500) : undefined,
    imagePrompt: s.imagePrompt ? String(s.imagePrompt).slice(0, 400) : undefined,
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
  }));
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
// Imagen (with procedural fallback when Imagen is unavailable)
// ---------------------------------------------------------------------------

async function callImagen(apiKey: string, prompt: string, model: string): Promise<{ b64: string | null; err?: string }> {
  const body = {
    instances: [{ prompt }],
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
      return { b64: null, err: `imagen ${res.status}: ${errText}` };
    }
    const data = await res.json();
    const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
    return { b64: typeof b64 === "string" ? b64 : null };
  } catch (err) {
    return { b64: null, err: String(err).slice(0, 200) };
  }
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

function proceduralCoverSvg(title: string, idx: number, kind?: SlideKind): string {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  const kindHue = kind === "cover" ? 258 : kind === "objectives" ? 168 : kind === "summary" ? 26 : hue;
  const g1 = `hsl(${kindHue} 70% 55%)`;
  const g2 = `hsl(${(kindHue + 50) % 360} 65% 35%)`;
  const safe = (title || `Slide ${idx + 1}`).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").slice(0, 40);
  const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${g1}"/><stop offset="100%" stop-color="${g2}"/></linearGradient></defs><rect width="1600" height="900" fill="${g1}"/><rect width="1600" height="900" fill="url(#g)" opacity="0.85"/><g fill="rgba(255,255,255,0.08)"><circle cx="1350" cy="220" r="220"/><circle cx="230" cy="760" r="320"/></g><text x="90" y="500" font-family="Inter,system-ui" font-size="72" font-weight="700" fill="white">${safe}</text></svg>`;
  return btoa(unescape(encodeURIComponent(svg)));
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
  const imageModel = String(body.image_model ?? "imagen-3.0-generate-002");
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
      if (includeImages) {
        const limit = 6;
        const results: (string | null)[] = new Array(slides.length).fill(null);
        const errors: string[] = [];
        let cursor = 0;
        const worker = async () => {
          while (true) {
            const i = cursor++;
            if (i >= slides.length) return;
            const ip = slides[i].imagePrompt;
            if (!ip) continue;
            const r = await callImagen(key, ip, imageModel);
            if (r.b64) results[i] = r.b64;
            else if (r.err) errors.push(r.err);
          }
        };
        await Promise.all(Array.from({ length: limit }, worker));
        let imagenSucceeded = 0;
        for (let i = 0; i < slides.length; i++) {
          if (results[i]) {
            slides[i].imageB64 = results[i];
            imagenSucceeded++;
          } else {
            // Graceful fallback: procedural SVG so the slide never renders empty.
            slides[i].imageB64 = proceduralCoverSvg(slides[i].title, i, slides[i].kind);
          }
        }
        if (imagenSucceeded === 0 && errors.length > 0) {
          imageNote = `Imagen 호출 실패 - 프로시저럴 커버로 대체됨. 첫 오류: ${errors[0]}`;
        } else if (imagenSucceeded < slides.length) {
          imageNote = `${slides.length - imagenSucceeded}장은 Imagen 생성 실패로 프로시저럴 커버 사용.`;
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
      for (let i = 0; i < slides.length; i++) {
        slides[i].imageB64 = proceduralCoverSvg(slides[i].title, i, slides[i].kind);
      }
    }
    return respond(slides, "anthropic", "Anthropic Claude 텍스트 + 프로시저럴 커버 이미지.");
  } catch (err) {
    return sample(`Anthropic API failed: ${String(err).slice(0, 300)}`);
  }
});
