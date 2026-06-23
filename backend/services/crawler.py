"""
Crawler service.
Queries generated from user CV skills + preferences.
Tavily search → content filter → dedup → store.
"""

import hashlib
import re
from datetime import datetime, timezone
from langsmith import traceable

import httpx
from tavily import TavilyClient

from config import settings
from database import get_database

tavily = TavilyClient(api_key=settings.tavily_api_key)

MIN_JD_LENGTH = 300

JOB_URL_PATTERNS = [
    r"irishjobs\.ie/job/[\w-]+-job\d{5,}",
    r"jobs\.ie/job/[\w-]+-\d{5,}",
    r"recruitireland\.com/job/[\w-]+-\d{5,}",
    r"naukri\.com/job-listings-[\w-]+",
    r"foundit\.in/job/[\w-]+-\d{5,}",
]


def _hash_url(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()


def _is_listing_page(url: str, content: str) -> bool:
    """True if this looks like a category/listing page, not a real JD."""
    listing_signals = [
        "Sort byRelevance",
        "Date posted",
        "Type of Company",
        "Popular locations",
        "Job Openings",
        "Related Jobs",
        "Job Vacancies In June",  # Naukri category pages
        "job vacancies in",  # Naukri pattern
        "Highest-Paying",  # articles
        "Top 20 [Roles",  # articles
        "Role & Responsibilities",  # definition pages
        "Apply Now\n",  # generic apply pages
    ]
    hits = sum(1 for s in listing_signals if s in content[:2000])
    if hits >= 2:
        return True
    return False


def _build_queries(user: dict) -> list[str]:
    """
    Build search queries from user preferences + CV skills.
    This is the core of why the tool is useful — queries are
    personalised to each user's actual profile.
    """
    locations = user.get("preferred_locations", ["Dublin Ireland"])
    primary_role = user.get("primary_role", "Full Stack Developer")
    secondary_roles = user.get("secondary_roles", [])
    job_types = user.get("job_types", {})

    # get top skills from user preferences OR fall back to CV
    key_skills = user.get("key_skills", [])
    if not key_skills:
        # extract from parsed CV if preferences not set
        cv = user.get("cv", {})
        structured = cv.get("structured", {})
        all_skills = structured.get("skills", [])
        # pick most relevant/specific skills (skip generic ones)
        skip = {
            "HTML5",
            "CSS3",
            "Git / GitHub",
            "Postman",
            "Agile / Scrum",
            "Performance Optimisation",
            "Technical Documentation",
        }
        key_skills = [s for s in all_skills if s not in skip][:6]

    all_roles = [primary_role] + secondary_roles

    queries = []
    for location in locations:
        for role in all_roles:
            # role-based queries — dork style to surface individual postings
            queries.append(f'"{role}" job "{location}"')
            queries.append(f'"{role}" "per annum" "{location}"')

            # skill-based queries
            if len(key_skills) >= 2:
                skill_pair = f"{key_skills[0]} {key_skills[1]}"
                queries.append(f'"{skill_pair}" developer job {location}')

            # job type specific
            if job_types.get("internship"):
                queries.append(f'"{role}" internship {location}')
            if job_types.get("contract"):
                queries.append(f'"{role}" contract {location}')

        # remote always gets its own query
        if job_types.get("remote"):
            queries.append(f'"{primary_role}" remote job Ireland')

    # deduplicate while preserving order
    seen = set()
    unique_queries = []
    for q in queries:
        if q not in seen:
            seen.add(q)
            unique_queries.append(q)

    return unique_queries


async def _fetch_jd_text(url: str) -> str:
    """Fallback fetch if Tavily raw_content is thin."""
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            headers = {"User-Agent": "Mozilla/5.0 (compatible; JobRadarBot/1.0)"}
            r = await client.get(url, headers=headers)
            if r.status_code == 200:
                return r.text[:10000]
    except Exception:
        pass
    return ""

@traceable(name="crawl_jobs_for_user", run_type="chain")
async def crawl_jobs_for_user(user: dict) -> dict:
    db = get_database()
    queries = _build_queries(user)

    print(f"[crawler] Running {len(queries)} queries for user {user.get('name')}")
    for q in queries:
        print(f"  → {q}")

    found = 0
    stored = 0
    skipped = 0

    for query in queries:
        try:
            results = tavily.search(
                query=query,
                search_depth="advanced",
                max_results=5,
                include_raw_content=True,
                include_domains=[
                    "irishjobs.ie",
                    "jobs.ie",
                    "recruitireland.com",
                    "naukri.com",
                    "foundit.in",
                ],
            )
        except Exception as e:
            print(f"[crawler] Tavily error for '{query}': {e}")
            continue

        for result in results.get("results", []):
            found += 1
            url = result.get("url", "")
            url_hash = _hash_url(url)

            # dedup
            existing = await db.jobs.find_one({"url_hash": url_hash})
            if existing:
                skipped += 1
                continue

            full_text = result.get("raw_content") or result.get("content", "")
            snippet = result.get("content", "")

            # skip listing pages
            if _is_listing_page(url, full_text):
                print(f"[crawler] Skipping listing page: {url}")
                skipped += 1
                continue

            # fallback fetch if content thin
            if len(full_text) < MIN_JD_LENGTH:
                full_text = await _fetch_jd_text(url)

            # still too thin — skip
            if len(full_text) < MIN_JD_LENGTH:
                skipped += 1
                continue

            doc = {
                "title": result.get("title", "Unknown Role"),
                "url": url,
                "url_hash": url_hash,
                "snippet": snippet[:500],
                "full_text": full_text,
                "source": "tavily",
                "query": query,
                "crawled_at": datetime.now(timezone.utc),
                "crawled_by": str(user["_id"]),
                "ratings": {},
            }

            await db.jobs.insert_one(doc)
            stored += 1
            print(f"[crawler] Stored: {doc['title']} — {url}")

    return {"found": found, "stored": stored, "skipped": skipped}
