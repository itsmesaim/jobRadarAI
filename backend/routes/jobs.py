"""
Jobs routes.

GET   /jobs              — list all jobs with user's rating
GET   /jobs/{id}/brief   — export job brief
PATCH /jobs/{id}/status  — update kanban status
GET   /jobs/{id}         — single job detail
POST  /jobs/rate-all     — trigger rating for all unrated jobs
POST  /jobs/manual       — paste a JD manually and rate it instantly
"""

import re
from datetime import datetime, timedelta, timezone
from typing import Literal

from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel

from database import get_database
from deps import get_current_user
from services.job_dedup import content_fingerprint, hash_url, job_exists_for_user
from services.rating import (
    RATING_IN_PROGRESS,
    generate_job_brief,
    is_billable_rating,
    rate_all_jobs_for_user,
    unrated_jobs_filter,
    rate_job_for_user,
)
from services.apply_pack import MIN_APPLY_PACK_SCORE, generate_apply_pack
from services.limits import (
    check_ai_token_quota,
    check_and_increment_apply_pack,
    check_and_increment_rating,
    get_remaining_ratings,
    get_user_usage,
    rating_limit_message,
    refund_apply_pack,
    refund_rating,
)
from services.url_fetch import fetch_job_page_text

router = APIRouter(prefix="/jobs", tags=["jobs"])

VALID_STATUSES = [
    "NEW",
    "SAVED",
    "APPLIED",
    "INTERVIEWING",
    "OFFER",
    "REJECTED",
    "FOLLOWUP",
    "HALF_APPLIED",
]

PIPELINE_STATUSES = [s for s in VALID_STATUSES if s != "NEW"]

# Statuses that represent completed/terminal actions — excluded from the default "Active" view
TERMINAL_STATUSES = ["APPLIED", "REJECTED", "OFFER"]


class StatusUpdate(BaseModel):
    status: str


class ManualJD(BaseModel):
    title: str
    company: str
    url: str = ""
    jd_text: str


class FetchUrlRequest(BaseModel):
    url: str


def _format_job(job: dict, user_id: str) -> dict:
    rating = job.get("ratings", {}).get(user_id, {})
    posted = job.get("posted_at") or job.get("crawled_at")
    # While a background rate-all worker has claimed this job it holds a
    # placeholder rating with verdict=RATING_IN_PROGRESS and score=0 so a
    # second overlapping run won't re-rate it. Never leak that internal
    # sentinel to the client — surface it as an explicit flag instead so
    # the UI can show a real "rating in progress" state.
    in_progress = rating.get("verdict") == RATING_IN_PROGRESS
    return {
        "id": str(job["_id"]),
        "title": job.get("title"),
        "url": job.get("url"),
        "snippet": job.get("snippet", "")[:300],
        "crawled_at": job.get("crawled_at"),
        "posted_at": posted,
        # True posting date only (None if the source never gave one) — lets
        # the UI distinguish "posted 20m ago" from "we just happened to pull
        # it a moment ago" (crawled_at) rather than always faking one from
        # the other.
        "posted_at_actual": job.get("posted_at"),
        "rated_at": rating.get("rated_at"),
        "source": job.get("source", "tavily"),
        "company": job.get("company", ""),
        "location": job.get("location", ""),
        "score": None if in_progress else rating.get("score", None),
        "matched_strengths": [] if in_progress else rating.get("matched_strengths", []),
        "gaps": [] if in_progress else rating.get("gaps", []),
        "verdict": (
            "Not rated yet" if in_progress else rating.get("verdict", "Not rated yet")
        ),
        "auto_reject": rating.get("auto_reject", False),
        "status": job.get(f"status_{user_id}", "NEW"),
        "rating_in_progress": in_progress,
    }


def _user_job_filter(user_id: str) -> dict:
    """Mongo filter: only jobs owned by this user (never shared/orphan rows)."""
    return {"crawled_by": user_id}


