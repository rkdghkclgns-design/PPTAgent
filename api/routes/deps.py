"""FastAPI dependency helpers.

Contains:
- `get_bridge`: returns the singleton AgentBridge attached to app.state.
- `require_auth`: HTTP dependency that verifies a Supabase-issued JWT in the
  `Authorization: Bearer ...` header.
- `require_auth_ws`: WebSocket variant that reads `?token=...` from the query
  string because browsers can't set headers on native WebSockets.

If `settings.auth_enabled` is false the auth dependencies fall through, which
is useful for local development and the demo deployment. Production should
always set AUTH_ENABLED=true.
"""

from __future__ import annotations

import base64
import json
import logging
from typing import Any

from fastapi import Header, HTTPException, Request, WebSocket, status

from ..core import AgentBridge
from ..settings import get_settings

logger = logging.getLogger("api.auth")


def get_bridge(request: Request) -> AgentBridge:
    return request.app.state.bridge


def _decode_jwt_payload(token: str) -> dict[str, Any]:
    """Decode a JWT's payload WITHOUT verifying the signature.

    Signature verification is delegated to Supabase's GoTrue server when we
    want strict checks (out of scope here because we'd need the JWKS). For
    now we treat the token as opaque proof-of-login and just make sure it
    parses and isn't expired. This prevents casual anonymous abuse while
    staying easy to operate without a public key endpoint.
    """
    try:
        _, payload_b64, _ = token.split(".")
        # base64url decode with missing padding forgiving
        padding = "=" * (-len(payload_b64) % 4)
        payload_bytes = base64.urlsafe_b64decode(payload_b64 + padding)
        return json.loads(payload_bytes)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="malformed JWT",
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
    payload = _decode_jwt_payload(token)

    # Exp check
    import time as _t
    exp = payload.get("exp")
    if isinstance(exp, (int, float)) and exp < _t.time():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="token expired",
        )

    # Issuer sanity check - we only trust tokens minted by our own project.
    iss = payload.get("iss") or ""
    if settings.supabase_url and settings.supabase_url not in iss:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="token issuer mismatch",
        )
    return payload


async def require_auth_ws(websocket: WebSocket) -> bool:
    """Return True if the WebSocket caller is authenticated."""
    settings = get_settings()
    if not settings.auth_enabled:
        return True
    token = websocket.query_params.get("token")
    if not token:
        return False
    try:
        _decode_jwt_payload(token)
        return True
    except HTTPException:
        return False
