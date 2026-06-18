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
    rate_all_jobs_for_user,
    rate_job_for_user,
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


class StatusUpdate(BaseModel):
    status: str


class ManualJD(BaseModel):
    title: str
    company: str
    url: str = ""
    jd_text: str


def _format_job(job: dict, user_id: str) -> dict:
    rating = job.get("ratings", {}).get(user_id, {})
    return {
        "id": str(job["_id"]),
        "title": job.get("title"),
        "url": job.get("url"),
        "snippet": job.get("snippet", "")[:300],
        "crawled_at": job.get("crawled_at"),
        "source": job.get("source", "tavily"),
        "score": rating.get("score", None),
        "matched_strengths": rating.get("matched_strengths", []),
        "gaps": rating.get("gaps", []),
        "verdict": rating.get("verdict", "Not rated yet"),
        "auto_reject": rating.get("auto_reject", False),
        "status": job.get(f"status_{user_id}", "NEW"),
    }


# ── LIST ─────────────────────────────────────────────────
@router.get("")
async def list_jobs(
    user=Depends(get_current_user),
    score_min: int = 0,
    score_max: int = 10,
    status: str = None,
    source: str = None,
    page: int = 1,
    limit: int = 20,
):
    db = get_database()
    user_id = str(user["_id"])

    skip = (page - 1) * limit
    all_jobs = (
        await db.jobs.find()
        .sort("crawled_at", -1)
        .skip(skip)
        .limit(limit * 3)
        .to_list(length=limit * 3)
    )

    results = []
    for job in all_jobs:
        formatted = _format_job(job, user_id)
        score = formatted.get("score")
        if score is not None:
            if score < score_min or score > score_max:
                continue
        if status and formatted.get("status") != status:
            continue
        if source and job.get("source") != source:
            continue
        results.append(formatted)
        if len(results) >= limit:
            break

    total = await db.jobs.count_documents({})
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
    background_tasks.add_task(rate_all_jobs_for_user, user)
    return {"message": "Rating started in background. Check /jobs in 2-3 minutes."}


# ── MANUAL JD ────────────────────────────────────────────
@router.post("/manual")
async def add_manual_jd(payload: ManualJD, user=Depends(get_current_user)):
    db = get_database()
    user_id = str(user["_id"])

    url_hash = hashlib.sha256(
        (payload.url or payload.title + payload.company).encode()
    ).hexdigest()

    existing = await db.jobs.find_one({"url_hash": url_hash})
    if existing:
        raise HTTPException(status_code=409, detail="Job already exists.")

    doc = {
        "title": f"{payload.title} — {payload.company}",
        "url": payload.url,
        "url_hash": url_hash,
        "snippet": payload.jd_text[:400],
        "full_text": payload.jd_text,
        "source": "manual",
        "query": "manual",
        "crawled_at": datetime.now(timezone.utc),
        "ratings": {},
    }

    result = await db.jobs.insert_one(doc)
    job_doc = await db.jobs.find_one({"_id": result.inserted_id})

    rating = await rate_job_for_user(job_doc, user)
    rating["rated_at"] = datetime.now(timezone.utc)

    await db.jobs.update_one(
        {"_id": result.inserted_id}, {"$set": {f"ratings.{user_id}": rating}}
    )

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

    if not job:
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

    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    result = _format_job(job, user_id)
    result["full_text"] = job.get("full_text", "")[:3000]
    return result
