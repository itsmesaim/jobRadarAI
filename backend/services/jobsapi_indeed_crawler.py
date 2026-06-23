"""
JobsAPI (RapidAPI - jobs-api14) Indeed crawler.
Paid tier: $10/mo, 20,000 calls — Ireland supported via countryCode=ie.
Docs: rapidapi.com/Pat92/api/jobs-api14
"""

import asyncio
import hashlib
from datetime import datetime, timezone

import httpx
from bson import ObjectId

from config import settings
from database import get_database

BASE_URL = "https://jobs-api14.p.rapidapi.com"
MIN_CONTENT_LENGTH = 200


def _hash_url(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()


def _build_search_terms(user: dict) -> list[str]:
    primary_role = user.get("primary_role", "Full Stack Developer")
    secondary_roles = user.get("secondary_roles", [])
    return [primary_role] + secondary_roles


def _detect_country_code(location: str) -> str:
    """Auto-detect Indeed countryCode from free-text location string."""
    loc = location.lower()
    if any(x in loc for x in ["ireland", "dublin"]):
        return "ie"
    if any(
        x in loc
        for x in [
            "india",
            "bangalore",
            "bengaluru",
            "mumbai",
            "hyderabad",
            "delhi",
            "pune",
            "chennai",
        ]
    ):
        return "in"
    if any(x in loc for x in ["uae", "dubai", "abu dhabi", "sharjah"]):
        return "ae"
    if any(
        x in loc
        for x in [
            "uk",
            "london",
            "manchester",
            "birmingham",
            "edinburgh",
            "glasgow",
            "bristol",
        ]
    ):
        return "gb"
    if any(
        x in loc
        for x in [
            "germany",
            "berlin",
            "munich",
            "hamburg",
            "frankfurt",
            "cologne",
            "deutschland",
        ]
    ):
        return "de"
    if any(x in loc for x in ["netherlands", "amsterdam", "rotterdam"]):
        return "nl"
    if any(x in loc for x in ["canada", "toronto", "vancouver", "montreal"]):
        return "ca"
    if any(x in loc for x in ["australia", "sydney", "melbourne", "brisbane"]):
        return "au"
    if any(x in loc for x in ["singapore"]):
        return "sg"
    if any(x in loc for x in ["france", "paris"]):
        return "fr"
    if any(x in loc for x in ["remote", "worldwide", "global", "anywhere", "europe"]):
        return "us"  # Indeed's remote/global jobs indexed under US
    return "us"  # safe default


def _detect_location_string(location: str) -> str:
    """Clean up the location string for Indeed's location param."""
    loc = location.lower()
    if any(x in loc for x in ["remote", "worldwide", "global", "anywhere"]):
        return "Remote"
    if "europe" in loc:
        return "Europe"
    # pass through as-is — Indeed handles free text well
    return location


async def crawl_jobs_for_user_jobsapi(user: dict) -> dict:
    db = get_database()

    # always fetch fresh preferences
    fresh_user = await db.users.find_one({"_id": ObjectId(user["_id"])})
    if fresh_user:
        user = fresh_user

    search_terms = _build_search_terms(user)
    locations = user.get("preferred_locations", ["Dublin Ireland"])

    headers = {
        "X-RapidAPI-Key": settings.jobsapi_key,
        "X-RapidAPI-Host": "jobs-api14.p.rapidapi.com",
    }

    found = 0
    stored = 0
    skipped = 0

    async with httpx.AsyncClient(timeout=15) as client:
        for term in search_terms:
            for raw_location in locations:
                country_code = _detect_country_code(raw_location)
                location_str = _detect_location_string(raw_location)
                await asyncio.sleep(1.5)

                try:
                    resp = await client.get(
                        f"{BASE_URL}/v2/indeed/search",
                        headers=headers,
                        params={
                            "query": term,
                            "location": location_str,
                            "countryCode": country_code,
                            "sortType": "relevance",
                            "radius": "30",
                            "radiusType": "km",
                        },
                    )
                    resp.raise_for_status()
                    data = resp.json()
                except Exception as e:
                    print(
                        f"[jobsapi-indeed] Error for '{term}' @ '{raw_location}' ({country_code}): {e}"
                    )
                    continue

                jobs = data.get("data", [])
                print(
                    f"[jobsapi-indeed] '{term}' @ '{raw_location}' → {len(jobs)} results"
                )

                for job in jobs:
                    found += 1
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

                    company_obj = job.get("company", {}) or {}
                    location_obj = job.get("location", {}) or {}

                    doc = {
                        "title": job.get("title", "Unknown Role"),
                        "url": url,
                        "url_hash": url_hash,
                        "snippet": full_text[:400],
                        "full_text": full_text,
                        "company": company_obj.get("name", ""),
                        "location": location_obj.get("location", raw_location),
                        "source": "jobsapi-indeed",
                        "query": term,
                        "search_location": raw_location,
                        "crawled_at": datetime.now(timezone.utc),
                        "crawled_by": str(user["_id"]),
                        "ratings": {},
                    }

                    await db.jobs.insert_one(doc)
                    stored += 1
                    print(
                        f"[jobsapi-indeed] Stored: {doc['title']} @ {doc['company']} ({raw_location})"
                    )

    return {"found": found, "stored": stored, "skipped": skipped}
