// Supabase Edge Function: llm-proxy
//
// Centralised proxy for all Google API calls. The API key never leaves this
// function - neither the browser nor the FastAPI server sees it. FastAPI
// forwards OpenAI-compatible chat/image requests here, the function fans them
// out to the correct Google endpoint (Gemini for chat/vision, Imagen for T2I),
// and returns an OpenAI-shaped response so `deeppresenter` can consume it
// without modification.
//
// Deployment:
//   supabase functions deploy llm-proxy --project-ref <ref>
//   supabase secrets set GOOGLE_API_KEY=<key> --project-ref <ref>
//
// Accepted request body (OpenAI-style):
//   { model: string, messages?: ChatMessage[], prompt?: string,
//     temperature?: number, max_tokens?: number, response_format?: any, n?: number }
//
// Routing rules (model id -> Google endpoint):
//   google/imagen-*              -> Imagen T2I (default for t2i_model)
//   google/gemini-*-vision       -> Gemini generateContent with inlineData parts
//   google/gemini-*              -> Gemini generateContent (text)
//   <any other>                  -> 400 (unsupported)

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const GOOGLE_API_KEY = Deno.env.get("GOOGLE_API_KEY") ?? "";
const GENAI_BASE = "https://generativelanguage.googleapis.com/v1beta";

// Fail loudly on cold start so misconfiguration shows up in the deploy log.
if (!GOOGLE_API_KEY) {
  console.error("llm-proxy: GOOGLE_API_KEY is not set - requests will 500");
}

// ----------------------------------------------------------------------------
// CORS / auth helpers
// ----------------------------------------------------------------------------

// Allow-list of browser origins. The FastAPI server (server-to-server) does
// not trigger CORS, so keep this list tight.
const ALLOWED_ORIGINS = new Set(
  (Deno.env.get("ALLOWED_ORIGINS") ?? "https://rkdghkclgns-design.github.io,http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

function corsHeaders(origin: string | null): HeadersInit {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "null";
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "3600",
  };
}

function json(body: unknown, origin: string | null, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...corsHeaders(origin), "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function bad(origin: string | null, status: number, message: string, details?: unknown): Response {
  // Upstream error bodies can leak infrastructure metadata; keep the reply
  // generic for untrusted callers and log the raw body for the operator.
  if (details) console.warn("llm-proxy error detail", { status, message, details });
  return json({ error: { message, status } }, origin, { status });
}

// ----------------------------------------------------------------------------
// OpenAI <-> Google Gemini translation
// ----------------------------------------------------------------------------

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
};

// Hosts whose images we trust to hand to Gemini as a fileUri. Anything outside
// this allowlist is dropped to stop callers from using this function as an
// SSRF proxy into internal networks.
const TRUSTED_IMAGE_HOSTS = /^(?:[a-z0-9-]+\.)*(?:supabase\.co|supabase\.in|githubusercontent\.com|unsplash\.com|googleusercontent\.com)$/i;

function toGeminiParts(content: ChatMessage["content"]): any[] {
  if (typeof content === "string") return [{ text: content }];
  const parts: any[] = [];
  for (const chunk of content) {
    if (chunk.type === "text" && chunk.text) {
      parts.push({ text: chunk.text });
    } else if (chunk.type === "image_url" && chunk.image_url?.url) {
      const url = chunk.image_url.url;
      if (url.startsWith("data:")) {
        const [meta, data] = url.slice(5).split(",", 2);
        const mimeType = meta.split(";")[0] || "image/png";
        parts.push({ inlineData: { mimeType, data } });
      } else {
        try {
          const parsed = new URL(url);
          if (parsed.protocol !== "https:" || !TRUSTED_IMAGE_HOSTS.test(parsed.hostname)) {
            console.warn("llm-proxy: dropped untrusted image_url", parsed.hostname);
            continue;
          }
          parts.push({ fileData: { mimeType: "image/*", fileUri: url } });
        } catch {
          // malformed URL - skip
        }
      }
    }
  }
  return parts;
}

