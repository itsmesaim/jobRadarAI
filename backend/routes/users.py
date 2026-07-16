"""
User preference routes.

PATCH /users/preferences  — set locations, role, job types, skills, constraints
GET   /users/preferences  — get current preferences
"""

"""
Skill override routes — candidate knowledge memory system.

POST /users/skill-overrides        — add or update a skill override
GET  /users/skill-overrides        — list all overrides
DELETE /users/skill-overrides/{skill} — remove a specific override

Also adds about_me to UserPreferences.
"""
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from core.security import verify_password
from database import get_database
from deps import get_current_user
from models.user import DeleteAccountRequest
from services.limits import get_user_usage
from services.text_cleanup import clean_candidate_text

router = APIRouter(prefix="/users", tags=["users"])


class JobTypes(BaseModel):
    full_time: bool = True
    internship: bool = False
    contract: bool = False
    remote: bool = True
    graduate: bool = False


class WorkMode(BaseModel):
    remote: bool = True
    hybrid: bool = True
    onsite: bool = False


class UserPreferences(BaseModel):
    preferred_locations: list[str] = ["Dublin Ireland"]
    primary_role: str = "Full Stack Developer"
    secondary_roles: list[str] = []
    job_types: JobTypes = JobTypes()
    min_salary: int = 0
    key_skills: list[str] = []
    experience_level: str = "mid"
    work_authorization: str = ""
    avoid_industries: list[str] = []
    work_mode: WorkMode = WorkMode()
    about_me: str = ""  # free-text career context, surfaced early in rating prompt
    email_reminders_enabled: bool = True  # daily high-score apply nudges via SMTP
    timezone: str = "Europe/Dublin"  # IANA tz, drives when auto-crawl/reminders fire


class SkillOverride(BaseModel):
    skill: str  # key e.g. "plotly"
    context: str  # candidate's description e.g. "used in BEng for ML visualisation"


# ── Preferences ───────────────────────────────────────────────────────────────


@router.patch("/preferences")
async def update_preferences(payload: UserPreferences, user=Depends(get_current_user)):
    db = get_database()
    prefs = payload.model_dump()

    if prefs["about_me"].strip():
        prefs["about_me"] = await clean_candidate_text(
            prefs["about_me"], "candidate career summary", user_id=str(user["_id"])
        )

    await db.users.update_one(
        {"_id": ObjectId(user["_id"])},
        {
            "$set": {
                "preferred_locations": prefs["preferred_locations"],
                "primary_role": prefs["primary_role"],
                "secondary_roles": prefs["secondary_roles"],
                "job_types": prefs["job_types"],
                "min_salary": prefs["min_salary"],
                "key_skills": prefs["key_skills"],
                "experience_level": prefs["experience_level"],
                "work_authorization": prefs["work_authorization"],
                "avoid_industries": prefs["avoid_industries"],
                "work_mode": prefs["work_mode"],
                "about_me": prefs["about_me"],
                "email_reminders_enabled": prefs["email_reminders_enabled"],
                "timezone": prefs["timezone"],
            }
        },
    )
    return {"message": "Preferences updated.", "preferences": prefs}


@router.get("/preferences")
async def get_preferences(user=Depends(get_current_user)):
    return {
        "preferred_locations": user.get("preferred_locations", ["Dublin Ireland"]),
        "primary_role": user.get("primary_role", "Full Stack Developer"),
        "secondary_roles": user.get("secondary_roles", []),
        "job_types": user.get("job_types", {}),
        "min_salary": user.get("min_salary", 0),
        "key_skills": user.get("key_skills", []),
        "experience_level": user.get("experience_level", "mid"),
        "work_authorization": user.get("work_authorization", ""),
        "avoid_industries": user.get("avoid_industries", []),
        "work_mode": user.get(
            "work_mode", {"remote": True, "hybrid": True, "onsite": False}
        ),
        "about_me": user.get("about_me", ""),
        "email_reminders_enabled": user.get("email_reminders_enabled", True),
        "timezone": user.get("timezone", "Europe/Dublin"),
    }


