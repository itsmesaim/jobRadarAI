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
        description="True if there's a categorical disqualifier (role-type, "
        "core-domain mismatch, work authorization, or work mode) that cannot "
        "be fixed by a better application — not a skill gap.",
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
and stated preferences match the job description.

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
     either direction is similarly structural. Compare the JD's seniority
     against the candidate's STATED experience level below, not just
     years of experience inferred from the CV.

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
   - If the JD's industry appears in the candidate's "avoid industries"
     list below, flag this explicitly in the verdict even if technically
     a fit — the candidate has chosen not to pursue this sector.

3. WORK AUTHORIZATION / SPONSORSHIP MISMATCH
   - If the JD explicitly requires sponsorship is NOT available, or
     requires a specific citizenship/work authorization the candidate
     does not have (per their stated work authorization below), this
     is an automatic structural mismatch. Cap score at 2 and set
     auto_reject to true.

4. WORK MODE MISMATCH
   - If the JD is strictly onsite and the candidate's work mode
     preferences exclude onsite (see below), flag this as a structural
     mismatch in the verdict — note the commute/relocation implication
     clearly rather than silently scoring it down.

For any of the above checks: if triggered, the verdict must say explicitly
that this is a structural/categorical mismatch, not something fixable
by a better cover letter or CV tailoring. Be direct about this so the
candidate doesn't waste time trying to "address" an unaddressable gap.

If no structural disqualifier applies, proceed with normal skill/experience
overlap scoring as before.
""".strip()


def _build_constraints_block(user: dict) -> str:
    """
    Builds a plain-text summary of the candidate's stated preferences
    so the rating prompt can check the JD against them explicitly,
    not just against the CV.
    """
    experience_level = user.get("experience_level", "mid")
    work_auth = user.get("work_authorization", "")
    avoid_industries = user.get("avoid_industries", [])
    work_mode = user.get("work_mode", {"remote": True, "hybrid": True, "onsite": False})

    allowed_modes = [k for k, v in work_mode.items() if v]
    modes_str = ", ".join(allowed_modes) if allowed_modes else "not specified"

    lines = [
        f"Stated experience level: {experience_level}",
        f"Work authorization: {work_auth or 'not specified'}",
        f"Acceptable work modes: {modes_str}",
    ]
    if avoid_industries:
        lines.append(f"Industries to avoid: {', '.join(avoid_industries)}")

    return "\n".join(lines)


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

    constraints_text = _build_constraints_block(user)

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
            content=(
                f"JOB DESCRIPTION:\n{jd_text[:4000]}\n\n"
                f"CANDIDATE CV:\n{cv_text}\n\n"
                f"CANDIDATE STATED CONSTRAINTS:\n{constraints_text}"
            )
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
    cv = user.get("cv", {})
    structured = cv.get("structured", {})

    experience_lines = []
    for exp in structured.get("experience", []):
        bullets = "\n".join(f"    - {b}" for b in exp.get("bullets", []))
        experience_lines.append(
            f"  {exp.get('title')} @ {exp.get('company')} "
            f"({exp.get('start')} - {exp.get('end')})\n{bullets}"
        )
    experience_text = (
        "\n\n".join(experience_lines) if experience_lines else "  (none listed)"
    )

    project_lines = []
    for p in structured.get("projects", []):
        bullets = "\n".join(f"    - {b}" for b in p.get("bullets", []))
        tech = ", ".join(p.get("tech", []))
        project_lines.append(
            f"  {p.get('name')} [{tech}]\n  {p.get('description', '')}\n{bullets}"
        )
    projects_text = "\n\n".join(project_lines) if project_lines else "  (none listed)"

    education_lines = []
    for edu in structured.get("education", []):
        education_lines.append(
            f"  {edu.get('degree')} — {edu.get('institution')} "
            f"({edu.get('start')} - {edu.get('end')})"
        )
    education_text = (
        "\n".join(education_lines) if education_lines else "  (none listed)"
    )

    constraints_text = _build_constraints_block(user)

    brief = f"""
JOB BRIEF
==============================
ROLE:       {job.get('title', 'Unknown')}
COMPANY:    {job.get('company', 'Unknown')}
URL:        {job.get('url', 'N/A')}
FIT SCORE:  {rating.get('score', 'N/A')}/10
STRUCTURAL MISMATCH: {rating.get('structural_mismatch', False)}

MATCHED STRENGTHS:
{chr(10).join(f"  • {s}" for s in rating.get('matched_strengths', []))}

GAPS TO ADDRESS:
{chr(10).join(f"  • {g}" for g in rating.get('gaps', []))}

VERDICT:
  {rating.get('verdict', '')}

==============================
CANDIDATE PROFILE
==============================
Name:     {structured.get('name', '')}
Summary:  {structured.get('summary', '')}
Skills:   {', '.join(structured.get('skills', []))}

CANDIDATE CONSTRAINTS:
{constraints_text}

EXPERIENCE:
{experience_text}

PROJECTS:
{projects_text}

EDUCATION:
{education_text}

==============================
FULL JOB DESCRIPTION
==============================
{job.get('full_text', '')[:6000]}
==============================
""".strip()

    return brief
