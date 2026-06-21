"""
Jooble crawler service.
POST-based API, returns structured job data covering Ireland directly.
Free tier: 500 requests total (not per day) — use deliberately.

Docs: https://jooble.org/api/about
"""

import re
import hashlib
from datetime import datetime, timezone

import httpx

from config import settings
from database import get_database
from datetime import datetime, timedelta, timezone

JOOBLE_BASE = "https://jooble.org/api"


def _hash_url(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()


TECH_ANCHOR = "developer OR engineer OR software"


def _build_search_terms(user: dict) -> list[str]:
    primary_role = user.get("primary_role", "Full Stack Developer")
    secondary_roles = user.get("secondary_roles", [])
    all_roles = [primary_role] + secondary_roles

    # anchor generic terms to tech, leave already-specific terms alone
    anchored = []
    for role in all_roles:
        role_lower = role.lower()
        if any(
            kw in role_lower
            for kw in [
                "developer",
                "engineer",
                "software",
                "backend",
                "frontend",
                "full stack",
                "ai",
                "ml",
            ]
        ):
            anchored.append(role)  # already tech-specific
        else:
            anchored.append(f"{role} software developer")  # force tech context

    return anchored


# def _build_search_terms(user: dict) -> list[str]:
#     primary_role = user.get("primary_role", "Full Stack Developer")
#     secondary_roles = user.get("secondary_roles", [])
#     return [primary_role] + secondary_roles


async def crawl_jobs_for_user_jooble(user: dict) -> dict:
    db = get_database()
    search_terms = _build_search_terms(user)

    found = 0
    stored = 0
    skipped = 0

    async with httpx.AsyncClient(timeout=15) as client:
        for term in search_terms:
            try:
                resp = await client.post(
                    f"{JOOBLE_BASE}/{settings.jooble_api_key}",
                    json={
                        "keywords": term,
                        "location": "Dublin, Ireland",
                        "ResultOnPage": "20",
                        "DatePosted": "7",
                    },
                )
                resp.raise_for_status()
                data = resp.json()
            except Exception as e:
                print(f"[jooble] Error for '{term}': {e}")
                continue

            for job in data.get("jobs", []):
                found += 1
                url = job.get("link", "")
                url_hash = _hash_url(url)

                existing = await db.jobs.find_one({"url_hash": url_hash})
                if existing:
                    skipped += 1
                    continue

                # skip jobs older than 30 days
                updated_str = job.get("updated", "")
                if updated_str:
                    try:
                        job_date = datetime.fromisoformat(
                            updated_str.replace("Z", "+00:00")
                        )
                        if job_date < datetime.now(timezone.utc) - timedelta(days=30):
                            skipped += 1
                            continue
                    except (ValueError, TypeError):
                        pass  # if date unparseable, don't filter it out

                snippet = _clean_html(job.get("snippet", ""))
                # Jooble snippets are short — try fetching full JD from link
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
                    "location": job.get("location", ""),
                    "salary_text": job.get("salary", ""),
                    "source": "jooble",
                    "query": term,
                    "crawled_at": datetime.now(timezone.utc),
                    "ratings": {},
                }

                await db.jobs.insert_one(doc)
                stored += 1
                print(f"[jooble] Stored: {doc['title']} @ {doc['company']}")

    return {"found": found, "stored": stored, "skipped": skipped}


async def _fetch_full_text(client: httpx.AsyncClient, url: str) -> str:
    """Best-effort fetch of full JD text from the job link."""
    try:
        headers = {"User-Agent": "Mozilla/5.0 (compatible; JobRadarBot/1.0)"}
        r = await client.get(url, headers=headers, follow_redirects=True, timeout=10)
        if r.status_code == 200:
            return r.text[:8000]
    except Exception:
        pass
    return ""


def _clean_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("&nbsp;", " ").replace("&amp;", "&")
    return re.sub(r"\s+", " ", text).strip()
