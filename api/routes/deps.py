"""FastAPI dependency helpers.

Contains:
- `get_bridge`: returns the singleton AgentBridge attached to app.state.
- `require_auth`: HTTP dependency that verifies a Supabase-issued JWT in the
  `Authorization: Bearer ...` header.
- `require_auth_ws`: WebSocket variant reading `?token=...` from the query
  string because browsers can't set headers on native WebSockets.

Verification modes (switched by `Settings.auth_enabled`):
  * False              - no-op (dev only)
  * True + JWKS ready  - full RS256/ES256 signature check via JwksVerifier
  * True + JWKS down   - FAIL CLOSED; we never fall back to unsigned decode
"""

from __future__ import annotations

import base64
import json
import logging
from functools import lru_cache
from typing import Any

from fastapi import Header, HTTPException, Request, WebSocket, status

from ..core import AgentBridge
from ..core.jwks import JwksVerifier
from ..settings import get_settings

logger = logging.getLogger("api.auth")


def get_bridge(request: Request) -> AgentBridge:
    return request.app.state.bridge


@lru_cache(maxsize=1)
def _get_verifier() -> JwksVerifier | None:
    settings = get_settings()
    if not settings.supabase_url:
        return None
    return JwksVerifier(settings.supabase_url)


def _decode_payload_unverified(token: str) -> dict[str, Any]:
    """Parse JUST the payload - used only for logging the `sub` on failures."""
    try:
        _, payload_b64, _ = token.split(".")
        padding = "=" * (-len(payload_b64) % 4)
        return json.loads(base64.urlsafe_b64decode(payload_b64 + padding))
    except Exception:  # noqa: BLE001
        return {}


async def _verify(token: str) -> dict[str, Any]:
    settings = get_settings()
    verifier = _get_verifier()
    if verifier is None:
        # JWKS URL not configured -> fail closed, don't silently accept.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="auth not configured on server",
        )
    issuer = f"{settings.supabase_url.rstrip('/')}/auth/v1"
    try:
        return await verifier.verify(token, expected_issuer=issuer)
    except ValueError as exc:
        preview = _decode_payload_unverified(token).get("sub", "-")
        logger.info("jwt rejected for sub=%s: %s", preview, exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
        ) from exc


async def require_auth(
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    settings = get_settings()
    if not settings.auth_enabled:
        return {"sub": "anonymous", "mode": "disabled"}

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing bearer token",
        )
    token = authorization.split(None, 1)[1]
    return await _verify(token)


async def require_auth_ws(websocket: WebSocket) -> bool:
    settings = get_settings()
    if not settings.auth_enabled:
        return True
    token = websocket.query_params.get("token")
    if not token:
        return False
    try:
        await _verify(token)
        return True
    except HTTPException:
        return False
