"""JWKS fetch + cache + signature verification.

Why not python-jose only? python-jose can verify a JWT when you hand it a
single JWK, but it does not fetch JWKS documents nor cache keys by `kid`.
We keep the dependency footprint small by implementing a tiny cache here.

Security posture:
  * When `AUTH_ENABLED=true`, every incoming token must verify against a key
    pulled from the project's JWKS endpoint.
  * When the JWKS endpoint is unreachable we FAIL CLOSED - do not accept an
    unverified token just because we couldn't reach Supabase.
  * Clock skew tolerance is 60 s; tokens older than `iat + 60` or with
    `exp < now - 60` are rejected.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any

import httpx
from jose import jwt  # type: ignore[import]
from jose.exceptions import JWTError  # type: ignore[import]

logger = logging.getLogger("api.jwks")

_CACHE_TTL_SECONDS = 60 * 60  # 1h
_CLOCK_SKEW_SECONDS = 60


@dataclass
class _JwksCache:
    fetched_at: float = 0.0
    keys: dict[str, dict[str, Any]] = field(default_factory=dict)


class JwksVerifier:
    """Resolve a Supabase project's JWKS and verify RS256/ES256 tokens."""

    def __init__(self, supabase_url: str) -> None:
        # Supabase exposes its JWKS at `<project>/auth/v1/.well-known/jwks.json`.
        self.jwks_url = f"{supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
        self._cache = _JwksCache()

    async def _refresh(self) -> None:
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.get(self.jwks_url)
        res.raise_for_status()
        doc = res.json()
        by_kid: dict[str, dict[str, Any]] = {}
        for key in doc.get("keys", []):
            kid = key.get("kid")
            if kid:
                by_kid[kid] = key
        self._cache = _JwksCache(fetched_at=time.time(), keys=by_kid)
        logger.info("jwks refreshed - %d keys", len(by_kid))

    async def _key_for(self, kid: str) -> dict[str, Any]:
        fresh = self._cache.fetched_at + _CACHE_TTL_SECONDS > time.time()
        if not fresh or kid not in self._cache.keys:
            await self._refresh()
        key = self._cache.keys.get(kid)
        if key is None:
            raise ValueError(f"unknown JWT kid {kid!r}")
        return key

    async def verify(
        self,
        token: str,
        *,
        expected_issuer: str | None = None,
        expected_audience: str | None = "authenticated",
    ) -> dict[str, Any]:
        """Verify signature + standard claims; return the payload."""
        try:
            headers = jwt.get_unverified_header(token)
        except JWTError as exc:
            raise ValueError(f"malformed JWT header: {exc}") from exc

        kid = headers.get("kid")
        alg = headers.get("alg", "")
        if not kid:
            # HS256 tokens (signed with the project anon key) have no kid. We
            # reject them here because Supabase Auth issues RS256/ES256 user
            # tokens; service-role tokens should never hit this path.
            raise ValueError("JWT has no kid - only asymmetric tokens are accepted")

        key = await self._key_for(kid)
        try:
            payload = jwt.decode(
                token,
                key,
                algorithms=[alg] if alg else ["RS256", "ES256"],
                audience=expected_audience,
                issuer=expected_issuer,
                options={
                    "verify_aud": expected_audience is not None,
                    "verify_iss": expected_issuer is not None,
                    "leeway": _CLOCK_SKEW_SECONDS,
                },
            )
        except JWTError as exc:
            raise ValueError(f"JWT verification failed: {exc}") from exc
        return payload
