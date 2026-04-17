"""Thin async wrappers around the Supabase REST + Edge Function surface.

The FastAPI server does NOT hold a Google API key. When `deeppresenter/pptagent`
makes an OpenAI-compatible call, it is pointed at `edge_function_url` and the
service role JWT is attached so Supabase can verify the request. The Edge
Function then fans out to Gemini or Imagen server-side.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from ..settings import Settings, get_settings


@dataclass(slots=True)
class EdgeResponse:
    status_code: int
    payload: dict[str, Any]


class EdgeFunctionClient:
    """Calls the llm-proxy Edge Function with an OpenAI-shaped body."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()

    async def call(self, body: dict[str, Any]) -> EdgeResponse:
        if not self.settings.supabase_edge_function_url:
            raise RuntimeError("SUPABASE_EDGE_FUNCTION_URL is not set")
        headers = {
            "content-type": "application/json",
            "Authorization": f"Bearer {self.settings.supabase_service_role_key}",
            "apikey": self.settings.supabase_service_role_key,
        }
        async with httpx.AsyncClient(timeout=120.0) as client:
            res = await client.post(
                self.settings.supabase_edge_function_url,
                json=body,
                headers=headers,
            )
        try:
            payload = res.json()
        except Exception:
            payload = {"error": {"raw": res.text}}
        return EdgeResponse(res.status_code, payload)


class StorageClient:
    """Minimal Supabase Storage client over HTTP.

    We intentionally avoid the heavyweight `supabase-py` dependency on the hot
    path - httpx is enough for upload/signed-url.
    """

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._base = f"{self.settings.supabase_url}/storage/v1"

    async def upload(self, object_path: str, data: bytes, content_type: str) -> str:
        url = f"{self._base}/object/{self.settings.supabase_storage_bucket}/{object_path}"
        headers = {
            "Authorization": f"Bearer {self.settings.supabase_service_role_key}",
            "apikey": self.settings.supabase_service_role_key,
            "content-type": content_type,
            "x-upsert": "true",
        }
        async with httpx.AsyncClient(timeout=300.0) as client:
            res = await client.post(url, content=data, headers=headers)
        res.raise_for_status()
        return object_path

    async def signed_url(self, object_path: str, expires_in: int = 3600) -> str:
        url = f"{self._base}/object/sign/{self.settings.supabase_storage_bucket}/{object_path}"
        headers = {
            "Authorization": f"Bearer {self.settings.supabase_service_role_key}",
            "apikey": self.settings.supabase_service_role_key,
            "content-type": "application/json",
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(url, json={"expiresIn": expires_in}, headers=headers)
        res.raise_for_status()
        body = res.json()
        signed = body.get("signedURL") or body.get("signedUrl")
        if not signed:
            raise RuntimeError(f"unexpected signed url response: {body}")
        if signed.startswith("/"):
            signed = f"{self.settings.supabase_url}/storage/v1{signed}"
        return signed

    async def upload_file(self, local_path: Path, object_path: str, content_type: str) -> str:
        data = await asyncio.to_thread(local_path.read_bytes)
        return await self.upload(object_path, data, content_type)

    async def signed_upload_url(self, object_path: str) -> dict[str, str]:
        """Create a short-lived signed PUT URL so the browser uploads directly.

        Returns both the absolute URL the client should PUT to and the
        object_path the caller eventually references in a /generate request.
        """
        url = f"{self._base}/object/upload/sign/{self.settings.supabase_storage_bucket}/{object_path}"
        headers = {
            "Authorization": f"Bearer {self.settings.supabase_service_role_key}",
            "apikey": self.settings.supabase_service_role_key,
            "content-type": "application/json",
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(url, json={}, headers=headers)
        res.raise_for_status()
        body = res.json()
        signed = body.get("url") or body.get("signedURL") or body.get("signedUrl")
        if not signed:
            raise RuntimeError(f"unexpected signed upload response: {body}")
        if signed.startswith("/"):
            signed = f"{self.settings.supabase_url}/storage/v1{signed}"
        return {"upload_url": signed, "object_path": object_path}
