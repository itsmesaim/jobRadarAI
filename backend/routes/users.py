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
from bson import ObjectId
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from database import get_database
from deps import get_current_user

router = APIRouter(prefix="/users", tags=["users"])


class JobTypes(BaseModel):
    full_time: bool = True
    internship: bool = False
    contract: bool = False
    remote: bool = True


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


class SkillOverride(BaseModel):
    skill: str  # key e.g. "plotly"
    context: str  # candidate's description e.g. "used in BEng for ML visualisation"


# ── Preferences ───────────────────────────────────────────────────────────────


@router.patch("/preferences")
async def update_preferences(payload: UserPreferences, user=Depends(get_current_user)):
    db = get_database()
    prefs = payload.model_dump()

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
