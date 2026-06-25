"""
In-memory rate limiting for auth endpoints.

Suitable for single-process deployments. For multi-worker production,
put rate limiting at the reverse proxy (nginx, Cloudflare) as well.
"""

import time
from collections import defaultdict

from fastapi import HTTPException, Request, status

# route_key -> list of monotonic timestamps
_hits: dict[str, list[float]] = defaultdict(list)

# (max_requests, window_seconds) per route
_LIMITS: dict[str, tuple[int, int]] = {
    "login": (10, 60),
    "register": (5, 60),
    "forgot_password": (5, 300),
}


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


def enforce_rate_limit(request: Request, route: str) -> None:
    max_requests, window_seconds = _LIMITS.get(route, (10, 60))
    key = f"{route}:{_client_ip(request)}"
    now = time.monotonic()
    window_start = now - window_seconds

    recent = [t for t in _hits[key] if t > window_start]
    if len(recent) >= max_requests:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please wait and try again.",
        )
    recent.append(now)
    _hits[key] = recent
