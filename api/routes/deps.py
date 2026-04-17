"""FastAPI dependency helpers."""

from __future__ import annotations

from fastapi import Request

from ..core import AgentBridge


def get_bridge(request: Request) -> AgentBridge:
    """Return the singleton bridge attached to app state at startup."""
    return request.app.state.bridge
