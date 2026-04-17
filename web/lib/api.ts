/**
 * FastAPI client.
 *
 * We use a single-origin convention: `NEXT_PUBLIC_API_ORIGIN` in .env, or the
 * Next rewrite under /proxy/* in dev. SSE is preferred for streaming since it
 * works over standard fetch and survives proxies better than WebSocket.
 */

import type { ModelSlot } from "./models";

const DEFAULT_API_ORIGIN =
  process.env.NEXT_PUBLIC_API_ORIGIN || "/proxy";

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
 * Subscribe to SSE events for a running job. Returns an AbortController whose
 * `abort()` method cleanly tears down the connection.
 */
export function streamEvents(
  jobId: string,
  onEvent: (ev: GenerateEvent) => void,
  onError?: (err: unknown) => void,
): AbortController {
  const controller = new AbortController();
  const evs = new EventSource(url(`/generate/${jobId}/events`));

  evs.onmessage = (e) => {
    try {
      const payload: GenerateEvent = JSON.parse(e.data);
      onEvent(payload);
      if (payload.stage === "done" || payload.stage === "error") evs.close();
    } catch (err) {
      onError?.(err);
    }
  };
  evs.onerror = (err) => {
    onError?.(err);
    evs.close();
  };
  controller.signal.addEventListener("abort", () => evs.close(), { once: true });
  return controller;
}

export async function uploadAttachment(file: File): Promise<{ object_path: string; signed_url: string }> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(url("/generate/attachment"), { method: "POST", body });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return res.json();
}