def _build_list_query(
    user_id: str,
    *,
    score_min: int,
    score_max: int,
    rating: str,
    status: str | None,
    source: str | None,
    q: str | None,
    exclude_terminal: bool = False,
) -> dict:
    """Mongo query for per-user job list (score/status/source/text in DB)."""
    hidden_key = f"hidden_{user_id}"
    status_key = f"status_{user_id}"
    rating_key = f"ratings.{user_id}.score"

    query: dict = {**_user_job_filter(user_id), hidden_key: {"$ne": True}}

    if status:
        query[status_key] = status
    elif exclude_terminal:
        query[status_key] = {"$nin": TERMINAL_STATUSES}

    if source:
        query["source"] = source

    and_clauses: list[dict] = []

    if q:
        pattern = re.escape(q.strip())
        if pattern:
            and_clauses.append(
                {
                    "$or": [
                        {"title": {"$regex": pattern, "$options": "i"}},
                        {"company": {"$regex": pattern, "$options": "i"}},
                    ]
                }
            )

    if rating == "unrated":
        query[f"ratings.{user_id}"] = {"$exists": False}
    elif rating == "rated":
        query[rating_key] = {"$gte": score_min, "$lte": score_max}
    elif score_min > 0 or score_max < 10:
        and_clauses.append(
            {
                "$or": [
                    {rating_key: {"$gte": score_min, "$lte": score_max}},
                    {f"ratings.{user_id}": {"$exists": False}},
                ]
            }
        )

    if and_clauses:
        query["$and"] = and_clauses

    return query


def _passes_job_filters(
    job: dict,
    formatted: dict,
    *,
    score_min: int,
    score_max: int,
    rating: str,
    status: str | None,
    source: str | None,
    q: str | None,
) -> bool:
    score = formatted.get("score")

    if rating == "unrated":
        if score is not None:
            return False
    elif rating == "rated":
        if score is None or score < score_min or score > score_max:
            return False
    elif score is not None and (score < score_min or score > score_max):
        return False

    if status and formatted.get("status") != status:
        return False
    if source and job.get("source") != source:
        return False
    if q:
        searchable = f"{job.get('title','')} {job.get('company','')}".lower()
        if q.lower() not in searchable:
            return False
    return True


def _dedupe_and_format_jobs(
    jobs: list[dict],
    user_id: str,
    *,
    score_min: int,
    score_max: int,
    rating: str,
    status: str | None,
    source: str | None,
    q: str | None,
) -> list[dict]:
    seen_fingerprints: set[str] = set()
    results: list[dict] = []
    for job in jobs:
        fp = job.get("content_fingerprint") or content_fingerprint(
            job.get("title", ""),
            job.get("company", ""),
            job.get("location", ""),
        )
        if fp in seen_fingerprints:
            continue

        formatted = _format_job(job, user_id)
        if not _passes_job_filters(
            job,
            formatted,
            score_min=score_min,
            score_max=score_max,
            rating=rating,
            status=status,
            source=source,
            q=q,
        ):
            continue

        seen_fingerprints.add(fp)
        results.append(formatted)
    return results


async def _list_kanban_jobs(
    db,
    user_id: str,
    *,
    score_min: int,
    score_max: int,
    rating: str,
    status: str | None,
    source: str | None,
    q: str | None,
) -> list[dict]:
    """Return all visible pipeline jobs plus recent NEW jobs.

    Pipeline jobs are always included so re-searching for new roles does not
    drop cards the user already moved on the board.
    """
    status_key = f"status_{user_id}"
    hidden_key = f"hidden_{user_id}"

    base = _user_job_filter(user_id)
    pipeline_jobs = await db.jobs.find(
        {
            **base,
            status_key: {"$in": PIPELINE_STATUSES},
            hidden_key: {"$ne": True},
        }
    ).to_list(length=500)

    new_jobs = (
        await db.jobs.find(
            {
                **base,
                hidden_key: {"$ne": True},
                "$or": [{status_key: {"$exists": False}}, {status_key: "NEW"}],
            }
        )
        .sort("crawled_at", -1)
        .limit(200)
        .to_list(length=200)
    )

    seen_ids: set[str] = set()
    merged: list[dict] = []
    for job in pipeline_jobs + new_jobs:
        job_id = str(job["_id"])
        if job_id in seen_ids:
            continue
        seen_ids.add(job_id)
        merged.append(job)

    return _dedupe_and_format_jobs(
        merged,
        user_id,
        score_min=score_min,
        score_max=score_max,
        rating=rating,
        status=status,
        source=source,
        q=q,
    )


