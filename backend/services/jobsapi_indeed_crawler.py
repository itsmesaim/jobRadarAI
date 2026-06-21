"""
JobsAPI (RapidAPI - jobs-api14) Indeed crawler.
Paid tier: $10/mo, 20,000 calls — Ireland supported via countryCode=ie.
Docs: rapidapi.com/Pat92/api/jobs-api14
"""

import asyncio
import hashlib
from datetime import datetime, timezone

import httpx

from config import settings
from database import get_database

BASE_URL = "https://jobs-api14.p.rapidapi.com"
HEADERS = {
    "X-RapidAPI-Key": settings.jobsapi_key,
    "X-RapidAPI-Host": "jobs-api14.p.rapidapi.com",
}

MIN_CONTENT_LENGTH = 200


def _hash_url(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()


def _build_search_terms(user: dict) -> list[str]:
    primary_role = user.get("primary_role", "Full Stack Developer")
    secondary_roles = user.get("secondary_roles", [])
    return [primary_role] + secondary_roles


async def crawl_jobs_for_user_jobsapi(user: dict) -> dict:
    db = get_database()
    search_terms = _build_search_terms(user)

    found = 0
    stored = 0
    skipped = 0

    async with httpx.AsyncClient(timeout=15) as client:
        for term in search_terms:
            await asyncio.sleep(1.5)
            try:
                resp = await client.get(
                    f"{BASE_URL}/v2/indeed/search",
                    headers=HEADERS,
                    params={
                        "query": term,
                        "location": "Dublin",
                        "countryCode": "ie",
                        "sortType": "relevance",
                        "radius": "20",
                        "radiusType": "km",
                    },
                )
                resp.raise_for_status()
                data = resp.json()
            except Exception as e:
                print(f"[jobsapi-indeed] Error for '{term}': {e}")
                continue

            # real key is "data", not "jobs"
            jobs = data.get("data", [])

            for job in jobs:
                found += 1

                # real URL field is "applyUrl"
                url = job.get("applyUrl", "")
                if not url:
                    skipped += 1
                    continue

                url_hash = _hash_url(url)
                existing = await db.jobs.find_one({"url_hash": url_hash})
                if existing:
                    skipped += 1
                    continue

                full_text = job.get("description", "")
                if len(full_text) < MIN_CONTENT_LENGTH:
                    skipped += 1
                    continue

                # company and location are nested objects
                company_obj = job.get("company", {}) or {}
                company_name = company_obj.get("name", "")

                location_obj = job.get("location", {}) or {}
                location_str = location_obj.get("location", "Dublin, Ireland")

                doc = {
                    "title": job.get("title", "Unknown Role"),
                    "url": url,
                    "url_hash": url_hash,
                    "snippet": full_text[:400],
                    "full_text": full_text,
                    "company": company_name,
                    "location": location_str,
                    "source": "jobsapi-indeed",
                    "query": term,
                    "crawled_at": datetime.now(timezone.utc),
                    "ratings": {},
                }

                await db.jobs.insert_one(doc)
                stored += 1
                print(f"[jobsapi-indeed] Stored: {doc['title']} @ {doc['company']}")

    return {"found": found, "stored": stored, "skipped": skipped}