# ── Skill overrides ───────────────────────────────────────────────────────────


@router.post("/skill-overrides")
async def add_skill_override(payload: SkillOverride, user=Depends(get_current_user)):
    db = get_database()
    skill_key = payload.skill.lower().strip()

    await db.users.update_one(
        {"_id": ObjectId(user["_id"])},
        {"$set": {f"skill_overrides.{skill_key}": payload.context}},
    )
    return {
        "message": f"Override saved for '{skill_key}'.",
        "skill": skill_key,
        "context": payload.context,
    }


@router.get("/skill-overrides")
async def get_skill_overrides(user=Depends(get_current_user)):
    overrides = user.get("skill_overrides", {})
    return {"overrides": [{"skill": k, "context": v} for k, v in overrides.items()]}


@router.delete("/skill-overrides/{skill}")
async def delete_skill_override(skill: str, user=Depends(get_current_user)):
    db = get_database()
    skill_key = skill.lower().strip()

    await db.users.update_one(
        {"_id": ObjectId(user["_id"])}, {"$unset": {f"skill_overrides.{skill_key}": ""}}
    )
    return {"message": f"Override removed for '{skill_key}'."}


# ── Data transparency & deletion ─────────────────────────────────────────────


@router.get("/data-summary")
async def get_data_summary(user=Depends(get_current_user)):
    """Tell the user exactly what JobRadar stores about them."""
    db = get_database()
    user_id = str(user["_id"])
    cv = user.get("cv")
    overrides = user.get("skill_overrides", {})

    jobs_total = await db.jobs.count_documents({"crawled_by": user_id})
    jobs_rated = await db.jobs.count_documents(
        {"crawled_by": user_id, f"ratings.{user_id}": {"$exists": True}}
    )
    jobs_manual = await db.jobs.count_documents(
        {"crawled_by": user_id, "source": "manual"}
    )
    jobs_hidden = await db.jobs.count_documents(
        {f"hidden_{user_id}": True, "crawled_by": user_id}
    )

    usage = await get_user_usage(user_id)

    cv_summary = None
    if cv:
        structured = cv.get("structured", {})
        cv_summary = {
            "filename": cv.get("filename"),
            "uploaded_at": cv.get("uploaded_at"),
            "skills_count": len(structured.get("skills", [])),
            "experience_count": len(structured.get("experience", [])),
            "projects_count": len(structured.get("projects", [])),
            "education_count": len(structured.get("education", [])),
            "has_raw_text": bool(cv.get("raw_text")),
        }

    return {
        "roast": (
            "We're not Google. We're also not your lawyer. But we ARE keeping your CV, "
            "job prefs, and every listing you've crawled in a database like it's a "
            "Pokémon card collection. Here's the inventory."
        ),
        "legal_note": (
            "JobRadar is a personal job-search tool. Listings come from third-party APIs "
            "(Jooble, Indeed/JobsAPI, etc.) — each has its own terms. Your CV and "
            "preferences may be sent to an AI provider for job matching. This is not "
            "legal advice; for a public product you'd want a proper Privacy Policy. "
            "You can download or delete your data below anytime."
        ),
        "account": {
            "name": user.get("name"),
            "email": user.get("email"),
            "created_at": user.get("created_at"),
        },
        "cv": cv_summary,
        "preferences": {
            "has_preferences": bool(user.get("primary_role")),
            "locations_count": len(user.get("preferred_locations", [])),
            "skills_count": len(user.get("key_skills", [])),
            "about_me_chars": len(user.get("about_me", "") or ""),
            "has_work_authorization": bool(user.get("work_authorization")),
        },
        "skill_overrides_count": len(overrides),
        "jobs": {
            "total": jobs_total,
            "rated": jobs_rated,
            "manual": jobs_manual,
            "hidden": jobs_hidden,
        },
        "usage": {
            "searches_used": usage.get("searches_used", 0),
            "ratings_used": usage.get("ratings_used", 0),
        },
        "third_party_services": [
            "Jooble API — job listings",
            "JobsAPI (Indeed) — job listings",
            "AI/LLM provider — CV + job description matching",
            "MongoDB — data storage",
        ],
        "stored_items": [
            {
                "key": "account",
                "label": "Account (name, email, password hash)",
                "stored": True,
            },
            {
                "key": "cv",
                "label": "CV — parsed PDF text & structured profile",
                "stored": bool(cv),
            },
            {
                "key": "preferences",
                "label": "Job preferences (roles, locations, salary, about you)",
                "stored": bool(
                    user.get("primary_role") or user.get("preferred_locations")
                ),
            },
            {
                "key": "skill_overrides",
                "label": "Skill overrides (your custom skill notes)",
                "stored": len(overrides) > 0,
            },
            {
                "key": "jobs",
                "label": "Saved job listings, ratings, Kanban status",
                "stored": jobs_total > 0,
            },
            {
                "key": "usage",
                "label": "Search & rating usage counters",
                "stored": True,
            },
        ],
    }