# ── LIST ─────────────────────────────────────────────────
LIST_SCAN_CAP = 3000


@router.get("")
async def list_jobs(
    user=Depends(get_current_user),
    score_min: int = 0,
    score_max: int = 10,
    rating: str = "all",
    status: str = None,
    source: str = None,
    q: str = None,
    page: int = 1,
    limit: int = 20,
    kanban: bool = False,
    exclude_terminal: bool = False,
):
    db = get_database()
    user_id = str(user["_id"])

    if rating not in ("all", "rated", "unrated"):
        raise HTTPException(
            status_code=400,
            detail="rating must be one of: all, rated, unrated",
        )

    if kanban:
        results = await _list_kanban_jobs(
            db,
            user_id,
            score_min=score_min,
            score_max=score_max,
            rating=rating,
            status=status,
            source=source,
            q=q,
        )
        total = len(results)
        return {
            "jobs": results,
            "page": 1,
            "limit": total,
            "total": total,
            "pages": 1,
            "account_total": await db.jobs.count_documents(
                {**_user_job_filter(user_id), f"hidden_{user_id}": {"$ne": True}}
            ),
        }

    mongo_query = _build_list_query(
        user_id,
        score_min=score_min,
        score_max=score_max,
        rating=rating,
        status=status,
        source=source,
        q=q,
        exclude_terminal=exclude_terminal,
    )
    all_jobs = (
        await db.jobs.find(mongo_query)
        .sort([("posted_at", -1), ("crawled_at", -1)])
        .limit(LIST_SCAN_CAP)
        .to_list(length=LIST_SCAN_CAP)
    )

    filtered = _dedupe_and_format_jobs(
        all_jobs,
        user_id,
        score_min=score_min,
        score_max=score_max,
        rating=rating,
        status=status,
        source=source,
        q=q,
    )

    total = len(filtered)
    skip = (page - 1) * limit
    page_jobs = filtered[skip : skip + limit]
    account_total = await db.jobs.count_documents(
        {**_user_job_filter(user_id), f"hidden_{user_id}": {"$ne": True}}
    )

    return {
        "jobs": page_jobs,
        "page": page,
        "limit": limit,
        "total": total,
        "pages": max(1, (total + limit - 1) // limit) if total else 1,
        "account_total": account_total,
    }


# ── RATE ALL ─────────────────────────────────────────────
@router.post("/rate-all")
async def rate_all(background_tasks: BackgroundTasks, user=Depends(get_current_user)):
    db = get_database()
    user_id = str(user["_id"])

    # Quick visibility into the current "rating queue" size before accepting
    pending_count = 0
    try:
        pending_count = await db.jobs.count_documents(unrated_jobs_filter(user_id))
        print(
            f"[rating] [route] /rate-all: current pending unrated jobs in queue for user: {pending_count}"
        )
    except Exception:
        pass

    token_ok, token_msg = await check_ai_token_quota(user)
    if not token_ok:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=token_msg,
        )

    remaining = await get_remaining_ratings(user)
    if remaining <= 0:
        usage = await get_user_usage(user_id)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=rating_limit_message(usage.get("rating_limit", 0)),
        )

    if pending_count == 0:
        return {
            "message": "No unrated jobs to rate.",
            "queued": 0,
            "ratings_remaining": remaining,
        }

    print(
        f"[rating] [route] /rate-all accepted for user={user_id}, spawning background task rate_all_jobs_for_user (real work happens async)"
    )
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"last_manual_rate_at": datetime.now(timezone.utc)}},
    )
    background_tasks.add_task(rate_all_jobs_for_user, user)
    return {
        "message": "Rating started in background.",
        "queued": pending_count,
        "ratings_remaining": remaining,
        "will_rate_up_to": min(pending_count, remaining),
    }


