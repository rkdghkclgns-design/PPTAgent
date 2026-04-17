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

// ----------------------------------------------------------------------------
// CORS / auth helpers
// ----------------------------------------------------------------------------

const CORS_HEADERS: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...CORS_HEADERS, "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function bad(status: number, message: string, details?: unknown): Response {
  return json({ error: { message, status, details } }, { status });
}

// ----------------------------------------------------------------------------
// OpenAI <-> Google Gemini translation
// ----------------------------------------------------------------------------

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
};

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
        parts.push({ fileData: { mimeType: "image/*", fileUri: url } });
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
      systemInstruction = { role: "user", parts: toGeminiParts(m.content) };
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

async function handleChat(model: string, body: any): Promise<Response> {
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

  const url = `${GENAI_BASE}/models/${encodeURIComponent(googleModel)}:generateContent?key=${GOOGLE_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return bad(res.status, "gemini upstream error", await res.text());
  const data = await res.json();
  return json(geminiToOpenAI(model, data));
}

async function handleImage(model: string, body: any): Promise<Response> {
  const googleModel = model.replace(/^google\//, "");
  const prompt = body.prompt ??
    (Array.isArray(body.messages) ? body.messages.at(-1)?.content : "") ?? "";
  if (!prompt) return bad(400, "prompt is required for image models");

  const payload = {
    instances: [{ prompt }],
    parameters: {
      sampleCount: body.n ?? 1,
      aspectRatio: body.aspect_ratio ?? "16:9",
      safetyFilterLevel: "block_few",
      personGeneration: "allow_adult",
    },
  };
  const url = `${GENAI_BASE}/models/${encodeURIComponent(googleModel)}:predict?key=${GOOGLE_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return bad(res.status, "imagen upstream error", await res.text());
  const data = await res.json();
  const predictions = data?.predictions ?? [];
  return json({
    created: Math.floor(Date.now() / 1000),
    model,
    data: predictions.map((p: any) => ({
      b64_json: p?.bytesBase64Encoded ?? null,
      revised_prompt: p?.prompt ?? prompt,
    })),
  });
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
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return bad(405, "method not allowed");
  if (!GOOGLE_API_KEY) return bad(500, "GOOGLE_API_KEY secret is not configured");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad(400, "invalid JSON body");
  }
  const model = String(body.model ?? "");
  const kind = routeModel(model);
  if (!kind) return bad(400, `unsupported model "${model}"`);

  try {
    return kind === "image" ? await handleImage(model, body) : await handleChat(model, body);
  } catch (err) {
    return bad(500, "proxy exception", String(err));
  }
});