@router.get("/data-export")
async def export_my_data(user=Depends(get_current_user)):
    """Download everything JobRadar stores for this user (GDPR-style portability)."""
    db = get_database()
    user_id = str(user["_id"])

    jobs = await db.jobs.find({"crawled_by": user_id}).to_list(length=2000)
    exported_jobs = []
    for job in jobs:
        rating = job.get("ratings", {}).get(user_id, {})
        exported_jobs.append(
            {
                "id": str(job["_id"]),
                "title": job.get("title"),
                "url": job.get("url"),
                "source": job.get("source"),
                "crawled_at": job.get("crawled_at"),
                "status": job.get(f"status_{user_id}", "NEW"),
                "hidden": bool(job.get(f"hidden_{user_id}")),
                "score": rating.get("score"),
                "verdict": rating.get("verdict"),
                "matched_strengths": rating.get("matched_strengths", []),
                "gaps": rating.get("gaps", []),
            }
        )

    cv = user.get("cv")
    cv_export = None
    if cv:
        cv_export = {
            "filename": cv.get("filename"),
            "uploaded_at": cv.get("uploaded_at"),
            "structured": cv.get("structured"),
            "raw_text_included": True,
            "raw_text": cv.get("raw_text", ""),
        }

    return {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "account": {
            "name": user.get("name"),
            "email": user.get("email"),
            "created_at": user.get("created_at"),
        },
        "cv": cv_export,
        "preferences": {
            "preferred_locations": user.get("preferred_locations", []),
            "primary_role": user.get("primary_role"),
            "secondary_roles": user.get("secondary_roles", []),
            "job_types": user.get("job_types", {}),
            "min_salary": user.get("min_salary", 0),
            "key_skills": user.get("key_skills", []),
            "experience_level": user.get("experience_level"),
            "work_authorization": user.get("work_authorization", ""),
            "avoid_industries": user.get("avoid_industries", []),
            "work_mode": user.get("work_mode", {}),
            "about_me": user.get("about_me", ""),
        },
        "skill_overrides": user.get("skill_overrides", {}),
        "jobs": exported_jobs,
    }


@router.delete("/account", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(payload: DeleteAccountRequest, user=Depends(get_current_user)):
    """Permanently delete the user account and all associated data."""
    if not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect password.",
        )

    db = get_database()
    user_id = str(user["_id"])

    result = await db.jobs.delete_many({"crawled_by": user_id})
    deleted = await db.users.delete_one({"_id": ObjectId(user["_id"])})

    if deleted.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found.")

    print(f"[privacy] Deleted account {user_id} and {result.deleted_count} jobs")