# ── FETCH URL (server-side, SSRF-safe) ─────────────────────
@router.post("/fetch-url")
async def fetch_job_url(payload: FetchUrlRequest, user=Depends(get_current_user)):
    return await fetch_job_page_text(payload.url)


# ── MANUAL JD ────────────────────────────────────────────
@router.post("/manual")
async def add_manual_jd(payload: ManualJD, user=Depends(get_current_user)):
    db = get_database()
    user_id = str(user["_id"])

    url_hash = hash_url(payload.url or f"{payload.title}:{payload.company}")

    if await job_exists_for_user(
        db,
        user_id=user_id,
        url=payload.url or f"{payload.title}:{payload.company}",
        title=payload.title,
        company=payload.company,
    ):
        raise HTTPException(status_code=409, detail="Job already exists for you.")

    doc = {
        "title": f"{payload.title} — {payload.company}",
        "url": payload.url,
        "url_hash": url_hash,
        "content_fingerprint": content_fingerprint(payload.title, payload.company),
        "snippet": payload.jd_text[:400],
        "full_text": payload.jd_text,
        "source": "manual",
        "query": "manual",
        "crawled_at": datetime.now(timezone.utc),
        "crawled_by": str(user["_id"]),
        "ratings": {},
    }

    result = await db.jobs.insert_one(doc)
    job_doc = await db.jobs.find_one({"_id": result.inserted_id})

    token_ok, token_msg = await check_ai_token_quota(user)
    if not token_ok:
        return {
            "message": "Job added but AI token limit reached.",
            "id": str(result.inserted_id),
            "detail": token_msg,
        }

    allowed, quota_msg, _ = await check_and_increment_rating(user, jobs_to_rate=1)
    if not allowed:
        usage = await get_user_usage(user_id)
        return {
            "message": "Job added but rating limit reached.",
            "id": str(result.inserted_id),
            "detail": quota_msg or rating_limit_message(usage.get("rating_limit", 0)),
        }

    rating = await rate_job_for_user(job_doc, user)
    rating["rated_at"] = datetime.now(timezone.utc)

    await db.jobs.update_one(
        {"_id": result.inserted_id}, {"$set": {f"ratings.{user_id}": rating}}
    )

    if not is_billable_rating(rating):
        await refund_rating(user_id, 1)

    return {
        "message": "Job added and rated.",
        "id": str(result.inserted_id),
        "score": rating.get("score"),
        "verdict": rating.get("verdict"),
        "matched_strengths": rating.get("matched_strengths"),
        "gaps": rating.get("gaps"),
    }


# ── RE-RATE A SINGLE JOB (after CV/preferences/skills change) ────
@router.post("/{job_id}/rate")
async def rate_single_job(job_id: str, user=Depends(get_current_user)):
    """Force a fresh rating for one job, bypassing the 'already rated' skip.

    Useful after the user updates their CV, preferences, or skill
    overrides — the old score/verdict on this job may no longer reflect
    their profile.
    """
    db = get_database()
    user_id = str(user["_id"])

    job_doc = await db.jobs.find_one({"_id": ObjectId(job_id), "crawled_by": user_id})
    if not job_doc:
        raise HTTPException(status_code=404, detail="Job not found")

    token_ok, token_msg = await check_ai_token_quota(user)
    if not token_ok:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=token_msg
        )

    allowed, quota_msg, _ = await check_and_increment_rating(user, jobs_to_rate=1)
    if not allowed:
        usage = await get_user_usage(user_id)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=quota_msg or rating_limit_message(usage.get("rating_limit", 0)),
        )

    try:
        rating = await rate_job_for_user(job_doc, user)
    except Exception:
        await refund_rating(user_id, 1)
        raise HTTPException(status_code=500, detail="Re-rating failed. Try again.")

    rating["rated_at"] = datetime.now(timezone.utc)
    await db.jobs.update_one(
        {"_id": ObjectId(job_id)}, {"$set": {f"ratings.{user_id}": rating}}
    )

    if not is_billable_rating(rating):
        await refund_rating(user_id, 1)

    return {
        "message": "Job re-rated.",
        "score": rating.get("score"),
        "verdict": rating.get("verdict"),
        "matched_strengths": rating.get("matched_strengths"),
        "gaps": rating.get("gaps"),
        "auto_reject": rating.get("auto_reject"),
        "structural_mismatch": rating.get("structural_mismatch"),
        "tailoring_tips": rating.get("tailoring_tips"),
        "rated_at": rating.get("rated_at"),
    }


