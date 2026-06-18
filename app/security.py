"""Security middleware, rate limiting, and env helpers."""

from __future__ import annotations

import os
import time
from collections import defaultdict
from threading import Lock

from fastapi import HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware

_RATE_LOCK = Lock()
_RATE_BUCKETS: dict[str, list[float]] = defaultdict(list)
_RATE_LIMIT = int(os.environ.get("PAKETO_AUTH_RATE_LIMIT", "20"))
_RATE_WINDOW_SEC = int(os.environ.get("PAKETO_AUTH_RATE_WINDOW", "300"))


def registration_allowed() -> bool:
    return os.environ.get("PAKETO_ALLOW_REGISTER", "0").strip().lower() in (
        "1",
        "true",
        "yes",
    )


def production_mode() -> bool:
    return os.environ.get("PAKETO_ENV", "").strip().lower() in (
        "production",
        "prod",
    )


def require_strong_secret() -> None:
    secret = os.environ.get("POSTA_SECRET", "")
    if production_mode() and (
        not secret or secret == "posta-dev-secret-change-in-production"
    ):
        raise RuntimeError("POSTA_SECRET must be set to a strong random value in production.")


def check_auth_rate_limit(request: Request) -> None:
    if _RATE_LIMIT <= 0:
        return
    client = request.client.host if request.client else "unknown"
    now = time.time()
    with _RATE_LOCK:
        bucket = _RATE_BUCKETS[client]
        _RATE_BUCKETS[client] = [t for t in bucket if now - t < _RATE_WINDOW_SEC]
        if len(_RATE_BUCKETS[client]) >= _RATE_LIMIT:
            raise HTTPException(
                status_code=429,
                detail="Too many attempts. Please wait a few minutes.",
            )
        _RATE_BUCKETS[client].append(now)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=(self)"
        response.headers["X-XSS-Protection"] = "0"
        if os.environ.get("PAKETO_HTTPS", "0").strip().lower() in ("1", "true", "yes"):
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return response
