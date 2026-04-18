/**
 * Browser-side API client.
 *
 * The current deployment runs without a standalone FastAPI server. The
 * browser talks to Supabase directly:
 *   - POST <supabase>/functions/v1/generate    -> outline + images
 *   - Storage for attachments (signed upload URLs, when we eventually add them)
 *
 * `isApiReachable()` reports "live" iff Supabase env vars are baked in at
 * build time. The old /health probe is kept as a fallback for future FastAPI
 * deployments.
 */

import type { ModelSlot } from "./models";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export type ModelOverrides = Partial<Record<ModelSlot, string>>;
export type DeckType = "lecture" | "pitch" | "report" | "analysis" | "generic";
export type SlideKind = "cover" | "objectives" | "content" | "summary" | "qna";

/** Shape the Edge Function expects on the wire. */
export interface AttachmentPayload {
  name: string;
  mime_type: string;
  /** Plain-text contents for text/* attachments. */
  text?: string;
  /** Base64 (no data: prefix) for image/* attachments. */
  image_b64?: string;
}

export interface SourceRef {
  label: string;
  url?: string;
}

export interface GenerateRequest {
  prompt: string;
  slideCount: number;
  includeImages: boolean;
  language?: "ko" | "en";
  deckType?: DeckType;
  models?: ModelOverrides;
  attachments?: AttachmentPayload[];
}

export type ImageStyle = "photo" | "illustration" | "diagram" | "abstract";
export type LayoutVariant = "hero" | "split-right" | "split-left" | "stacked" | "quote";

export interface SlideData {
  index: number;
  kind: SlideKind;
  title: string;
  bullets: string[];
  notes?: string;
  imagePrompt?: string;
  /** Data URL ready for <img src=...> when present. */
  imageUrl?: string;
  /** Art-direction hint from the outline model. */
  imageStyle?: ImageStyle;
  /** Composition variant used by both the web preview and the PPTX renderer. */
  layoutVariant?: LayoutVariant;
  /** Mermaid source for a flowchart / sequence diagram. */
  diagram?: string;
  /** Citations attached to this slide. */
  sources?: SourceRef[];
}

export type GenerateProvider = "google" | "anthropic" | "sample";

export interface GenerateResult {
  slide_count: number;
  slides: SlideData[];
  /** Which backend actually produced the content. */
  provider: GenerateProvider;
  /** Structural template the edge function used. */
  deck_type?: DeckType;
  /** Human-readable note - most useful when provider === "sample" and we
   *  need to surface the underlying API failure, or when Imagen fell back to
   *  procedural covers. */
  note?: string;
  /** Back-compat alias. Older callers used sample_mode instead of provider. */
  sample_mode?: boolean;
}

