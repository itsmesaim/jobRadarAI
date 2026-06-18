"""
Rating service.

Uses LangChain's structured output (Pydantic model) instead of manual
JSON parsing. This forces the LLM to return valid structured data —
no more regex stripping, no more JSON parse failures.
"""

import asyncio
import json
from datetime import datetime, timezone

from bson import ObjectId
from langchain_core.messages import HumanMessage, SystemMessage
from langsmith import traceable
from pydantic import BaseModel, Field

from database import get_database
from services.llm import get_llm


class JobRating(BaseModel):
    score: int = Field(description="Fit score from 1-10. Be honest, do not inflate.")
    matched_strengths: list[str] = Field(
        description="Specific ways the candidate's CV matches the JD requirements"
    )
    gaps: list[str] = Field(
        description="Specific JD requirements the candidate is missing or weak on"
    )
    verdict: str = Field(
        description="One sentence summary with an actionable suggestion"
    )
    auto_reject: bool = Field(
        description="True if job requires visa/location candidate cannot meet, "
        "or a hard skill they completely lack"
    )


RATING_SYSTEM_PROMPT = """
You are a senior technical recruiter. Rate how well this candidate's CV
matches the job description.

Be honest. Do not inflate scores. If the JD text is too short, vague, or
appears to be a search results page rather than an actual job posting,
score 0 and explain why in the verdict.
""".strip()

@traceable(name="rate_job_for_user", run_type="chain")
async def rate_job_for_user(job: dict, user: dict) -> dict:
    cv = user.get("cv", {})
    if not cv:
        return {
            "score": 0,
            "matched_strengths": [],
            "gaps": [],
            "verdict": "No CV uploaded. Upload your CV first.",
            "auto_reject": False,
        }

    structured = cv.get("structured", {})
    cv_text = f"""
Name: {structured.get('name')}
Summary: {structured.get('summary')}
Skills: {', '.join(structured.get('skills', []))}
Experience: {json.dumps(structured.get('experience', []))}
Projects: {json.dumps(structured.get('projects', []))}
Education: {json.dumps(structured.get('education', []))}
""".strip()

    jd_text = job.get("full_text") or job.get("snippet", "")
    if len(jd_text) < 200:
        return {
            "score": 0,
            "matched_strengths": [],
            "gaps": [],
            "verdict": "JD text too short to rate accurately — likely a listing page, not a real posting.",
            "auto_reject": False,
        }

    llm = get_llm()
    structured_llm = llm.with_structured_output(JobRating)

    messages = [
        SystemMessage(content=RATING_SYSTEM_PROMPT),
        HumanMessage(
            content=f"JOB DESCRIPTION:\n{jd_text[:4000]}\n\nCANDIDATE CV:\n{cv_text}"
        ),
    ]

    try:
        result: JobRating = await structured_llm.ainvoke(messages)
        return result.model_dump()
    except Exception as e:
        return {
            "score": 0,
            "matched_strengths": [],
            "gaps": [],
            "verdict": f"Rating failed: {str(e)[:150]}",
            "auto_reject": False,
        }

@traceable(name="rate_all_job", run_type="chain")
async def rate_all_jobs_for_user(user: dict) -> dict:
    db = get_database()
    user_id = str(user["_id"])

    jobs = await db.jobs.find({f"ratings.{user_id}": {"$exists": False}}).to_list(
        length=50
    )

    if not jobs:
        return {"rated": 0}

    async def rate_and_store(job):
        rating = await rate_job_for_user(job, user)
        rating["rated_at"] = datetime.now(timezone.utc)
        await db.jobs.update_one(
            {"_id": ObjectId(job["_id"])},
            {"$set": {f"ratings.{user_id}": rating}},
        )

    await asyncio.gather(*[rate_and_store(job) for job in jobs])
    return {"rated": len(jobs)}
