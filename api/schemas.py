"""Pydantic schemas shared by routes and bridge."""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class ModelKind(str, Enum):
    chat = "chat"
    vision = "vision"
    image = "image"


class ModelOption(BaseModel):
    """A single selectable model entry for the frontend dropdown."""

    id: str
    label: str
    kind: ModelKind
    family: Literal["google"] = "google"
    default_for: list[str] = Field(default_factory=list)
    notes: str | None = None


class ModelCatalog(BaseModel):
    models: list[ModelOption]
    defaults: dict[str, str]


class ModelOverrides(BaseModel):
    """Optional per-request model overrides.

    If a field is None, the FastAPI default from `Settings` is used. These
    names map 1:1 onto the sections of `deeppresenter/config.yaml`.
    """

    research_agent: str | None = None
    design_agent: str | None = None
    long_context_model: str | None = None
    vision_model: str | None = None
    t2i_model: str | None = None


class GenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=2, max_length=8000)
    attachments: list[str] = Field(
        default_factory=list,
        description="Supabase Storage object paths already uploaded by the client",
    )
    pages: str | None = Field(
        default=None,
        description='Page range for PDF attachments, e.g. "10-12"',
    )
    models: ModelOverrides = Field(default_factory=ModelOverrides)
    output_name: str = Field(default="presentation.pptx")


class GenerateJob(BaseModel):
    job_id: str
    status: Literal["queued", "running", "succeeded", "failed"]
    workspace: str
    created_at: float


class GenerateEvent(BaseModel):
    """One streamed progress event."""

    job_id: str
    stage: Literal[
        "research",
        "outline",
        "design",
        "render",
        "export",
        "upload",
        "done",
        "error",
        "log",
    ]
    message: str
    percent: float | None = None
    slide_index: int | None = None
    slide_preview_url: str | None = None
    pptx_url: str | None = None
    error: str | None = None
