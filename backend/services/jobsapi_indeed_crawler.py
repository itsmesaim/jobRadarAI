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
    roles = [primary_role] + secondary_roles

    key_skills = user.get("key_skills", [])
    if not key_skills:
        cv = user.get("cv", {})
        structured = cv.get("structured", {})
        all_skills = structured.get("skills", [])
        skip = {
            "HTML5",
            "CSS3",
            "Git / GitHub",
            "Postman",
            "Agile / Scrum",
            "Performance Optimisation",
            "Technical Documentation",
        }
        key_skills = [s for s in all_skills if s not in skip][:5]

    terms = []
    for role in roles:
        terms.append(role)
        if key_skills:
            for skill in key_skills[:3]:
                terms.append(f"{role} {skill}")
            if len(key_skills) >= 2:
                terms.append(f"{key_skills[0]} {key_skills[1]} developer")

    seen = set()
    unique = [t for t in terms if not (t in seen or seen.add(t))]
    return unique[:10]


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


async def crawl_jobs_for_user_jobsapi(
    user: dict, max_stored: int | None = None
) -> dict:
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

    def _at_cap() -> bool:
        return max_stored is not None and stored >= max_stored

    async with httpx.AsyncClient(timeout=15) as client:
        for term in search_terms:
            if _at_cap():
                break
            for raw_location in locations:
                if _at_cap():
                    break
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
                    if _at_cap():
                        break
                    found += 1
                    url = job.get("applyUrl", "")
                    if not url:
                        skipped += 1
                        continue

                    url_hash = _hash_url(url)
                    # dedup per user only
                    existing = await db.jobs.find_one(
                        {"url_hash": url_hash, "crawled_by": str(user["_id"])}
                    )
                    if existing:
                        skipped += 1
                        continue

                    full_text = job.get("description", "")
                    if len(full_text) < MIN_CONTENT_LENGTH:
                        skipped += 1
                        continue

                    # Relevance filter — avoid storing clearly off-target jobs
                    if not _is_relevant_job(full_text, user):
                        skipped += 1
                        continue

                    company_obj = job.get("company", {}) or {}
                    location_obj = job.get("location", {}) or {}

                    # JobsAPI sometimes includes postedDate
                    posted_at = None
                    posted = (
                        job.get("postedDate") or job.get("date") or job.get("posted")
                    )
                    if posted:
                        try:
                            posted_at = datetime.fromisoformat(
                                str(posted).replace("Z", "+00:00")
                            ).isoformat()
                        except Exception:
                            posted_at = None

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
                        "posted_at": posted_at,
                        "crawled_by": str(user["_id"]),
                        "ratings": {},
                    }

                    await db.jobs.insert_one(doc)
                    stored += 1
                    print(
                        f"[jobsapi-indeed] Stored: {doc['title']} @ {doc['company']} ({raw_location})"
                    )

    return {"found": found, "stored": stored, "skipped": skipped}


def _is_relevant_job(full_text: str, user: dict) -> bool:
    """Lightweight relevance gate before persisting job."""
    text = full_text.lower()

    key_skills = user.get("key_skills", [])
    if not key_skills:
        cv = user.get("cv", {})
        structured = cv.get("structured", {})
        all_skills = structured.get("skills", [])
        skip = {"HTML5", "CSS3", "Git / GitHub", "Postman", "Agile / Scrum"}
        key_skills = [s for s in all_skills if s not in skip][:5]

    if key_skills:
        matches = sum(1 for sk in key_skills if sk.lower() in text)
        primary = user.get("primary_role", "").lower()
        if matches == 0 and primary and primary.split()[0] not in text:
            return False

    return True
