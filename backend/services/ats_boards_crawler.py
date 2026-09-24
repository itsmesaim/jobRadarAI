"""Company ATS board crawler: Greenhouse / Lever / Ashby public job feeds.

Free, keyless board APIs. User supplies board URLs or `ats:slug` entries in
`ats_boards` (Settings). No Google scrape, no Apify.
# working pattern that doesn't need a browser.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx
from bson import ObjectId

from database import get_database
from services.job_dedup import content_fingerprint, hash_url, job_exists_for_user
from services.jooble_crawler import _clean_html, _is_relevant_job

_MAX_PER_BOARD = 40
_USER_AGENT = "JobRadar/1.0 (+ats-boards; company career sync)"

_GH_HOSTS = (
    "boards.greenhouse.io",
    "job-boards.greenhouse.io",
    "boards-api.greenhouse.io",
)
_LEVER_HOSTS = ("jobs.lever.co", "api.lever.co", "api.eu.lever.co")
_ASHBY_HOSTS = ("jobs.ashbyhq.com", "api.ashbyhq.com")


def parse_ats_board(entry: str) -> tuple[str, str] | None:
    """Return (ats, slug) from a URL or `greenhouse:stripe` / bare slug guess."""
    raw = (entry or "").strip()
    if not raw:
        return None
    lower = raw.lower()

    if ":" in raw and "://" not in raw:
        ats, _, slug = raw.partition(":")
        ats, slug = ats.strip().lower(), slug.strip().strip("/")
        if ats in ("greenhouse", "lever", "ashby") and slug:
            return ats, slug
        return None

    if "://" not in raw:
        # bare token: Greenhouse is the common default for tech boards
        slug = raw.strip("/")
        return ("greenhouse", slug) if slug else None

    try:
        parsed = urlparse(raw if "://" in raw else f"https://{raw}")
    except Exception:
        return None
    host = (parsed.netloc or "").lower().removeprefix("www.")
    parts = [p for p in (parsed.path or "").split("/") if p]

    if any(host.endswith(h) for h in _GH_HOSTS) or "greenhouse" in host:
        if parts:
            return "greenhouse", parts[0]
    if any(host.endswith(h) for h in _LEVER_HOSTS) or "lever.co" in host:
        if parts:
            return "lever", parts[0]
    if any(host.endswith(h) for h in _ASHBY_HOSTS) or "ashby" in host:
        if parts:
            # jobs.ashbyhq.com/{slug}/... or posting-api/job-board/{slug}
            if parts[0] == "posting-api" and len(parts) >= 3:
                return "ashby", parts[2]
            return "ashby", parts[0]
    return None


def _boards_for_user(user: dict) -> list[tuple[str, str]]:
    seen: set[tuple[str, str]] = set()
    out: list[tuple[str, str]] = []
    for entry in user.get("ats_boards") or []:
        parsed = parse_ats_board(str(entry))
        if not parsed or parsed in seen:
            continue
        seen.add(parsed)
        out.append(parsed)
    return out


async def _fetch_greenhouse(client: httpx.AsyncClient, slug: str) -> list[dict]:
    url = f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true"
    resp = await client.get(url)
    if resp.status_code == 404:
        return []
    resp.raise_for_status()
    jobs = []
    for j in resp.json().get("jobs") or []:
        loc = j.get("location") or {}
        loc_name = loc.get("name") if isinstance(loc, dict) else str(loc or "")
        html = j.get("content") or ""
        text = _clean_html(html)
        jobs.append(
            {
                "title": j.get("title") or "Unknown Role",
                "url": j.get("absolute_url") or "",
                "company": j.get("company_name") or slug,
                "location": loc_name,
                "full_text": text,
                "snippet": text[:400],
                "posted_at": j.get("first_published") or j.get("updated_at"),
                "source": "greenhouse",
                "query": f"greenhouse:{slug}",
            }
        )
    return jobs


async def _fetch_lever(client: httpx.AsyncClient, slug: str) -> list[dict]:
    jobs: list[dict] = []
    for base in (
        f"https://api.lever.co/v0/postings/{slug}?mode=json",
        f"https://api.eu.lever.co/v0/postings/{slug}?mode=json",
    ):
        resp = await client.get(base)
        if resp.status_code == 404:
            continue
        resp.raise_for_status()
        data = resp.json()
        if not isinstance(data, list):
            continue
        for j in data:
            cats = j.get("categories") or {}
            loc = cats.get("location") or j.get("country") or ""
            text = (
                j.get("descriptionPlain")
                or _clean_html(j.get("description") or "")
                or ""
            )
            jobs.append(
                {
                    "title": j.get("text") or "Unknown Role",
                    "url": j.get("hostedUrl") or j.get("applyUrl") or "",
                    "company": slug,
                    "location": loc,
                    "full_text": text,
                    "snippet": text[:400],
                    "posted_at": j.get("createdAt"),
                    "source": "lever",
                    "query": f"lever:{slug}",
                }
            )
        if jobs:
            break
    return jobs


async def _fetch_ashby(client: httpx.AsyncClient, slug: str) -> list[dict]:
    url = f"https://api.ashbyhq.com/posting-api/job-board/{slug}"
    resp = await client.get(url)
    if resp.status_code == 404:
        return []
    resp.raise_for_status()
    jobs = []
    for j in resp.json().get("jobs") or []:
        if j.get("isListed") is False:
            continue
        text = j.get("descriptionPlain") or _clean_html(j.get("descriptionHtml") or "")
        loc = j.get("location") or ""
        if j.get("isRemote") or (j.get("workplaceType") or "").lower() == "remote":
            loc = f"{loc} (Remote)".strip() if loc else "Remote"
        jobs.append(
            {
                "title": j.get("title") or "Unknown Role",
                "url": j.get("jobUrl") or j.get("applyUrl") or "",
                "company": slug,
                "location": loc,
                "full_text": text,
                "snippet": text[:400],
                "posted_at": j.get("publishedAt"),
                "source": "ashby",
                "query": f"ashby:{slug}",
            }
        )
    return jobs


_FETCHERS = {
    "greenhouse": _fetch_greenhouse,
    "lever": _fetch_lever,
    "ashby": _fetch_ashby,
}


async def crawl_jobs_for_user_ats_boards(
    user: dict, max_stored: int | None = None
) -> dict:
    db = get_database()
    fresh = await db.users.find_one({"_id": ObjectId(user["_id"])})
    if fresh:
        user = fresh

    boards = _boards_for_user(user)
    found = stored = skipped = 0
    if not boards:
        return {"found": 0, "stored": 0, "skipped": 0, "boards": 0}

    def _at_cap() -> bool:
        return max_stored is not None and stored >= max_stored

    headers = {"User-Agent": _USER_AGENT, "Accept": "application/json"}
    async with httpx.AsyncClient(timeout=25, headers=headers) as client:
        for ats, slug in boards:
            if _at_cap():
                break
            fetcher = _FETCHERS[ats]
            try:
                await asyncio.sleep(0.35)
                listings = await fetcher(client, slug)
            except Exception as e:
                print(f"[ats] {ats}:{slug} error: {e}", flush=True)
                continue

            print(f"[ats] {ats}:{slug} → {len(listings)} openings", flush=True)
            kept = 0
            for job in listings:
                if _at_cap() or kept >= _MAX_PER_BOARD:
                    break
                found += 1
                url = job.get("url") or ""
                title = job.get("title") or "Unknown Role"
                company = job.get("company") or slug
                location = job.get("location") or ""
                full_text = job.get("full_text") or ""
                user_id = str(user["_id"])

                if not url or len(full_text) < 80:
                    skipped += 1
                    continue
                if await job_exists_for_user(
                    db,
                    user_id=user_id,
                    url=url,
                    title=title,
                    company=company,
                    location=location,
                ):
                    skipped += 1
                    continue
                if not _is_relevant_job(full_text, job.get("snippet") or "", user):
                    skipped += 1
                    continue

                posted_at = None
                raw_posted = job.get("posted_at")
                if raw_posted:
                    try:
                        if isinstance(raw_posted, (int, float)):
                            # Lever sometimes uses ms epoch
                            ts = float(raw_posted)
                            if ts > 1e12:
                                ts /= 1000.0
                            posted_at = datetime.fromtimestamp(
                                ts, tz=timezone.utc
                            ).isoformat()
                        else:
                            posted_at = datetime.fromisoformat(
                                str(raw_posted).replace("Z", "+00:00")
                            ).isoformat()
                    except Exception:
                        posted_at = None

                doc = {
                    "title": title,
                    "url": url,
                    "url_hash": hash_url(url),
                    "content_fingerprint": content_fingerprint(
                        title, company, location
                    ),
                    "snippet": (job.get("snippet") or full_text)[:400],
                    "full_text": full_text,
                    "company": company,
                    "location": location,
                    "salary_text": "",
                    "source": job["source"],
                    "query": job.get("query") or f"{ats}:{slug}",
                    "search_location": location,
                    "crawled_at": datetime.now(timezone.utc),
                    "posted_at": posted_at,
                    "crawled_by": user_id,
                    "ratings": {},
                }
                await db.jobs.insert_one(doc)
                stored += 1
                kept += 1
                print(f"[ats] Stored: {title} @ {company} ({ats})", flush=True)

    return {"found": found, "stored": stored, "skipped": skipped, "boards": len(boards)}


if __name__ == "__main__":
    # Self-check: parse + live fetch (no DB).
    assert parse_ats_board("greenhouse:stripe") == ("greenhouse", "stripe")
    assert parse_ats_board("https://boards.greenhouse.io/stripe/") == (
        "greenhouse",
        "stripe",
    )
    assert parse_ats_board("https://jobs.ashbyhq.com/openai") == ("ashby", "openai")
    assert parse_ats_board("https://jobs.lever.co/unlimit/abc") == ("lever", "unlimit")

    async def _demo():
        async with httpx.AsyncClient(
            timeout=25, headers={"User-Agent": _USER_AGENT}
        ) as client:
            gh = await _fetch_greenhouse(client, "stripe")
            as_ = await _fetch_ashby(client, "openai")
            lv = await _fetch_lever(client, "unlimit")
            assert gh and gh[0]["url"] and len(gh[0]["full_text"]) > 80
            assert as_ and as_[0]["url"]
            assert lv and lv[0]["url"]
            print(
                f"ok greenhouse={len(gh)} ashby={len(as_)} lever={len(lv)} "
                f"sample={gh[0]['title']!r}"
            )

    asyncio.run(_demo())
