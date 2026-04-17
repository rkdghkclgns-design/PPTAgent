/**
 * FastAPI client.
 *
 * We use a single-origin convention: `NEXT_PUBLIC_API_ORIGIN` in .env, or the
 * Next rewrite under /proxy/* in dev. SSE is preferred for streaming since it
 * works over standard fetch and survives proxies better than WebSocket.
 */

import type { ModelSlot } from "./models";

/**
 * Resolve the FastAPI origin.
 *
 * - In dev we can use the relative `/proxy` path because next.config.mjs
 *   rewrites it to `http://localhost:7870`.
 * - In `next export` builds (GitHub Pages), rewrites are ignored, so
 *   NEXT_PUBLIC_API_ORIGIN must be a fully qualified URL baked in at
 *   build time.
 */
const DEFAULT_API_ORIGIN =
  process.env.NEXT_PUBLIC_API_ORIGIN ||
  (process.env.NODE_ENV === "production" ? "" : "/proxy");

export type ModelOverrides = Partial<Record<ModelSlot, string>>;

export interface GenerateRequest {
  prompt: string;
  attachments?: string[];
  pages?: string | null;
  models?: ModelOverrides;
  output_name?: string;
}

export interface GenerateJob {
  job_id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  workspace: string;
  created_at: number;
}

export interface GenerateEvent {
  job_id: string;
  stage:
    | "research"
    | "outline"
    | "design"
    | "render"
    | "export"
    | "upload"
    | "done"
    | "error"
    | "log";
  message: string;
  percent?: number;
  slide_index?: number;
  slide_preview_url?: string;
  pptx_url?: string;
  error?: string;
}

export interface ModelCatalogResponse {
  models: Array<{
    id: string;
    label: string;
    kind: "chat" | "vision" | "image";
    family: "google";
    default_for: string[];
    notes?: string | null;
  }>;
  defaults: Record<ModelSlot, string>;
}

function url(path: string): string {
  const origin = DEFAULT_API_ORIGIN.replace(/\/$/, "");
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Ping /health with a short timeout. Returns true iff the FastAPI server is
 * reachable and responds with a 2xx. Used by the Studio to decide whether to
 * submit the real job or fall back to the demo stream.
 */
export async function isApiReachable(timeoutMs = 2500): Promise<boolean> {
  if (!process.env.NEXT_PUBLIC_API_ORIGIN && typeof window !== "undefined") {
    // On a static export without a configured origin, there's nothing to ping.
    return false;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url("/health"), { signal: ctrl.signal, cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchModels(): Promise<ModelCatalogResponse> {
  const res = await fetch(url("/models"), { cache: "no-store" });
  if (!res.ok) throw new Error(`models fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchReadiness(): Promise<Record<string, unknown>> {
  const res = await fetch(url("/readiness"), { cache: "no-store" });
  if (!res.ok) throw new Error(`readiness fetch failed: ${res.status}`);
  return res.json();
}

export async function createJob(req: GenerateRequest): Promise<GenerateJob> {
  const res = await fetch(url("/generate"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`createJob failed: ${res.status} ${text}`);
  }
  return res.json();
}

/**
 * Subscribe to SSE events for a running job.
 *
 * Returns a handle with two ways to stop: `.abort()` (AbortController-like
 * surface) and the underlying `.source` for callers that want to inspect
 * `readyState`. Calling `.abort()` is idempotent and safe to run inside a
 * React useEffect cleanup even after the stream has already ended.
 *
 * A terminal event (`done` or `error`) closes the stream on its own, but
 * clients should STILL call `.abort()` on unmount to cover the case where
 * the component is torn down mid-flight.
 */
export interface EventStreamHandle {
  abort: () => void;
  readonly aborted: boolean;
  readonly source: EventSource;
}

export function streamEvents(
  jobId: string,
  onEvent: (ev: GenerateEvent) => void,
  onError?: (err: unknown) => void,
): EventStreamHandle {
  const source = new EventSource(url(`/generate/${jobId}/events`));
  let aborted = false;

  const close = () => {
    if (aborted) return;
    aborted = true;
    source.close();
  };

  source.onmessage = (e) => {
    if (aborted) return;
    try {
      const payload: GenerateEvent = JSON.parse(e.data);
      onEvent(payload);
      if (payload.stage === "done" || payload.stage === "error") close();
    } catch (err) {
      onError?.(err);
    }
  };
  source.onerror = (err) => {
    if (aborted) return;
    onError?.(err);
    close();
  };

  return {
    abort: close,
    get aborted() {
      return aborted;
    },
    get source() {
      return source;
    },
  };
}

export async function uploadAttachment(file: File): Promise<{ object_path: string; signed_url: string }> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(url("/generate/attachment"), { method: "POST", body });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return res.json();
}
