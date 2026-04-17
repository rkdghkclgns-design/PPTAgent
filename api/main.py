"""FastAPI entrypoint.

Run locally:
    uv pip install -r api/requirements.txt
    uvicorn api.main:app --reload --port 7870

Run in Docker (Railway / Fly):
    docker build -f api/Dockerfile -t pptagent-api .
    docker run -p 7870:7870 --env-file .env pptagent-api
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core import AgentBridge
from .routes import generate, health, models
from .settings import get_settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s | %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    settings.workspace_base.mkdir(parents=True, exist_ok=True)
    app.state.bridge = AgentBridge(settings)
    await app.state.bridge.start_background_tasks()
    logging.getLogger("api").info(
        "FastAPI ready - workspace=%s edge_url=%s auth=%s",
        settings.workspace_base,
        settings.supabase_edge_function_url or "<unset>",
        "on" if settings.auth_enabled else "OFF",
    )
    try:
        yield
    finally:
        await app.state.bridge.close()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="PPTAgent Web API",
        version="0.1.0",
        description=(
            "Thin wrapper around deeppresenter.main.AgentLoop. "
            "All LLM calls flow through the Supabase llm-proxy Edge Function "
            "so the Google API key never touches this server."
        ),
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=settings.cors_allow_methods,
        allow_headers=settings.cors_allow_headers,
        max_age=3600,
    )
    app.include_router(health.router)
    app.include_router(models.router)
    app.include_router(generate.router)
    return app


app = create_app()
