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

export interface GenerateRequest {
  prompt: string;
  slideCount: number;
  includeImages: boolean;
  language?: "ko" | "en";
  models?: ModelOverrides;
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

export interface GenerateResult {
  slide_count: number;
  slides: SlideData[];
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
    slides: Array<{
      title: string;
      bullets: string[];
      notes?: string;
      imagePrompt?: string;
      imageB64?: string | null;
    }>;
  };

  const slides: SlideData[] = json.slides.map((s, i) => ({
    index: i,
    title: s.title,
    bullets: s.bullets ?? [],
    notes: s.notes,
    imagePrompt: s.imagePrompt,
    imageUrl: s.imageB64 ? `data:image/png;base64,${s.imageB64}` : undefined,
  }));
  return { slide_count: json.slide_count, slides };
}
