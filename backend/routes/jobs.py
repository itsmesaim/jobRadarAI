"""
Jobs routes.

GET   /jobs              — list all jobs with user's rating
GET   /jobs/{id}/brief   — export job brief
PATCH /jobs/{id}/status  — update kanban status
GET   /jobs/{id}         — single job detail
POST  /jobs/rate-all     — trigger rating for all unrated jobs
POST  /jobs/manual       — paste a JD manually and rate it instantly
"""

import hashlib
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel

from database import get_database
from deps import get_current_user
from services.rating import (
    generate_job_brief,
    is_billable_rating,
    rate_all_jobs_for_user,
    rate_job_for_user,
)
from services.limits import (
    check_ai_token_quota,
    check_and_increment_rating,
    get_remaining_ratings,
    get_user_usage,
    rating_limit_message,
    refund_rating,
)

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


class StatusUpdate(BaseModel):
    status: str


class ManualJD(BaseModel):
    title: str
    company: str
    url: str = ""
    jd_text: str


def _format_job(job: dict, user_id: str) -> dict:
    rating = job.get("ratings", {}).get(user_id, {})
    posted = job.get("posted_at") or job.get("crawled_at")
    return {
        "id": str(job["_id"]),
        "title": job.get("title"),
        "url": job.get("url"),
        "snippet": job.get("snippet", "")[:300],
        "crawled_at": job.get("crawled_at"),
        "posted_at": posted,
        "source": job.get("source", "tavily"),
        "company": job.get("company", ""),
        "location": job.get("location", ""),
        "score": rating.get("score", None),
        "matched_strengths": rating.get("matched_strengths", []),
        "gaps": rating.get("gaps", []),
        "verdict": rating.get("verdict", "Not rated yet"),
        "auto_reject": rating.get("auto_reject", False),
        "status": job.get(f"status_{user_id}", "NEW"),
    }


def _passes_job_filters(
    job: dict,
    formatted: dict,
    *,
    score_min: int,
    score_max: int,
    status: str | None,
    source: str | None,
    q: str | None,
) -> bool:
    score = formatted.get("score")
    if score is not None and (score < score_min or score > score_max):
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


async def _list_kanban_jobs(
    db,
    user_id: str,
    *,
    score_min: int,
    score_max: int,
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

    pipeline_jobs = await db.jobs.find(
        {
            "crawled_by": user_id,
            status_key: {"$in": PIPELINE_STATUSES},
            hidden_key: {"$ne": True},
        }
    ).to_list(length=500)

    new_jobs = (
        await db.jobs.find(
            {
                "crawled_by": user_id,
                hidden_key: {"$ne": True},
                "$or": [{status_key: {"$exists": False}}, {status_key: "NEW"}],
            }
        )
        .sort("crawled_at", -1)
        .limit(200)
        .to_list(length=200)
    )

    seen_ids: set[str] = set()
    results: list[dict] = []
    for job in pipeline_jobs + new_jobs:
        job_id = str(job["_id"])
        if job_id in seen_ids:
            continue
        seen_ids.add(job_id)

        formatted = _format_job(job, user_id)
        if not _passes_job_filters(
            job,
            formatted,
            score_min=score_min,
            score_max=score_max,
            status=status,
            source=source,
            q=q,
        ):
            continue
        results.append(formatted)

    return results


# ── LIST ─────────────────────────────────────────────────
@router.get("")
async def list_jobs(
    user=Depends(get_current_user),
    score_min: int = 0,
    score_max: int = 10,
    status: str = None,
    source: str = None,
    q: str = None,
    page: int = 1,
    limit: int = 20,
    kanban: bool = False,
):
    db = get_database()
    user_id = str(user["_id"])

    if kanban:
        results = await _list_kanban_jobs(
            db,
            user_id,
            score_min=score_min,
            score_max=score_max,
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
        }

    skip = (page - 1) * limit
    all_jobs = (
        await db.jobs.find({"crawled_by": user_id})
        .sort("crawled_at", -1)
        .skip(skip)
        .limit(limit * 5)
        .to_list(length=limit * 5)
    )

    results = []
    for job in all_jobs:
        if job.get(f"hidden_{user_id}"):
            continue

        formatted = _format_job(job, user_id)
        if not _passes_job_filters(
            job,
            formatted,
            score_min=score_min,
            score_max=score_max,
            status=status,
            source=source,
            q=q,
        ):
            continue
        results.append(formatted)
        if len(results) >= limit:
            break

    total = await db.jobs.count_documents({"crawled_by": user_id})
    return {
        "jobs": results,
        "page": page,
        "limit": limit,
        "total": total,
        "pages": (total + limit - 1) // limit,
    }


# ── RATE ALL ─────────────────────────────────────────────
@router.post("/rate-all")
async def rate_all(background_tasks: BackgroundTasks, user=Depends(get_current_user)):
    db = get_database()
    user_id = str(user["_id"])

    # Quick visibility into the current "rating queue" size before accepting
    pending_count = 0
    try:
        pending_count = await db.jobs.count_documents(
            {"crawled_by": user_id, f"ratings.{user_id}": {"$exists": False}}
        )
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
    background_tasks.add_task(rate_all_jobs_for_user, user)
    return {
        "message": "Rating started in background.",
        "queued": pending_count,
        "ratings_remaining": remaining,
        "will_rate_up_to": min(pending_count, remaining),
    }


# ── MANUAL JD ────────────────────────────────────────────
@router.post("/manual")
async def add_manual_jd(payload: ManualJD, user=Depends(get_current_user)):
    db = get_database()
    user_id = str(user["_id"])

    url_hash = hashlib.sha256(
        (payload.url or payload.title + payload.company).encode()
    ).hexdigest()

    # per-user: allow same JD for different users
    existing = await db.jobs.find_one({"url_hash": url_hash, "crawled_by": user_id})
    if existing:
        raise HTTPException(status_code=409, detail="Job already exists for you.")

    doc = {
        "title": f"{payload.title} — {payload.company}",
        "url": payload.url,
        "url_hash": url_hash,
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

    brief = await generate_job_brief(job, user, rating)
    return {"brief": brief}


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
        {"_id": ObjectId(job_id)}, {"$set": {f"status_{user_id}": payload.status}}
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
