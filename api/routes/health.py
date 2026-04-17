"""/health and /readiness endpoints.

Separate from /readiness because Railway/Fly use different semantics - a
passing /health means the process is up, /readiness additionally verifies
Supabase credentials and deeppresenter importability.
"""

from __future__ import annotations

import importlib.util
import shutil

from fastapi import APIRouter

from ..settings import get_settings

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readiness")
async def readiness() -> dict[str, object]:
    settings = get_settings()
    deeppresenter_ok = importlib.util.find_spec("deeppresenter") is not None
    docker_cli = shutil.which("docker") is not None
    return {
        "status": "ok" if deeppresenter_ok else "degraded",
        "deeppresenter_importable": deeppresenter_ok,
        "docker_cli_available": docker_cli,
        "supabase_configured": bool(settings.supabase_url and settings.supabase_service_role_key),
        "edge_function_configured": bool(settings.supabase_edge_function_url),
        "workspace_base": str(settings.workspace_base),
    }
