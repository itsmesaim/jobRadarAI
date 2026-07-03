"""Job description quality helpers — detect stubs and enrich from URLs."""

from __future__ import annotations

MIN_JD_LENGTH = 200


def is_incomplete_jd(text: str) -> bool:
    """True when stored text is too thin to rate or copy as a real JD."""
    text = (text or "").strip()
    if len(text) < MIN_JD_LENGTH:
        return True
    # LinkedIn crawler stub pattern (title/company/location only)
    if text.startswith("Job title:") and "Source listing:" in text:
        return True
    return False


async def enrich_jd_from_url(url: str) -> str | None:
    """Best-effort fetch of full JD text from the listing URL. Returns None on failure."""
    if not url:
        return None
    try:
        from services.url_fetch import fetch_job_page_text

        result = await fetch_job_page_text(url)
        text = (result.get("text") or "").strip()
        if is_incomplete_jd(text):
            return None
        return text
    except Exception:
        return None
