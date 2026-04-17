"""Environment-backed settings for the FastAPI wrapper.

Everything that the web layer needs to know about Supabase and the sandbox
workspace lives here. The Google API key is *never* loaded on this side - it
stays in the Supabase Edge Function's secret store.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings for the API server."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- Supabase ------------------------------------------------------------
    supabase_url: str = Field(default="", description="Supabase project URL")
    supabase_service_role_key: str = Field(
        default="", description="Service role key - server-side only"
    )
    supabase_edge_function_url: str = Field(
        default="",
        description="Fully-qualified URL of the deployed llm-proxy Edge Function",
    )
    supabase_storage_bucket: str = Field(default="presentations")

    # --- PPTAgent runtime ----------------------------------------------------
    workspace_base: Path = Field(
        default=Path.home() / ".cache" / "deeppresenter",
        description="Root folder where AgentLoop writes per-run artifacts",
    )
    offline_mode: bool = Field(default=False)

    # --- Model defaults (overridable per request) ----------------------------
    default_t2i_model: str = Field(default="google/imagen-3.0-generate-002")
    default_chat_model: str = Field(default="google/gemini-2.0-flash")
    default_long_context_model: str = Field(default="google/gemini-2.5-flash")
    default_vision_model: str = Field(default="google/gemini-2.0-flash-vision")
    default_design_model: str = Field(default="google/gemini-2.5-pro")

    # --- Auth ---------------------------------------------------------------
    auth_enabled: bool = Field(
        default=True,
        description="When false, JWT verification is skipped - dev only.",
    )

    # --- Server --------------------------------------------------------------
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:3000",
            "https://rkdghkclgns-design.github.io",
        ],
        description="Browsers allowed to call the API. Production MUST include the deployed frontend origin.",
    )
    cors_allow_methods: list[str] = Field(
        default_factory=lambda: ["GET", "POST", "OPTIONS"]
    )
    cors_allow_headers: list[str] = Field(
        default_factory=lambda: ["authorization", "content-type", "x-requested-with"]
    )
    max_upload_mb: int = Field(default=50)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
