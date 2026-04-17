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

/** Shape the Edge Function expects on the wire. */
export interface AttachmentPayload {
  name: string;
  mime_type: string;
  /** Plain-text contents for text/* attachments. */
  text?: string;
  /** Base64 (no data: prefix) for image/* attachments. */
  image_b64?: string;
}

export interface GenerateRequest {
  prompt: string;
  slideCount: number;
  includeImages: boolean;
  language?: "ko" | "en";
  models?: ModelOverrides;
  attachments?: AttachmentPayload[];
}

export interface SlideData {
  index: number;
  title: string;
  bullets: string[];
  notes?: string;
  imagePrompt?: string;
  /** Data URL ready for <img src=...> when present. */
  imageUrl?: string;
}

export type GenerateProvider = "google" | "anthropic" | "sample";

export interface GenerateResult {
  slide_count: number;
  slides: SlideData[];
  /** Which backend actually produced the content. */
  provider: GenerateProvider;
  /** Human-readable note - most useful when provider === "sample" and we
   *  need to surface the underlying API failure. */
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
    (req.models?.research_agent ?? req.models?.design_agent ?? "google/gemini-2.0-flash")
      .replace(/^google\//, "");
  const imageModel =
    (req.models?.t2i_model ?? "google/imagen-3.0-generate-002").replace(/^google\//, "");

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
    slides: Array<{
      title: string;
      bullets: string[];
      notes?: string;
      imagePrompt?: string;
      imageB64?: string | null;
    }>;
  };

  // Anthropic returns SVG covers; Google returns PNG. Use a generic
  // image/* data URL so the browser sniffs by content.
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
      title: s.title,
      bullets: s.bullets ?? [],
      notes: s.notes,
      imagePrompt: s.imagePrompt,
      imageUrl: url,
    };
  });

  const provider: GenerateProvider = json.provider ?? (json.sample_mode ? "sample" : "google");
  return {
    slide_count: json.slide_count,
    slides,
    provider,
    note: json.note,
    sample_mode: provider === "sample",
  };
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
