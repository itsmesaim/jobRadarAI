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
    structural_mismatch: bool = Field(
        default=False,
        description="True if there's a categorical disqualifier (role-type or "
        "core-domain mismatch) that cannot be fixed by a better application — "
        "not a skill gap.",
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

CRITICAL — check for structural disqualifiers BEFORE scoring skill overlap.
These are categorical mismatches, not skill gaps, and should cap the score
low (3 or below) regardless of how well the tech stack matches:

1. ROLE-TYPE MISMATCH
   - Individual contributor (IC) vs people-management role
   - If the JD requires "X years leading engineers", "managing a team",
     "direct reports", or similar people-management language, and the
     candidate's experience is IC/freelance/solo work with no management
     history — this is disqualifying, not a gap to "address." Cap score
     at 3 and say so plainly in the verdict.
   - Junior/graduate scheme vs senior/staff/principal role mismatch in
     either direction is similarly structural.

2. DOMAIN-AS-CORE-REQUIREMENT
   - Distinguish "nice to have" domain exposure from "must have to do
     the job" domain expertise. Regulated industries (payments, banking,
     healthcare compliance, defense) often require domain knowledge as
     a hard prerequisite, not a learnable-on-the-job skill.
   - If the JD treats the domain as core (e.g. "must understand PCI-DSS",
     "healthcare compliance experience required") and the candidate has
     zero exposure, this is a structural gap. Cap score at 4 and flag it
     as domain-as-core, not as a minor gap.
   - If domain is mentioned only as context ("join our payments team")
     without being listed as a requirement, treat it as a nice-to-have
     and don't penalize heavily for it.

For both checks above: if triggered, the verdict must say explicitly
that this is a structural/categorical mismatch, not something fixable
by a better cover letter or CV tailoring. Be direct about this so the
candidate doesn't waste time trying to "address" an unaddressable gap.

If no structural disqualifier applies, proceed with normal skill/experience
overlap scoring as before.
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


@traceable(name="generate_job_brief", run_type="chain")
async def generate_job_brief(job: dict, user: dict, rating: dict) -> str:
    """
    Generate a structured Job Brief for quick copy before applying.
    """
    cv = user.get("cv", {})
    structured = cv.get("structured", {})

    brief = f"""
JOB BRIEF
==============================
ROLE:       {job.get('title', 'Unknown')}
URL:        {job.get('url', 'N/A')}
FIT SCORE:  {rating.get('score', 'N/A')}/10

MATCHED STRENGTHS:
{chr(10).join(f"  • {s}" for s in rating.get('matched_strengths', []))}

GAPS TO ADDRESS:
{chr(10).join(f"  • {g}" for g in rating.get('gaps', []))}

VERDICT:
  {rating.get('verdict', '')}

CANDIDATE PROFILE:
  Name:       {structured.get('name', '')}
  Summary:    {structured.get('summary', '')[:300]}
  Top Skills: {', '.join(structured.get('skills', [])[:12])}

KEY PROJECTS:
{chr(10).join(f"  • {p.get('name')}: {p.get('description', '')}" for p in structured.get('projects', [])[:3])}

JD EXCERPT:
{job.get('full_text', '')[:800]}
==============================
""".strip()

    return brief