function messagesToGemini(messages: ChatMessage[]): { systemInstruction?: any; contents: any[] } {
  const contents: any[] = [];
  let systemInstruction: any | undefined;
  for (const m of messages) {
    if (m.role === "system") {
      // Gemini's systemInstruction field doesn't take a `role` key - just parts.
      systemInstruction = { parts: toGeminiParts(m.content) };
      continue;
    }
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: toGeminiParts(m.content),
    });
  }
  return { systemInstruction, contents };
}

function geminiToOpenAI(model: string, resp: any): any {
  const candidate = resp?.candidates?.[0];
  const text = candidate?.content?.parts
    ?.map((p: any) => p.text ?? "")
    .filter(Boolean)
    .join("") ?? "";
  return {
    id: `chatcmpl-${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: candidate?.finishReason?.toLowerCase() ?? "stop",
      },
    ],
    usage: {
      prompt_tokens: resp?.usageMetadata?.promptTokenCount ?? 0,
      completion_tokens: resp?.usageMetadata?.candidatesTokenCount ?? 0,
      total_tokens: resp?.usageMetadata?.totalTokenCount ?? 0,
    },
  };
}

// ----------------------------------------------------------------------------
// Endpoint handlers
// ----------------------------------------------------------------------------

const googleAuthHeaders = (): HeadersInit => ({
  "content-type": "application/json",
  // Use a header instead of ?key=... to keep the API key out of URL-based logs.
  "x-goog-api-key": GOOGLE_API_KEY,
});

async function handleChat(origin: string | null, model: string, body: any): Promise<Response> {
  const googleModel = model.replace(/^google\//, "");
  const { systemInstruction, contents } = messagesToGemini(body.messages ?? []);
  const payload: any = {
    contents,
    generationConfig: {
      temperature: body.temperature,
      maxOutputTokens: body.max_tokens,
      responseMimeType: body.response_format?.type === "json_object" ? "application/json" : undefined,
    },
  };
  if (systemInstruction) payload.systemInstruction = systemInstruction;

  const url = `${GENAI_BASE}/models/${encodeURIComponent(googleModel)}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: googleAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) return bad(origin, res.status, "gemini upstream error", await res.text());
  const data = await res.json();
  return json(geminiToOpenAI(model, data), origin);
}

async function handleImage(origin: string | null, model: string, body: any): Promise<Response> {
  const googleModel = model.replace(/^google\//, "");
  const prompt = body.prompt ??
    (Array.isArray(body.messages) ? body.messages.at(-1)?.content : "") ?? "";
  if (!prompt) return bad(origin, 400, "prompt is required for image models");

  const payload = {
    instances: [{ prompt }],
    parameters: {
      sampleCount: body.n ?? 1,
      aspectRatio: body.aspect_ratio ?? "16:9",
      safetyFilterLevel: "block_few",
      personGeneration: "allow_adult",
    },
  };
  const url = `${GENAI_BASE}/models/${encodeURIComponent(googleModel)}:predict`;
  const res = await fetch(url, {
    method: "POST",
    headers: googleAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) return bad(origin, res.status, "imagen upstream error", await res.text());
  const data = await res.json();
  const predictions = data?.predictions ?? [];
  return json({
    created: Math.floor(Date.now() / 1000),
    model,
    data: predictions.map((p: any) => ({
      b64_json: p?.bytesBase64Encoded ?? null,
      revised_prompt: p?.prompt ?? prompt,
    })),
  }, origin);
}

// ----------------------------------------------------------------------------
// Router
// ----------------------------------------------------------------------------

function routeModel(model: string): "chat" | "image" | null {
  if (!model) return null;
  const m = model.toLowerCase();
  if (m.startsWith("google/imagen") || m.includes("imagegeneration")) return "image";
  if (m.startsWith("google/gemini")) return "chat";
  return null;
}

serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });
  if (req.method !== "POST") return bad(origin, 405, "method not allowed");
  if (!GOOGLE_API_KEY) return bad(origin, 500, "GOOGLE_API_KEY secret is not configured");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad(origin, 400, "invalid JSON body");
  }
  const model = String(body.model ?? "");
  const kind = routeModel(model);
  if (!kind) return bad(origin, 400, `unsupported model "${model}"`);

  try {
    return kind === "image"
      ? await handleImage(origin, model, body)
      : await handleChat(origin, model, body);
  } catch (err) {
    return bad(origin, 500, "proxy exception", String(err));
  }
});