/** True when browser can drive a real generation via Supabase. */
export async function isApiReachable(): Promise<boolean> {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/**
 * Call the `generate` Edge Function and return parsed slides with image data
 * URLs ready to render.
 */
export async function generateDeck(req: GenerateRequest): Promise<GenerateResult> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Supabase is not configured");
  }
  const url = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/generate`;

  const chatModel =
    (req.models?.research_agent ?? req.models?.design_agent ?? "google/gemini-2.5-flash")
      .replace(/^google\//, "");
  const imageModel =
    (req.models?.t2i_model ?? "google/imagen-4.0-generate-001").replace(/^google\//, "");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Supabase verify_jwt=false on `generate`, but we still pass the anon
      // key as apikey so the function shows up in dashboard metrics.
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      prompt: req.prompt,
      slide_count: req.slideCount,
      include_images: req.includeImages,
      language: req.language ?? "ko",
      deck_type: req.deckType ?? "generic",
      chat_model: chatModel,
      image_model: imageModel,
      attachments: req.attachments ?? [],
    }),
  });
  if (!res.ok) {
    let detail = `generate failed: ${res.status}`;
    try {
      const j = await res.json();
      detail = j?.error?.message ?? detail;
    } catch {
      // swallow
    }
    throw new Error(detail);
  }
  const json = (await res.json()) as {
    slide_count: number;
    provider?: GenerateProvider;
    note?: string;
    sample_mode?: boolean;
    deck_type?: DeckType;
    slides: Array<{
      kind?: SlideKind;
      title: string;
      bullets: string[];
      notes?: string;
      imagePrompt?: string;
      imageB64?: string | null;
      imageStyle?: ImageStyle;
      layoutVariant?: LayoutVariant;
      diagram?: string;
      sources?: Array<{ label: string; url?: string }>;
    }>;
  };

  // Anthropic returns SVG covers; Google returns PNG. Detect by base64
  // header so the browser gets the right content-type in the data URL.
  const slides: SlideData[] = json.slides.map((s, i) => {
    let url: string | undefined;
    if (s.imageB64) {
      const isSvg = s.imageB64.startsWith("PD94bWwg") || s.imageB64.startsWith("PHN2Zy");
      url = isSvg
        ? `data:image/svg+xml;base64,${s.imageB64}`
        : `data:image/png;base64,${s.imageB64}`;
    }
    return {
      index: i,
      kind: s.kind ?? (i === 0 ? "cover" : "content"),
      title: s.title,
      bullets: s.bullets ?? [],
      notes: s.notes,
      imagePrompt: s.imagePrompt,
      imageUrl: url,
      imageStyle: s.imageStyle,
      layoutVariant: s.layoutVariant,
      diagram: s.diagram,
      sources: s.sources?.filter((src) => src?.label),
    };
  });

  const provider: GenerateProvider = json.provider ?? (json.sample_mode ? "sample" : "google");
  return {
    slide_count: json.slide_count,
    slides,
    provider,
    deck_type: json.deck_type,
    note: json.note,
    sample_mode: provider === "sample",
  };
}

// ---------------------------------------------------------------------------
// Single-slide image regeneration via the /regenerate-image edge function.
// ---------------------------------------------------------------------------

export interface RegenerateImageInput {
  title: string;
  bullets: string[];
  imagePrompt?: string;
  imageStyle?: ImageStyle;
  kind: SlideKind;
}

/** Calls the edge function and returns a data URL ready for <img src=...>. */
export async function regenerateSlideImage(input: RegenerateImageInput): Promise<string> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Supabase is not configured");
  }
  const url = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/regenerate-image`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new Error(`이미지 재생성 실패: ${res.status} ${body}`);
  }
  const data = (await res.json()) as { b64?: string; error?: string };
  if (!data.b64) throw new Error(data.error ?? "이미지 재생성 실패");
  return `data:image/png;base64,${data.b64}`;
}

/** Read an uploaded image File and return a PNG/JPEG data URL. */
export async function imageFileToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("이미지 파일만 업로드할 수 있습니다");
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error("이미지가 8MB 를 초과합니다");
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("이미지를 읽지 못했습니다"));
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Attachment loader - reads a File into the AttachmentPayload shape the Edge
// Function expects (text excerpt or base64 image).
// ---------------------------------------------------------------------------

const MAX_TEXT_BYTES = 128 * 1024; // 128 KB - keeps prompt size sane
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB per image

export async function fileToAttachment(file: File): Promise<AttachmentPayload> {
  const mime = file.type || "application/octet-stream";
  if (mime.startsWith("image/")) {
    if (file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name}: 이미지가 4MB 를 초과합니다`);
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // Avoid calling String.fromCharCode on the whole array (stack overflow on
    // large files) - chunk it.
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
    }
    return { name: file.name, mime_type: mime, image_b64: btoa(binary) };
  }

  // Treat everything non-image as best-effort text extraction. PDFs will come
  // through as garbled bytes, but text/markdown/csv/json all work fine.
  const slice = file.slice(0, MAX_TEXT_BYTES);
  const text = await slice.text();
  return { name: file.name, mime_type: mime, text };
}
