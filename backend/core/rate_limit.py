"""
In-memory rate limiting for auth endpoints.

Suitable for single-process deployments. For multi-worker production,
put rate limiting at the reverse proxy (nginx, Cloudflare) as well.
"""

import ipaddress
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
    "fetch_url": (10, 60),
}

# Prune stale keys every N calls to prevent unbounded memory growth on long-running servers
_PRUNE_EVERY = 500
_prune_counter = 0


def _is_trusted_proxy_peer(host: str) -> bool:
    """True if `host` is the loopback/private address of a local reverse
    proxy (nginx on the same VPS), the only case where forwarding the
    client's own X-Forwarded-For header is safe to trust."""
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private


def _client_ip(request: Request) -> str:
    peer = request.client.host if request.client else "unknown"
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded and _is_trusted_proxy_peer(peer):
        return forwarded.split(",")[0].strip()
    return peer


def _prune_stale_keys(now: float) -> None:
    """Remove keys whose entire hit list has expired - prevents dict growing forever."""
    max_window = max(w for _, w in _LIMITS.values())
    cutoff = now - max_window
    stale = [k for k, hits in _hits.items() if not any(t > cutoff for t in hits)]
    for k in stale:
        del _hits[k]


def enforce_rate_limit(request: Request, route: str) -> None:
    global _prune_counter
    max_requests, window_seconds = _LIMITS.get(route, (10, 60))
    key = f"{route}:{_client_ip(request)}"
    now = time.monotonic()
    window_start = now - window_seconds

    _prune_counter += 1
    if _prune_counter >= _PRUNE_EVERY:
        _prune_stale_keys(now)
        _prune_counter = 0

    recent = [t for t in _hits[key] if t > window_start]
    if len(recent) >= max_requests:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please wait and try again.",
        )
    recent.append(now)
    _hits[key] = recent
