"""
Jooble crawler service.
POST-based API, returns structured job data covering Ireland directly.
Free tier: 500 requests total (not per day) — use deliberately.

Docs: https://jooble.org/api/about
"""

import asyncio
import re
import hashlib
from datetime import datetime, timezone, timedelta

import httpx
from bson import ObjectId

from config import settings
from database import get_database

JOOBLE_BASE = "https://jooble.org/api"


def _hash_url(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()


def _build_search_terms(user: dict) -> list[str]:
    primary_role = user.get("primary_role", "Full Stack Developer")
    secondary_roles = user.get("secondary_roles", [])
    return [primary_role] + secondary_roles


def _clean_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("&nbsp;", " ").replace("&amp;", "&")
    return re.sub(r"\s+", " ", text).strip()


async def crawl_jobs_for_user_jooble(user: dict) -> dict:
    db = get_database()

    # always fetch fresh preferences
    fresh_user = await db.users.find_one({"_id": ObjectId(user["_id"])})
    if fresh_user:
        user = fresh_user

    search_terms = _build_search_terms(user)
    locations = user.get("preferred_locations", ["Dublin Ireland"])

    # normalize "remote" to empty string (Jooble = worldwide when blank)
    def _jooble_location(loc: str) -> str:
        if (
            "remote" in loc.lower()
            or "worldwide" in loc.lower()
            or "global" in loc.lower()
        ):
            return ""
        return loc

    found = 0
    stored = 0
    skipped = 0

    async with httpx.AsyncClient(timeout=15) as client:
        for term in search_terms:
            for raw_location in locations:
                jooble_loc = _jooble_location(raw_location)
                await asyncio.sleep(1.5)

                try:
                    resp = await client.post(
                        f"{JOOBLE_BASE}/{settings.jooble_api_key}",
                        json={
                            "keywords": term,
                            "location": jooble_loc,
                            "ResultOnPage": "10",
                        },
                    )
                    resp.raise_for_status()
                    data = resp.json()
                except Exception as e:
                    print(f"[jooble] Error for '{term}' @ '{raw_location}': {e}")
                    continue

                for job in data.get("jobs", []):
                    found += 1
                    url = job.get("link", "")
                    url_hash = _hash_url(url)

                    existing = await db.jobs.find_one({"url_hash": url_hash})
                    if existing:
                        skipped += 1
                        continue

                    # date filter — skip older than 30 days
                    updated_str = job.get("updated", "")
                    if updated_str:
                        try:
                            job_date = datetime.fromisoformat(
                                updated_str.replace("Z", "+00:00")
                            )
                            if job_date < datetime.now(timezone.utc) - timedelta(
                                days=30
                            ):
                                skipped += 1
                                continue
                        except (ValueError, TypeError):
                            pass

                    snippet = _clean_html(job.get("snippet", ""))
                    full_text = await _fetch_full_text(client, url) or snippet

                    if len(full_text) < 100:
                        skipped += 1
                        continue

                    doc = {
                        "title": job.get("title", "Unknown Role"),
                        "url": url,
                        "url_hash": url_hash,
                        "snippet": snippet[:400],
                        "full_text": full_text,
                        "company": job.get("company", ""),
                        "location": job.get("location", raw_location),
                        "salary_text": job.get("salary", ""),
                        "source": "jooble",
                        "query": term,
                        "search_location": raw_location,
                        "crawled_at": datetime.now(timezone.utc),
                        "crawled_by": str(user["_id"]),
                        "ratings": {},
                    }

                    await db.jobs.insert_one(doc)
                    stored += 1
                    print(
                        f"[jooble] Stored: {doc['title']} @ {doc['company']} ({raw_location})"
                    )

    return {"found": found, "stored": stored, "skipped": skipped}


async def _fetch_full_text(client: httpx.AsyncClient, url: str) -> str:
    try:
        headers = {"User-Agent": "Mozilla/5.0 (compatible; JobRadarBot/1.0)"}
        r = await client.get(url, headers=headers, follow_redirects=True, timeout=10)
        if r.status_code == 200:
            return r.text[:8000]
    except Exception:
        pass
    return ""
