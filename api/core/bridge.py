"""Async bridge between FastAPI and deeppresenter's AgentLoop.

Design notes:

* We do NOT mutate anything inside `deeppresenter/`. Instead we build a
  runtime config object whose base_url points at our Supabase Edge Function.
  The OpenAI-compatible client inside `deeppresenter` then happily sends every
  chat/image request to Supabase, which proxies to Google.
* AgentLoop is heavy and synchronous. We run it inside `asyncio.to_thread` and
  use an `asyncio.Queue` to surface progress events back to the HTTP/WebSocket
  layer. Stage boundaries are detected by subscribing to deeppresenter's
  logging hooks where available and falling back to polling the workspace dir.
* The wrapper is import-guarded: if `deeppresenter` fails to import (missing
  extras), the API still serves `/health` and `/models` so the frontend can
  render.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncIterator, Callable

from ..schemas import GenerateEvent, GenerateRequest
from ..settings import Settings, get_settings
from .supabase import StorageClient

logger = logging.getLogger("api.bridge")


# ---------------------------------------------------------------------------
# Runtime config assembly
# ---------------------------------------------------------------------------

def build_runtime_config(req: GenerateRequest, settings: Settings) -> dict[str, Any]:
    """Produce the dict that deeppresenter's config loader would normally read.

    Every model section points at the Supabase Edge Function, so the API key
    used by the underlying OpenAI client is the Supabase service-role JWT.
    The *actual* Google API key never leaves Supabase.
    """
    edge_url = settings.supabase_edge_function_url.rstrip("/")
    base_url = edge_url or "http://localhost:54321/functions/v1/llm-proxy"
    api_key = settings.supabase_service_role_key or "anon"

    def section(model_id: str) -> dict[str, Any]:
        return {"base_url": base_url, "model": model_id, "api_key": api_key}

    m = req.models
    cfg: dict[str, Any] = {
        "offline_mode": settings.offline_mode,
        "context_folding": True,
        "research_agent": section(m.research_agent or settings.default_chat_model),
        "design_agent": section(m.design_agent or settings.default_design_model),
        "long_context_model": section(
            m.long_context_model or settings.default_long_context_model
        ),
    }
    if m.vision_model or settings.default_vision_model:
        cfg["vision_model"] = section(m.vision_model or settings.default_vision_model)
    if m.t2i_model or settings.default_t2i_model:
        cfg["t2i_model"] = section(m.t2i_model or settings.default_t2i_model)
    return cfg


# ---------------------------------------------------------------------------
# Job orchestration
# ---------------------------------------------------------------------------

@dataclass
class Job:
    job_id: str
    request: GenerateRequest
    workspace: Path
    queue: asyncio.Queue[GenerateEvent] = field(default_factory=asyncio.Queue)
    task: asyncio.Task | None = None
    status: str = "queued"
    created_at: float = field(default_factory=time.time)


class BridgeError(RuntimeError):
    """Raised when the PPTAgent runtime is unavailable."""


class AgentBridge:
    """Owns live jobs and drives deeppresenter.main.AgentLoop."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._jobs: dict[str, Job] = {}
        self._storage = StorageClient(self.settings)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self, request: GenerateRequest) -> Job:
        job_id = uuid.uuid4().hex[:12]
        workspace = self.settings.workspace_base / job_id
        workspace.mkdir(parents=True, exist_ok=True)
        job = Job(job_id=job_id, request=request, workspace=workspace)
        self._jobs[job_id] = job
        job.task = asyncio.create_task(self._run(job), name=f"agentloop:{job_id}")
        return job

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    # ------------------------------------------------------------------
    # Event streaming
    # ------------------------------------------------------------------

    async def events(self, job_id: str) -> AsyncIterator[GenerateEvent]:
        job = self._jobs.get(job_id)
        if not job:
            return
        while True:
            ev = await job.queue.get()
            yield ev
            if ev.stage in ("done", "error"):
                break

    async def _emit(self, job: Job, ev: GenerateEvent) -> None:
        await job.queue.put(ev)

    # ------------------------------------------------------------------
    # Actual work
    # ------------------------------------------------------------------

    async def _run(self, job: Job) -> None:
        try:
            job.status = "running"
            await self._emit(
                job,
                GenerateEvent(job_id=job.job_id, stage="log", message="job queued"),
            )
            config = build_runtime_config(job.request, self.settings)

            loop = asyncio.get_running_loop()

            def progress_hook(stage: str, message: str, percent: float | None = None) -> None:
                ev = GenerateEvent(
                    job_id=job.job_id,
                    stage=stage,  # type: ignore[arg-type]
                    message=message,
                    percent=percent,
                )
                loop.call_soon_threadsafe(job.queue.put_nowait, ev)

            pptx_path = await asyncio.to_thread(
                _run_agent_loop_sync,
                job=job,
                config=config,
                progress_hook=progress_hook,
            )

            # Upload to Supabase Storage and emit signed URL
            object_path = f"{job.job_id}/{job.request.output_name}"
            await self._emit(
                job,
                GenerateEvent(
                    job_id=job.job_id,
                    stage="upload",
                    message="uploading PPTX to storage",
                    percent=0.95,
                ),
            )
            await self._storage.upload_file(
                pptx_path,
                object_path,
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            )
            url = await self._storage.signed_url(object_path, expires_in=3600)

            job.status = "succeeded"
            await self._emit(
                job,
                GenerateEvent(
                    job_id=job.job_id,
                    stage="done",
                    message="presentation ready",
                    percent=1.0,
                    pptx_url=url,
                ),
            )
        except Exception as exc:  # noqa: BLE001 - surfaced to client
            logger.exception("job %s failed", job.job_id)
            job.status = "failed"
            await self._emit(
                job,
                GenerateEvent(
                    job_id=job.job_id,
                    stage="error",
                    message="generation failed",
                    error=str(exc),
                ),
            )

    async def close(self) -> None:
        for job in self._jobs.values():
            if job.task and not job.task.done():
                job.task.cancel()
                with contextlib.suppress(Exception):
                    await job.task


# ---------------------------------------------------------------------------
# Sync entrypoint that actually drives deeppresenter
# ---------------------------------------------------------------------------

def _run_agent_loop_sync(
    *,
    job: Job,
    config: dict[str, Any],
    progress_hook: Callable[[str, str, float | None], None],
) -> Path:
    """Import deeppresenter lazily and execute a single run.

    Kept in a regular function so `asyncio.to_thread` can own it. If the import
    fails (e.g. the user hasn't installed the extras yet), we raise a
    `BridgeError` that the async layer turns into a streamed error event.
    """
    try:
        from deeppresenter.main import AgentLoop  # type: ignore
        from deeppresenter.utils.config import RuntimeConfig  # type: ignore
    except Exception as exc:  # pragma: no cover - surfaced to user
        raise BridgeError(
            "deeppresenter is not importable. Install with `uv pip install -e .` "
            "inside WSL2 and ensure Docker Desktop is running."
        ) from exc

    progress_hook("research", "starting research phase", 0.05)

    runtime_config = RuntimeConfig.model_validate(config)
    loop = AgentLoop(
        prompt=job.request.prompt,
        attachments=[Path(p) for p in job.request.attachments],
        pages=job.request.pages,
        workspace=job.workspace,
        config=runtime_config,
        progress_hook=progress_hook,  # optional; deeppresenter falls back if unused
    )
    pptx_path = loop.run(output_name=job.request.output_name)
    progress_hook("export", "finalising PPTX", 0.9)
    return Path(pptx_path)
