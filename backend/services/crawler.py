"""
Crawler service.
Tavily search → fetch full JD → dedup → store in MongoDB.
"""

import hashlib
from datetime import datetime, timezone

import httpx
from tavily import TavilyClient

from config import settings
from database import get_database

tavily = TavilyClient(api_key=settings.tavily_api_key)


def _hash_url(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()


async def fetch_full_text(url: str) -> str:
    """Fetch full page text from job URL."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url, follow_redirects=True)
            return r.text[:8000]  # cap at 8k chars
    except Exception:
        return ""


async def crawl_jobs_for_user(user: dict) -> dict:
    """
    Run a full crawl cycle for one user.
    Returns { found, stored, skipped }
    """
    db = get_database()

    # build search terms from user prefs
    locations = user.get("preferred_locations", ["Dublin Ireland"])
    role = user.get("primary_role", "Full Stack Developer")
    job_types = user.get("job_types", {})

    queries = []
    for location in locations:
        queries.append(f"{role} jobs {location}")
        if job_types.get("internship"):
            queries.append(f"{role} internship {location}")
        if job_types.get("remote"):
            queries.append(f"{role} remote jobs")

    found = 0
    stored = 0
    skipped = 0

    for query in queries:
        try:
            results = tavily.search(
                query=query,
                search_depth="basic",
                max_results=5,
                include_domains=[
                    "irishjobs.ie",
                    "jobs.ie",
                    "indeed.com",
                    "linkedin.com",
                    "glassdoor.com",
                ],
            )
        except Exception as e:
            print(f"Tavily error for query '{query}': {e}")
            continue

        for result in results.get("results", []):
            found += 1
            url = result.get("url", "")
            url_hash = _hash_url(url)

            # dedup check
            existing = await db.jobs.find_one({"url_hash": url_hash})
            if existing:
                skipped += 1
                continue

            # fetch full text
            full_text = await fetch_full_text(url)
            snippet = result.get("content", "")

            doc = {
                "title": result.get("title", "Unknown Role"),
                "url": url,
                "url_hash": url_hash,
                "snippet": snippet,
                "full_text": full_text or snippet,
                "source": "tavily",
                "query": query,
                "crawled_at": datetime.now(timezone.utc),
                "ratings": {},  # per-user ratings added in Week 2
            }

            await db.jobs.insert_one(doc)
            stored += 1

    return {"found": found, "stored": stored, "skipped": skipped}
