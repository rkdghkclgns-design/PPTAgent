"""/generate (SSE) and /generate/ws (WebSocket) endpoints.

The frontend may use either transport. SSE is simpler and plays nicely with
plain `fetch` streaming; WebSocket is used when we need bidirectional
messages (cancel, resume, attachment chunking) later.
"""

from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from sse_starlette.sse import EventSourceResponse

from ..core import AgentBridge
from ..schemas import GenerateJob, GenerateRequest
from ..settings import Settings, get_settings
from .deps import get_bridge

router = APIRouter(prefix="/generate", tags=["generate"])


@router.post("", response_model=GenerateJob)
async def create_job(
    request: GenerateRequest,
    bridge: AgentBridge = Depends(get_bridge),
) -> GenerateJob:
    job = bridge.start(request)
    return GenerateJob(
        job_id=job.job_id,
        status=job.status,  # type: ignore[arg-type]
        workspace=str(job.workspace),
        created_at=job.created_at,
    )


@router.get("/{job_id}/events")
async def stream_events(
    job_id: str,
    bridge: AgentBridge = Depends(get_bridge),
) -> EventSourceResponse:
    job = bridge.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")

    async def event_gen() -> AsyncIterator[dict[str, str]]:
        async for ev in bridge.events(job_id):
            yield {
                "event": ev.stage,
                "data": ev.model_dump_json(exclude_none=True),
            }

    return EventSourceResponse(event_gen())


@router.websocket("/ws/{job_id}")
async def websocket_events(
    websocket: WebSocket,
    job_id: str,
) -> None:
    bridge: AgentBridge = websocket.app.state.bridge
    await websocket.accept()
    job = bridge.get(job_id)
    if not job:
        await websocket.send_text(json.dumps({"stage": "error", "message": "job not found"}))
        await websocket.close()
        return
    try:
        async for ev in bridge.events(job_id):
            await websocket.send_text(ev.model_dump_json(exclude_none=True))
            if ev.stage in ("done", "error"):
                break
    except WebSocketDisconnect:
        return
    finally:
        with asyncio.suppress(Exception):  # type: ignore[attr-defined]
            await websocket.close()


@router.post("/attachment", tags=["generate"])
async def upload_attachment(
    file: UploadFile,
    settings: Settings = Depends(get_settings),
) -> dict[str, str]:
    """Tiny helper so the frontend can POST files to Supabase Storage via the
    server (keeps the service-role key off the browser)."""

    from ..core.supabase import StorageClient

    if file.size and file.size > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail="attachment too large")
    data = await file.read()
    object_path = f"uploads/{file.filename}"
    client = StorageClient(settings)
    await client.upload(object_path, data, file.content_type or "application/octet-stream")
    signed = await client.signed_url(object_path, expires_in=3600)
    return {"object_path": object_path, "signed_url": signed}
