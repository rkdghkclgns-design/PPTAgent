"""/models endpoint - static catalog of Google models for the dropdown.

The frontend calls this once on load to hydrate the model selector. Defaults
map onto deeppresenter's config sections so the user understands which slot
each model fills.
"""

from __future__ import annotations

from fastapi import APIRouter

from ..schemas import ModelCatalog, ModelKind, ModelOption
from ..settings import get_settings

router = APIRouter(tags=["models"])


GOOGLE_MODELS: list[ModelOption] = [
    ModelOption(
        id="google/gemini-2.5-flash-image",
        label="Gemini 2.5 Flash Image (나노바나나)",
        kind=ModelKind.image,
        default_for=["t2i_model"],
        notes="모든 슬라이드 이미지를 단일 모델로 생성 — 톤·품질이 일관됨.",
    ),
    ModelOption(
        id="google/gemini-2.0-flash",
        label="Gemini 2.0 Flash",
        kind=ModelKind.chat,
        default_for=["research_agent"],
        notes="리서치 단계 기본 텍스트 모델. 빠르고 저렴.",
    ),
    ModelOption(
        id="google/gemini-2.5-flash",
        label="Gemini 2.5 Flash",
        kind=ModelKind.chat,
        default_for=["long_context_model"],
        notes="긴 문맥 처리용.",
    ),
    ModelOption(
        id="google/gemini-2.5-pro",
        label="Gemini 2.5 Pro",
        kind=ModelKind.chat,
        default_for=["design_agent"],
        notes="디자인 에이전트 고품질 모드.",
    ),
    ModelOption(
        id="google/gemini-2.0-flash-vision",
        label="Gemini 2.0 Flash Vision",
        kind=ModelKind.vision,
        default_for=["vision_model"],
        notes="비전 모델 - 참조 슬라이드 이미지 분석.",
    ),
]


@router.get("/models", response_model=ModelCatalog)
async def list_models() -> ModelCatalog:
    s = get_settings()
    return ModelCatalog(
        models=GOOGLE_MODELS,
        defaults={
            "t2i_model": s.default_t2i_model,
            "research_agent": s.default_chat_model,
            "long_context_model": s.default_long_context_model,
            "vision_model": s.default_vision_model,
            "design_agent": s.default_design_model,
        },
    )
