"""Shared job deduplication helpers — per-user URL and content fingerprints."""

from __future__ import annotations

import hashlib
import re
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

_TRACKING_PARAMS = frozenset(
    {
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "utm_id",
        "gclid",
        "fbclid",
        "mc_cid",
        "mc_eid",
        "ref",
        "source",
        "src",
        "trk",
        "tracking",
        "campaign",
        "affiliate",
        "clickid",
    }
)


def normalize_url(url: str) -> str:
    """Canonicalize a job URL so tracking params and trivial variants share one hash."""
    url = (url or "").strip()
    if not url:
        return ""

    parsed = urlparse(url.lower())
    if not parsed.scheme or not parsed.netloc:
        return url.lower().rstrip("/")

    query = parse_qs(parsed.query, keep_blank_values=False)
    filtered = {
        k: v
        for k, v in query.items()
        if k.lower() not in _TRACKING_PARAMS and not k.lower().startswith("utm_")
    }
    clean_query = urlencode(sorted(filtered.items()), doseq=True)

    path = parsed.path.rstrip("/") or "/"
    return urlunparse((parsed.scheme, parsed.netloc, path, "", clean_query, ""))


def hash_url(url: str) -> str:
    normalized = normalize_url(url)
    if not normalized:
        return hashlib.sha256(b"").hexdigest()
    return hashlib.sha256(normalized.encode()).hexdigest()


def _normalize_text(value: str) -> str:
    value = (value or "").lower()
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def content_fingerprint(title: str, company: str, location: str = "") -> str:
    """Stable per-listing fingerprint when Jooble/Indeed use different apply URLs."""
    parts = (
        _normalize_text(title),
        _normalize_text(company),
        _normalize_text(location),
    )
    payload = "|".join(p for p in parts if p)
    return hashlib.sha256(payload.encode()).hexdigest()


async def job_exists_for_user(
    db,
    *,
    user_id: str,
    url: str,
    title: str = "",
    company: str = "",
    location: str = "",
) -> bool:
    """Return True if this user already has an equivalent job stored."""
    url_hash = hash_url(url)
    existing = await db.jobs.find_one(
        {"crawled_by": user_id, "url_hash": url_hash},
        {"_id": 1},
    )
    if existing:
        return True

    if not _normalize_text(title) and not _normalize_text(company):
        return False

    fp = content_fingerprint(title, company, location)

    existing = await db.jobs.find_one(
        {"crawled_by": user_id, "content_fingerprint": fp},
        {"_id": 1},
    )
    return existing is not None
