/**
 * Frontend-side model catalog.
 *
 * Mirrors `api/routes/models.py::GOOGLE_MODELS` so we can render the dropdown
 * even before the API returns. The real defaults always come from the server.
 */

export type ModelKind = "chat" | "vision" | "image";

export interface ModelOption {
  id: string;
  label: string;
  kind: ModelKind;
  family: "google";
  notes?: string;
  defaultFor?: ModelSlot[];
}

export type ModelSlot =
  | "t2i_model"
  | "research_agent"
  | "long_context_model"
  | "vision_model"
  | "design_agent";

export const MODEL_SLOT_LABEL: Record<ModelSlot, string> = {
  t2i_model: "이미지 생성",
  research_agent: "리서치 에이전트",
  long_context_model: "긴 문맥",
  vision_model: "비전 분석",
  design_agent: "디자인 에이전트",
};

export const MODEL_SLOT_HINT: Record<ModelSlot, string> = {
  t2i_model: "슬라이드 커버/일러스트 생성에 사용.",
  research_agent: "프롬프트/첨부파일에서 개요를 뽑는 단계.",
  long_context_model: "원문 전체를 한 번에 읽을 때 사용.",
  vision_model: "참조 슬라이드 이미지 분석.",
  design_agent: "HTML 슬라이드를 설계하는 최종 단계.",
};

/** Default model for each slot — image generation is pinned to the
 *  3.1 preview (next-gen nano-banana) which significantly upgrades the
 *  fidelity over 2.5 Flash Image. */
export const DEFAULT_MODELS: Record<ModelSlot, string> = {
  t2i_model: "google/gemini-3.1-flash-image-preview",
  research_agent: "google/gemini-2.5-flash",
  long_context_model: "google/gemini-2.5-flash",
  vision_model: "google/gemini-2.0-flash-vision",
  design_agent: "google/gemini-2.5-pro",
};

export const GOOGLE_MODELS: ModelOption[] = [
  {
    id: "google/gemini-3.1-flash-image-preview",
    label: "Gemini 3.1 Flash Image (preview · 나노바나나 차세대)",
    kind: "image",
    family: "google",
    defaultFor: ["t2i_model"],
    notes: "차세대 나노바나나. 2.5 대비 디테일·톤 일관성·텍스트 회피가 크게 개선된 프리뷰 모델.",
  },
  {
    id: "google/gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    kind: "chat",
    family: "google",
    defaultFor: ["research_agent"],
    notes: "빠르고 저렴. 리서치 기본값.",
  },
  {
    id: "google/gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    kind: "chat",
    family: "google",
    defaultFor: ["long_context_model"],
    notes: "200k+ 토큰의 긴 컨텍스트 처리.",
  },
  {
    id: "google/gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    kind: "chat",
    family: "google",
    defaultFor: ["design_agent"],
    notes: "최고 품질. 디자인 단계 기본값.",
  },
  {
    id: "google/gemini-2.0-flash-vision",
    label: "Gemini 2.0 Flash Vision",
    kind: "vision",
    family: "google",
    defaultFor: ["vision_model"],
    notes: "참조 슬라이드 이미지 이해.",
  },
];

export function optionsForSlot(slot: ModelSlot): ModelOption[] {
  const kind: ModelKind =
    slot === "t2i_model" ? "image" : slot === "vision_model" ? "vision" : "chat";
  return GOOGLE_MODELS.filter((m) => m.kind === kind);
}
