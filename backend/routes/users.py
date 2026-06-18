"""
User preference routes.

PATCH /users/preferences  — set locations, role, job types, skills
GET   /users/preferences  — get current preferences
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


class UserPreferences(BaseModel):
    preferred_locations: list[str] = ["Dublin Ireland"]
    primary_role: str = "Full Stack Developer"
    secondary_roles: list[str] = []
    job_types: JobTypes = JobTypes()
    min_salary: int = 0
    key_skills: list[str] = []


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
    }
