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
    roles = [primary_role] + secondary_roles

    # Pull key skills (from prefs or CV) to make searches much more relevant
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
            # Create more targeted keyword strings (Jooble handles this well)
            for skill in key_skills[:3]:
                terms.append(f"{role} {skill}")
            if len(key_skills) >= 2:
                terms.append(f"{key_skills[0]} {key_skills[1]} {role}")

    # dedupe while preserving order
    seen = set()
    unique = []
    for t in terms:
        if t not in seen:
            seen.add(t)
            unique.append(t)
    return unique[:12]  # cap to avoid too many API calls


def _clean_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("&nbsp;", " ").replace("&amp;", "&")
    return re.sub(r"\s+", " ", text).strip()


async def crawl_jobs_for_user_jooble(user: dict, max_stored: int | None = None) -> dict:
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

    def _at_cap() -> bool:
        return max_stored is not None and stored >= max_stored

    async with httpx.AsyncClient(timeout=15) as client:
        for term in search_terms:
            if _at_cap():
                break
            for raw_location in locations:
                if _at_cap():
                    break
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
                    if _at_cap():
                        break
                    found += 1
                    url = job.get("link", "")
                    url_hash = _hash_url(url)

                    # dedup per user only
                    existing = await db.jobs.find_one(
                        {"url_hash": url_hash, "crawled_by": str(user["_id"])}
                    )
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

                    # === Relevance filter to avoid non-relevant jobs (saves tokens later) ===
                    if not _is_relevant_job(full_text, snippet, user):
                        skipped += 1
                        continue

                    # Jooble often has "updated" as posted/refresh date
                    posted_at = None
                    updated = job.get("updated") or job.get("created")
                    if updated:
                        try:
                            posted_at = datetime.fromisoformat(
                                str(updated).replace("Z", "+00:00")
                            ).isoformat()
                        except Exception:
                            posted_at = None

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
                        "posted_at": posted_at,
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


def _is_relevant_job(
    full_text: str, snippet: str, user: dict, cv_embedding: list = None
) -> bool:
    """Keyword-based relevance gate before storing. (Heavy sim filtering happens in rating pre-filter.)"""
    text = (full_text + " " + snippet).lower()

    key_skills = user.get("key_skills", [])
    if not key_skills:
        cv = user.get("cv", {})
        structured = cv.get("structured", {})
        all_skills = structured.get("skills", [])
        skip = {"HTML5", "CSS3", "Git / GitHub", "Postman", "Agile / Scrum"}
        key_skills = [s for s in all_skills if s not in skip][:5]

    if key_skills:
        matches = sum(1 for sk in key_skills if sk.lower() in text)
        role = user.get("primary_role", "").lower()
        if matches == 0 and (not role or role.split()[0] not in text):
            return False

    return True