# ── BRIEF — must be before /{job_id} ─────────────────────
@router.get("/{job_id}/brief")
async def get_job_brief(job_id: str, user=Depends(get_current_user)):
    db = get_database()
    user_id = str(user["_id"])

    try:
        job = await db.jobs.find_one({"_id": ObjectId(job_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid job ID.")

    if not job or job.get("crawled_by") != user_id:
        raise HTTPException(status_code=404, detail="Job not found.")

    rating = job.get("ratings", {}).get(user_id, {})
    if not rating:
        raise HTTPException(
            status_code=400, detail="Job not rated yet. Run /jobs/rate-all first."
        )

    from services.jd_text import enrich_jd_from_url, is_incomplete_jd

    if is_incomplete_jd(job.get("full_text", "")):
        enriched = await enrich_jd_from_url(job.get("url", ""))
        if enriched:
            await db.jobs.update_one(
                {"_id": ObjectId(job_id)},
                {
                    "$set": {
                        "full_text": enriched,
                        "snippet": enriched[:400],
                    },
                    "$unset": {f"ratings.{user_id}": ""},
                },
            )
            job = await db.jobs.find_one({"_id": ObjectId(job_id)})
            raise HTTPException(
                status_code=409,
                detail="Job description was refreshed from the listing URL. Run Rate now again, then copy the brief.",
            )

    brief = await generate_job_brief(job, user, rating)
    return {"brief": brief}


@router.get("/{job_id}/apply-pack")
async def get_job_apply_pack(job_id: str, user=Depends(get_current_user)):
    db = get_database()
    user_id = str(user["_id"])

    try:
        job = await db.jobs.find_one({"_id": ObjectId(job_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid job ID.")

    if not job or job.get("crawled_by") != user_id:
        raise HTTPException(status_code=404, detail="Job not found.")

    rating = job.get("ratings", {}).get(user_id, {})
    if not rating:
        raise HTTPException(
            status_code=400, detail="Job not rated yet. Run Rate now first."
        )

    score = rating.get("score") or 0
    if score < MIN_APPLY_PACK_SCORE:
        raise HTTPException(
            status_code=400,
            detail=f"Apply pack is for jobs scoring {MIN_APPLY_PACK_SCORE}+. This job is {score}/10.",
        )

    from services.jd_text import enrich_jd_from_url, is_incomplete_jd

    if is_incomplete_jd(job.get("full_text", "")):
        enriched = await enrich_jd_from_url(job.get("url", ""))
        if enriched:
            await db.jobs.update_one(
                {"_id": ObjectId(job_id)},
                {
                    "$set": {"full_text": enriched, "snippet": enriched[:400]},
                    "$unset": {f"ratings.{user_id}": ""},
                },
            )
            raise HTTPException(
                status_code=409,
                detail="Job description was refreshed. Run Rate now again, then request the apply pack.",
            )
        raise HTTPException(
            status_code=400,
            detail="Job description is incomplete. Paste the full JD before using Apply pack.",
        )

    allowed, message, remaining = await check_and_increment_apply_pack(user)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=message
        )

    try:
        pack = await generate_apply_pack(job, user, rating)
    except ValueError as exc:
        await refund_apply_pack(user_id)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        await refund_apply_pack(user_id)
        raise HTTPException(
            status_code=500, detail="Failed to generate apply pack. Try again."
        ) from exc

    return {"pack": pack, "apply_packs_remaining": remaining}


# ── STATUS — must be before /{job_id} ────────────────────
@router.patch("/{job_id}/status")
async def update_status(
    job_id: str, payload: StatusUpdate, user=Depends(get_current_user)
):
    if payload.status not in VALID_STATUSES:
        raise HTTPException(
            status_code=400, detail=f"Invalid status. Choose from: {VALID_STATUSES}"
        )

    db = get_database()
    user_id = str(user["_id"])

    job = await db.jobs.find_one({"_id": ObjectId(job_id)})
    if not job or job.get("crawled_by") != user_id:
        raise HTTPException(status_code=404, detail="Job not found.")

    await db.jobs.update_one(
        {"_id": ObjectId(job_id)},
        {
            "$set": {
                f"status_{user_id}": payload.status,
                f"status_at_{user_id}": datetime.now(timezone.utc),
            }
        },
    )
    return {"message": "Status updated.", "status": payload.status}


# ── SINGLE JOB — must be last ────────────────────────────
@router.get("/{job_id}")
async def get_job(job_id: str, user=Depends(get_current_user)):
    db = get_database()
    user_id = str(user["_id"])

    try:
        job = await db.jobs.find_one({"_id": ObjectId(job_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid job ID.")

    if not job or job.get("crawled_by") != user_id:
        raise HTTPException(status_code=404, detail="Job not found.")

    result = _format_job(job, user_id)
    result["full_text"] = job.get("full_text", "")[:3000]
    return result


@router.delete("/{job_id}")
async def hide_job(job_id: str, user=Depends(get_current_user)):
    db = get_database()
    user_id = str(user["_id"])

    try:
        job = await db.jobs.find_one({"_id": ObjectId(job_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid job ID.")

    if not job or job.get("crawled_by") != user_id:
        raise HTTPException(status_code=404, detail="Job not found.")

    if job.get("source") == "manual":
        await db.jobs.delete_one({"_id": ObjectId(job_id)})
        return {"message": "Job deleted."}

    await db.jobs.update_one(
        {"_id": ObjectId(job_id)}, {"$set": {f"hidden_{user_id}": True}}
    )
    return {"message": "Job hidden."}


# ── User-facing bulk cleanup ──────────────────────────────


class UserCleanupRequest(BaseModel):
    filter_type: Literal["old", "by_status", "unrated"]
    older_than_days: int | None = 30
    statuses: list[str] | None = None


def _build_user_cleanup_query(user_id: str, req: UserCleanupRequest) -> dict:
    query: dict = {"crawled_by": user_id}
    if req.filter_type == "old":
        days = max(1, req.older_than_days or 30)
        query["crawled_at"] = {"$lt": datetime.now(timezone.utc) - timedelta(days=days)}
    elif req.filter_type == "by_status":
        statuses = req.statuses or ["REJECTED", "APPLIED", "OFFER"]
        query[f"status_{user_id}"] = {"$in": statuses}
    elif req.filter_type == "unrated":
        query[f"ratings.{user_id}"] = {"$exists": False}
    return query


@router.post("/cleanup/preview")
async def preview_user_cleanup(req: UserCleanupRequest, user=Depends(get_current_user)):
    db = get_database()
    user_id = str(user["_id"])
    query = _build_user_cleanup_query(user_id, req)
    count = await db.jobs.count_documents(query)
    return {"count": count, "filter_type": req.filter_type}


@router.delete("/cleanup")
async def execute_user_cleanup(req: UserCleanupRequest, user=Depends(get_current_user)):
    db = get_database()
    user_id = str(user["_id"])
    query = _build_user_cleanup_query(user_id, req)
    result = await db.jobs.delete_many(query)
    return {"deleted": result.deleted_count, "filter_type": req.filter_type}
