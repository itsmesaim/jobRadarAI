"""
Adzuna crawler service.
Returns STRUCTURED job data directly — no HTML scraping, no listing-page
confusion. This replaces Tavily as the primary discovery source.

Adzuna free tier: 250 calls/day, Ireland (country code 'ie') supported.
Docs: https://developer.adzuna.com/
"""

import hashlib
from datetime import datetime, timezone

import httpx

from config import settings
from database import get_database

ADZUNA_BASE = "https://api.adzuna.com/v1/api/jobs"
COUNTRY = "ie"  # Ireland only, per current focus


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


async def crawl_jobs_for_user_adzuna(user: dict) -> dict:
    db = get_database()
    search_terms = _build_search_terms(user)

    found = 0
    stored = 0
    skipped = 0

    async with httpx.AsyncClient(timeout=15) as client:
        for term in search_terms:
            try:
                resp = await client.get(
                    f"{ADZUNA_BASE}/{COUNTRY}/search/1",
                    params={
                        "app_id": settings.adzuna_app_id,
                        "app_key": settings.adzuna_app_key,
                        "what": term,
                        "where": "Dublin",
                        "results_per_page": 20,
                        "content-type": "application/json",
                    },
                )
                resp.raise_for_status()
                data = resp.json()
            except Exception as e:
                print(f"[adzuna] Error for '{term}': {e}")
                continue

            for job in data.get("results", []):
                found += 1
                url = job.get("redirect_url", "")
                url_hash = _hash_url(url)

                # dedup per user only
                existing = await db.jobs.find_one(
                    {"url_hash": url_hash, "crawled_by": str(user["_id"])}
                )
                if existing:
                    skipped += 1
                    continue

                description = job.get("description", "")
                if len(description) < 100:
                    skipped += 1
                    continue

                salary_min = job.get("salary_min")
                salary_max = job.get("salary_max")
                location = job.get("location", {}).get("display_name", "")

                # Adzuna returns "created" as the job posting date (YYYY-MM-DD or ISO)
                posted_at = None
                created = job.get("created")
                if created:
                    try:
                        # Normalize to ISO
                        if len(created) == 10:  # YYYY-MM-DD
                            posted_at = f"{created}T00:00:00+00:00"
                        else:
                            posted_at = datetime.fromisoformat(
                                str(created).replace("Z", "+00:00")
                            ).isoformat()
                    except Exception:
                        posted_at = None

                doc = {
                    "title": job.get("title", "Unknown Role"),
                    "url": url,
                    "url_hash": url_hash,
                    "snippet": description[:400],
                    "full_text": description,
                    "company": job.get("company", {}).get("display_name", ""),
                    "location": location,
                    "salary_min": salary_min,
                    "salary_max": salary_max,
                    "source": "adzuna",
                    "query": term,
                    "crawled_at": datetime.now(timezone.utc),
                    "posted_at": posted_at,
                    "crawled_by": str(user["_id"]),
                    "ratings": {},
                }

                await db.jobs.insert_one(doc)
                stored += 1
                print(f"[adzuna] Stored: {doc['title']} @ {doc['company']}")

    return {"found": found, "stored": stored, "skipped": skipped}
