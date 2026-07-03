"""
Rating service — v3 (performance focused).

Key improvements for speed at 500-1000+ jobs:
  - Embedding pre-filter: low-similarity JDs get score 2 instantly (no LLM call)
  - Bounded concurrency via semaphore (safe parallel LLM calls)
  - Removed 50-job artificial cap; now pulls up to RATE_ALL_MAX_JOBS
  - JD embeddings are cached on job documents (jd_embedding)

Still uses the full structured LLM rating (gpt-4o-mini or your model) for promising matches.
"""

import asyncio
import hashlib
import json
import math
from datetime import datetime, timezone

from bson import ObjectId
from langchain_core.messages import HumanMessage, SystemMessage
from langsmith import traceable
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

from database import get_database
from config import settings
from services.ai_usage import (
    record_ai_usage,
    record_embedding_usage,
    record_from_llm_response,
)
from services.llm import get_embeddings, get_llm, get_rating_llm
from services.limits import (
    _get_fresh_user,
    check_ai_token_quota,
    check_and_increment_rating,
    get_remaining_ratings,
    get_user_usage,
    refund_rating,
)


# ── Pydantic models ───────────────────────────────────────────────────────────


class JobRating(BaseModel):
    score: int = Field(description="Fit score from 1-10. Be honest, do not inflate.")
    matched_strengths: list[str] = Field(
        description="Specific ways the candidate's profile matches the JD requirements"
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
    tailoring_tips: list[str] = Field(
        default=[],
        description="2-4 concrete, specific things the candidate should emphasize, reword, or highlight in their application/CV/cover note for this exact role (e.g. 'Lead with the production JobRadar agentic rating system you built and deployed yourself'). Be direct and usable.",
    )


class RoastResult(BaseModel):
    roast: str = Field(description="The full roast, 4-6 funny brutal lines")
    savage_score: int = Field(description="1-10 how savage this roast was")


# ── System prompts ────────────────────────────────────────────────────────────

RATING_SYSTEM_PROMPT = """
You are a senior technical recruiter rating how well a candidate matches a job.

Be honest. Do not inflate scores. If the JD text is too short, vague, or
appears to be a search results page rather than an actual job posting,
score 0 and explain why in the verdict.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1 — STRUCTURAL DISQUALIFIERS (check first)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

These are categorical mismatches. If any apply, cap the score at 3 or below
and set structural_mismatch = true. Do NOT penalise for these the same way
you penalise skill gaps — they are deal-breakers, not "areas to improve."

1. ROLE-TYPE / PEOPLE-MANAGEMENT MISMATCH
   Flag ONLY if the role title contains Lead/Principal/Head/Manager/Director
   OR the JD explicitly states a minimum number of years leading a team
   OR the JD explicitly says "direct reports" / "line management" / "hiring".
   
   Do NOT flag generic aspirational phrases like:
     - "provide leadership on AI projects"
     - "promote best practices"
     - "mentor teammates when needed"
     - "senior presence expected"
   These appear in mid-level JDs and are NOT disqualifying for an IC candidate.
   Only hard management requirements count here.

2. DOMAIN-AS-CORE-REQUIREMENT
   Flag ONLY if the JD says the domain is required (e.g. "must have PCI-DSS
   experience", "healthcare compliance required", "financial services background
   essential") AND the candidate has zero exposure.
   If domain is just context ("join our payments team"), treat as nice-to-have.

3. WORK AUTHORIZATION / SPONSORSHIP MISMATCH
   If the JD says sponsorship is unavailable and the candidate's work auth
   does not cover this jurisdiction, auto_reject = true, score ≤ 2.

4. WORK MODE MISMATCH
   If the JD is strictly onsite and the candidate's acceptable work modes
   exclude onsite, flag it clearly in the verdict.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 2 — PARSE THE JD INTO REQUIRED vs PREFERRED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Before scoring, mentally split the JD requirements into two buckets:

REQUIRED (hard requirements):
  - Section headers like "Required", "Essential", "Must have", "Minimum"
  - Language like "you must have", "required experience", "you will need"
  - Core technologies named in the role title itself

PREFERRED (soft requirements):
  - Section headers like "Preferred", "Desirable", "Nice to have", "Bonus"
  - Language like "would be a plus", "exposure to", "ideally", "bonus if"
  - Anything listed after the core requirements section

Apply different penalty weights:
  - Missing a REQUIRED skill: costs 1.5-2 points depending on centrality
  - Missing a PREFERRED skill: costs 0.3-0.5 points at most
  - Never dock full points for a missing "nice to have"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 3 — EXPLICIT TOOL-NAME MATCHING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

When the JD explicitly names a specific tool and the candidate uses it daily
or has demonstrable experience with it — this is a STRONG POSITIVE SIGNAL.
Do not group tool-name hits into vague categories like "AI experience".

Examples of named tools that should earn explicit credit when matched:
  LangChain, LangGraph, LangSmith, Anthropic API, Claude Code, Cursor,
  FastAPI, Next.js, Spring Boot, Socket.IO, LiveKit, Pinecone, Weaviate,
  Docker, Kubernetes, Terraform, Airflow, dbt, Snowflake, etc.

Each named-tool hit that is confirmed in the candidate profile should:
  - Be listed individually in matched_strengths (not grouped)
  - Contribute +0.3 to +0.5 to the score if the tool is required
  - Contribute +0.1 to +0.2 if preferred/contextual

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 3.5 — CREDIT FOR BUILDING PRODUCTION AGENTIC / LLM SYSTEMS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

If the candidate has **built, deployed, and operated** a real production system that demonstrates agentic/LLM engineering patterns (orchestration, structured LLM outputs, parallel/background LLM work, multi-provider abstraction, evaluation/observability, crawling + LLM processing, developer tooling around AI, etc.), give this **heavy positive weight**.

This is often stronger evidence than "I used LangGraph in one internal script".

Examples of strong signals:
- Shipped a live platform where LLMs rate/analyze/process data at scale for users
- Built async/parallel LLM pipelines in production
- Created provider-agnostic LLM layers, tracing (LangSmith), prompt engineering in real apps
- End-to-end ownership: crawl → LLM rating → user-facing pipeline + deployment

Even if they didn't use the exact framework name the JD lists (e.g. they used LangChain equivalents instead of "OpenAI Agents SDK"), treat demonstrated production agentic patterns as direct relevant experience.

List the concrete system name (e.g. "JobRadar AI production agentic platform") in matched_strengths when it applies.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 4 — SCORE CALIBRATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Start at 5 (neutral baseline for a relevant candidate in the right domain).

Adjust up for:
  + Core tech stack match on required skills
  + Named tool hits (see Step 3)
  + Project/experience directly relevant to the JD's domain
  + About me / candidate context that aligns with role direction
  + Knowledge overrides confirming skills the CV didn't explicitly mention

Adjust down for:
  - Missing REQUIRED skills (1.5-2 pts each)
  - Missing PREFERRED skills (0.3-0.5 pts each)
  - Experience level mismatch (if stated)
  - Domain exposure gap (if required, not just mentioned)

Caps:
  - Structural mismatch (Step 1): ≤ 3
  - Missing core required skills but otherwise good fit: 5-6
  - Strong match with minor preferred gaps: 7-8
  - Excellent match across required + named tools: 9-10

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 5 — TAILORING TIPS (for the candidate)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

After deciding the score, matched strengths, and gaps, also produce 2-4 short, **highly specific and actionable** "tailoring_tips".

These are practical instructions the candidate can directly use when customizing their application for *this* job:
- What exact project / bullet / phrase to lead with or reword.
- Which concrete achievement or technology name to emphasize because it maps to language in the JD.
- How to address one of the gaps without lying.
- A strong hook sentence or angle that aligns their story with the JD's "Agentic AI", "production platforms", "developer tooling", etc.

Examples of good tips:
- "Lead your cover note and first bullet with the fact that you built and shipped JobRadar — a live production agentic system that crawls jobs, does parallel LLM structured rating with LangChain, and is deployed end-to-end."
- "Explicitly name LangGraph + LangSmith + structured outputs when describing your AI work, even if currently only in the skills section."
- "Frame your 4 years as 'full ownership of production AI systems from 0 to live' rather than just years of experience."

Make the tips specific to the JD text and the candidate's actual projects. Avoid generic advice.
""".strip()

FAST_RATING_SYSTEM_PROMPT = """
You are a senior technical recruiter rating candidate–job fit (1–10). Be honest; do not inflate.

Check first for deal-breakers (set structural_mismatch=true, score ≤ 3):
- Hard people-management requirement vs IC candidate
- Core domain required with zero candidate exposure
- Work authorization / strict onsite mismatch with stated constraints

Then score:
- Start at 5 for a relevant candidate
- + for required skills, named tools in the CV, production agentic/LLM systems built
- − for missing required skills (larger) vs preferred (smaller)
- Cap at 3 for structural mismatch; 7–8 strong match; 9–10 excellent

Return matched_strengths, gaps, verdict (one sentence), auto_reject, structural_mismatch.
Skip tailoring_tips (empty list is fine for bulk screening).
""".strip()

_RATING_IN_PROGRESS = "__rating_in_progress__"


ROAST_SYSTEM_PROMPT = """
You are a brutally honest, savagely funny tech recruiter doing a comedy
roast of how badly this candidate's CV does NOT fit this job description.

Be genuinely funny and cutting — think roast battle energy, not HR-speak.
Reference SPECIFIC details from their CV and the JD to make the burns land.
Still be accurate about the real gaps — the roast should be funny BECAUSE
it's true, not because it's mean for no reason.

Keep it to 4-6 punchy lines. End with one (sarcastic) actionable tip.

Do not hold back. This is for entertainment — the user explicitly asked
to be roasted. Do not soften it into generic encouragement.
""".strip()


# ── Context builders ──────────────────────────────────────────────────────────


def _build_constraints_block(user: dict) -> str:
    """Candidate stated preferences injected into the rating prompt."""
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


def _build_overrides_block(user: dict) -> str:
    """
    Candidate knowledge overrides — per-user skill memory stored in MongoDB.
    Key = skill name, value = candidate's own description of their experience.
    Injected into the prompt so the LLM knows about skills not on the CV.
    """
    overrides: dict = user.get("skill_overrides", {})
    if not overrides:
        return ""

    lines = [
        "The candidate has provided additional context on specific skills",
        "they use that may not be visible on their CV. Treat these as",
        "confirmed first-hand experience when scoring:",
    ]
    for skill, context in overrides.items():
        lines.append(f"  - {skill}: {context}")

    return "\n".join(lines)


def _build_about_me_block(user: dict) -> str:
    """
    Free-text career context field — injaced EARLY in the prompt so the LLM
    weights it alongside CV skills, not as a footnote.
    """
    about_me = user.get("about_me", "").strip()
    if not about_me:
        return ""
    return f"Additional candidate context (weight this alongside CV skills and overrides):\n{about_me}"


# ── Quota helpers ─────────────────────────────────────────────────────────────

_NON_BILLABLE_VERDICT_PREFIXES = (
    "Rating failed",
    "No CV uploaded",
    "JD text too short",
)


def is_billable_rating(rating: dict) -> bool:
    """True when a stored rating should consume daily rating quota."""
    verdict = (rating.get("verdict") or "").strip()
    if not verdict:
        return False
    return not any(verdict.startswith(p) for p in _NON_BILLABLE_VERDICT_PREFIXES)


# ── Rate-all query helpers ────────────────────────────────────────────────────


def unrated_jobs_filter(user_id: str) -> dict:
    """Jobs eligible for bulk rating: never rated, failed (score ≤ 0), or thin JD re-rate."""
    rating_path = f"ratings.{user_id}"
    score_path = f"{rating_path}.score"
    verdict_path = f"{rating_path}.verdict"
    return {
        "crawled_by": user_id,
        verdict_path: {"$ne": _RATING_IN_PROGRESS},
        "$or": [
            {rating_path: {"$exists": False}},
            {score_path: {"$lte": 0}},
            {
                "full_text": {
                    "$regex": r"^Job title:",
                    "$options": "i",
                },
                score_path: {"$gt": 0},
            },
        ],
    }


def _existing_rating_score(job: dict, user_id: str) -> int | None:
    rating = (job.get("ratings") or {}).get(user_id)
    if not rating:
        return None
    score = rating.get("score")
    return score if isinstance(score, int) else None


def _should_skip_rating(job: dict, user_id: str) -> bool:
    """Skip jobs already scored > 0 or currently being rated by another worker."""
    from services.jd_text import is_incomplete_jd

    rating = (job.get("ratings") or {}).get(user_id)
    if not rating:
        return False
    verdict = (rating.get("verdict") or "").strip()
    if verdict == _RATING_IN_PROGRESS:
        return True
    score = rating.get("score")
    if isinstance(score, int) and score > 0:
        # Re-rate listings that were scored on stub LinkedIn metadata only.
        if is_incomplete_jd(job.get("full_text", "")):
            return False
        return True
    return False


# ── Main rating function ──────────────────────────────────────────────────────


@traceable(name="rate_job_for_user", run_type="chain")
async def rate_job_for_user(job: dict, user: dict, *, mode: str = "full") -> dict:
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

    # Build all context blocks
    about_me_block = _build_about_me_block(user)
    overrides_block = _build_overrides_block(user)
    constraints_block = _build_constraints_block(user)

    from services.jd_text import is_incomplete_jd

    jd_text = job.get("full_text") or job.get("snippet", "")
    if is_incomplete_jd(jd_text):
        return {
            "score": 0,
            "matched_strengths": [],
            "gaps": [],
            "verdict": "JD text too short to rate accurately — open the job URL and paste the full description, or re-crawl after Indeed upgrades this listing.",
            "auto_reject": False,
        }

    # Compose the human message in the order that matters most
    # (about_me and overrides BEFORE the JD so they're in the LLM's context
    # when it reads the requirements, not appended as an afterthought)
    sections = ["CANDIDATE CV:", cv_text]

    if about_me_block:
        sections += ["", about_me_block]

    if overrides_block:
        sections += ["", "CANDIDATE KNOWLEDGE OVERRIDES:", overrides_block]

    sections += ["", "CANDIDATE STATED CONSTRAINTS:", constraints_block]
    sections += ["", f"JOB DESCRIPTION:\n{jd_text[:4000]}"]

    human_message_content = "\n".join(sections)

    system_prompt = (
        FAST_RATING_SYSTEM_PROMPT if mode == "fast" else RATING_SYSTEM_PROMPT
    )
    operation = "job_rating_fast" if mode == "fast" else "job_rating"
    prompt_chars = len(system_prompt) + len(human_message_content)

    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=human_message_content),
    ]

    try:
        user_id = str(user.get("_id", ""))
        llm = get_rating_llm()
        provider = settings.rating_provider or settings.llm_provider
        model = getattr(
            llm, "model", getattr(llm, "model_name", settings.rating_model or "unknown")
        )
        structured_llm = llm.with_structured_output(JobRating, include_raw=True)
        print(
            f"[rating] [job] LLM invoke mode={mode} provider={provider} model={model}"
        )
        raw_result = await structured_llm.ainvoke(messages)
        if isinstance(raw_result, dict):
            result: JobRating = raw_result.get("parsed")
            raw_msg = raw_result.get("raw")
            completion_chars = len(result.model_dump_json()) if result else 0
            if user_id and raw_msg:
                await record_from_llm_response(
                    user_id,
                    raw_msg,
                    operation=operation,
                    provider=provider,
                    model=str(model),
                    prompt_chars=prompt_chars,
                    completion_chars=completion_chars,
                )
        else:
            result = raw_result
            if user_id:
                await record_ai_usage(
                    user_id,
                    operation=operation,
                    provider=provider,
                    model=str(model),
                    llm_calls=1,
                    prompt_tokens=max(prompt_chars // 4, 1),
                )
        print("[rating] [job] LLM response received successfully")
        return result.model_dump()
    except Exception as e:
        import traceback

        # Log the full error for debugging the split/provider
        print(
            f"[rating] !!! Structured rating error for provider/model (see previous [rating] log): {e}"
        )
        traceback.print_exc()
        return {
            "score": 0,
            "matched_strengths": [],
            "gaps": [],
            "verdict": f"Rating failed: {str(e)[:150]}",
            "auto_reject": False,
        }


# ── Fast path config ──────────────────────────────────────────────────────────

# Max concurrent LLM rating calls. Tune based on your provider limits.
# Grok fast models often handle higher concurrency well.
RATING_CONCURRENCY = 10

# Embedding similarity threshold (cosine).
# Jobs below this get a cheap low score (no full LLM call) to save tokens on irrelevant results from broad search.
# Lower value = more jobs go through the expensive model.
EMBEDDING_SIMILARITY_CUTOFF = 0.18

# Max jobs to pull in one rate-all run. Set high to process hundreds in one background task.
RATE_ALL_MAX_JOBS = 2000

# Bulk fast rating first; run full detailed prompt only when fast score ≥ this.
FULL_RATING_SCORE_THRESHOLD = 7


# ── Embedding helpers (cheap & fast pre-filter) ───────────────────────────────


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def _cv_embedding_text(user: dict) -> str:
    """Text used for CV embedding (raw_text preferred)."""
    cv = user.get("cv", {})
    raw = cv.get("raw_text", "") or ""
    if len(raw) > 200:
        return raw[:8000]

    structured = cv.get("structured", {})
    parts = [
        structured.get("summary", ""),
        " ".join(structured.get("skills", [])),
    ]
    for exp in structured.get("experience", []):
        parts.append(f"{exp.get('title','')} {exp.get('company','')}")
        parts.extend(exp.get("bullets", [])[:2])
    return " ".join(p for p in parts if p)[:8000]


def _cv_embedding_content_hash(user: dict) -> str:
    """Hash CV + profile fields that affect semantic match."""
    payload = json.dumps(
        {
            "cv": _cv_embedding_text(user),
            "about_me": user.get("about_me", ""),
            "skill_overrides": user.get("skill_overrides", {}),
        },
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode()).hexdigest()


async def _get_cv_embedding(user: dict) -> list[float] | None:
    """Embed the user's CV once per content hash; cache vector on user doc."""
    text = _cv_embedding_text(user)
    if not text.strip():
        return None

    content_hash = _cv_embedding_content_hash(user)
    cached = user.get("cv_embedding")
    if (
        isinstance(cached, dict)
        and cached.get("content_hash") == content_hash
        and isinstance(cached.get("vector"), list)
        and cached["vector"]
    ):
        print("[rating] CV embedding cache hit (no API call)")
        return cached["vector"]

    try:
        emb = get_embeddings()
        vecs = await emb.aembed_documents([text])
        vec = vecs[0] if vecs else None
        user_id = str(user.get("_id", ""))
        if user_id and vec:
            db = get_database()
            await db.users.update_one(
                {"_id": ObjectId(user_id)},
                {
                    "$set": {
                        "cv_embedding": {
                            "content_hash": content_hash,
                            "vector": vec,
                            "cached_at": datetime.now(timezone.utc),
                        }
                    }
                },
            )
            await record_embedding_usage(
                user_id,
                num_documents=1,
                total_chars=len(text),
                operation="cv_embedding",
            )
            print("[rating] CV embedding computed and cached on user doc")
        return vec
    except Exception:
        return None


async def _get_jd_embedding(
    job: dict, embeddings, user_id: str | None = None
) -> list[float] | None:
    """Return JD embedding. Compute + store if missing."""
    existing = job.get("jd_embedding")
    if isinstance(existing, list) and existing:
        return existing

    jd_text = (job.get("full_text") or job.get("snippet", ""))[:6000]
    if len(jd_text) < 100:
        return None

    try:
        vecs = await embeddings.aembed_documents([jd_text])
        vec = vecs[0] if vecs else None
        if vec:
            if user_id:
                await record_embedding_usage(
                    user_id,
                    num_documents=1,
                    total_chars=len(jd_text),
                    operation="jd_embedding",
                )
            db = get_database()
            await db.jobs.update_one(
                {"_id": ObjectId(job["_id"])},
                {"$set": {"jd_embedding": vec}},
            )
        return vec
    except Exception:
        return None


async def _fast_low_score_rating(sim: float = 0.0) -> dict:
    """Cheap low score for clearly non-matching jobs (no LLM call)."""
    # graduated low score based on how bad the match was
    score = max(1, min(4, int(sim * 12))) if sim > 0 else 2
    return {
        "score": score,
        "matched_strengths": [],
        "gaps": [f"Low semantic match (sim={sim:.2f})"],
        "structural_mismatch": False,
        "verdict": "Low semantic similarity to your profile — not a good fit (pre-filtered to save tokens).",
        "auto_reject": False,
    }


# ── Rate all (now fast for hundreds of jobs) ──────────────────────────────────


@traceable(name="rate_all_jobs", run_type="chain")
async def rate_all_jobs_for_user(user: dict) -> dict:
    db = get_database()
    user_id = str(user["_id"])
    user = await _get_fresh_user(user_id)
    if not user:
        return {"rated": 0, "error": "User not found"}
    user_email = user.get("email", user_id)

    print(f"[rating] === START rate_all for user={user_email} (id={user_id}) ===")
    print(
        f"[rating] [env] rating_provider={settings.rating_provider} rating_model={settings.rating_model} (llm_provider={settings.llm_provider})"
    )

    token_ok, token_msg = await check_ai_token_quota(user)
    if not token_ok:
        print(f"[rating] Skipped for {user_email}: {token_msg}")
        return {"rated": 0, "error": token_msg}

    # Freemium: peek first
    remaining = await get_remaining_ratings(user)
    print(f"[rating] [queue] Remaining rating quota for user: {remaining}")

    if remaining <= 0:
        msg = "Free rating limit reached. Contact us for more access."
        print(f"[rating] Skipped for {user_email}: {msg}")
        return {"rated": 0, "error": msg}

    # Unrated queue — skip jobs already scored > 0; per-job quota inside rate_and_store
    jobs = await db.jobs.find(unrated_jobs_filter(user_id)).to_list(
        length=RATE_ALL_MAX_JOBS
    )
    print(
        f"[rating] [queue] Unrated jobs found in queue for user: {len(jobs)} (skips score>0; capped by remaining quota)"
    )

    if not jobs:
        print(f"[rating] No unrated jobs found for {user_email}.")
        return {"rated": 0}

    print(
        f"[rating] Found {len(jobs)} unrated jobs for {user_email}, will attempt up to {min(len(jobs), remaining)} (quota remaining: {remaining})"
    )
    print(
        f"[rating] [queue] Jobs in this rating batch: {[str(j.get('_id')) for j in jobs[:5]]}... (showing first 5)"
    )
    print(f"[rating] Starting bulk rating for {len(jobs)} jobs (prefilter active)...")

    # One embedding for the CV (cheap) — fall back gracefully if it fails
    cv_embedding = await _get_cv_embedding(user)
    embeddings = None
    if cv_embedding is not None:
        try:
            embeddings = get_embeddings()
        except Exception:
            embeddings = None
    if embeddings:
        print(
            "[rating] Embeddings ready — low-similarity jobs will be pre-filtered (no LLM)"
        )
        print(
            f"[rating] EMBEDDING_SIMILARITY_CUTOFF={EMBEDDING_SIMILARITY_CUTOFF} (jobs below this get cheap pre-filter, no LLM call)"
        )

    sem = asyncio.Semaphore(RATING_CONCURRENCY)

    prefilter_count = 0
    llm_count = 0
    full_llm_count = 0
    skipped_count = 0
    error_count = 0

    async def rate_and_store(job):
        nonlocal prefilter_count, llm_count, full_llm_count, skipped_count, error_count
        async with sem:
            job_id = str(job["_id"])
            job_title = str(job.get("title", "Unknown"))[:50]

            # Atomic claim — prevents duplicate LLM calls if rate-all runs overlap
            claimed = await db.jobs.find_one_and_update(
                {
                    "_id": ObjectId(job["_id"]),
                    "crawled_by": user_id,
                    **unrated_jobs_filter(user_id),
                },
                {
                    "$set": {
                        f"ratings.{user_id}": {
                            "score": 0,
                            "matched_strengths": [],
                            "gaps": [],
                            "verdict": _RATING_IN_PROGRESS,
                            "auto_reject": False,
                            "rated_at": datetime.now(timezone.utc),
                        }
                    }
                },
                return_document=ReturnDocument.BEFORE,
            )
            if not claimed:
                fresh = await db.jobs.find_one(
                    {"_id": ObjectId(job["_id"])},
                    {f"ratings.{user_id}": 1},
                )
                if fresh and _should_skip_rating(fresh, user_id):
                    skipped_count += 1
                    print(
                        f"[rating] [{job_id}] SKIP already rated score={_existing_rating_score(fresh, user_id)} title='{job_title}'"
                    )
                return 0

            fresh_user = await _get_fresh_user(user_id)
            if not fresh_user:
                await db.jobs.update_one(
                    {"_id": ObjectId(job["_id"])},
                    {"$unset": {f"ratings.{user_id}": ""}},
                )
                return 0

            token_ok, token_msg = await check_ai_token_quota(fresh_user)
            if not token_ok:
                print(f"[rating] Token cap hit mid-batch for {user_email}: {token_msg}")
                await db.jobs.update_one(
                    {"_id": ObjectId(job["_id"])},
                    {"$unset": {f"ratings.{user_id}": ""}},
                )
                return 0

            allowed, quota_msg, _ = await check_and_increment_rating(
                fresh_user, jobs_to_rate=1
            )
            if not allowed:
                print(f"[rating] Rating quota exhausted for {user_email}: {quota_msg}")
                await db.jobs.update_one(
                    {"_id": ObjectId(job["_id"])},
                    {"$unset": {f"ratings.{user_id}": ""}},
                )
                return 0
            # Embedding fast-path: skip LLM for clear non-matches
            sim: float | None = None
            if cv_embedding and embeddings:
                jd_emb = await _get_jd_embedding(job, embeddings, user_id=user_id)
                if jd_emb:
                    sim = _cosine_similarity(cv_embedding, jd_emb)
                    if sim < EMBEDDING_SIMILARITY_CUTOFF:
                        rating = await _fast_low_score_rating(sim)
                        rating["rated_at"] = datetime.now(timezone.utc)
                        await db.jobs.update_one(
                            {"_id": ObjectId(job["_id"])},
                            {"$set": {f"ratings.{user_id}": rating}},
                        )
                        prefilter_count += 1
                        print(
                            f"[rating] [{job_id}] PRE-FILTER (cheap, no LLM) sim={sim:.3f} title='{job_title}' → score={rating.get('score')}"
                        )
                        return 1 if is_billable_rating(rating) else 0

            # Fast LLM rating first; full prompt only for strong matches
            llm_count += 1
            sim_str = f" sim={sim:.3f}" if sim is not None else ""
            print(f"[rating] [{job_id}] LLM-FAST{sim_str} title='{job_title}'")
            try:
                rating = await rate_job_for_user(job, fresh_user, mode="fast")
                fast_score = rating.get("score", 0) or 0
                if fast_score >= FULL_RATING_SCORE_THRESHOLD:
                    full_llm_count += 1
                    print(
                        f"[rating] [{job_id}] LLM-FULL (fast={fast_score}≥{FULL_RATING_SCORE_THRESHOLD}) title='{job_title}'"
                    )
                    rating = await rate_job_for_user(job, fresh_user, mode="full")
                rating["rated_at"] = datetime.now(timezone.utc)
                await db.jobs.update_one(
                    {"_id": ObjectId(job["_id"])},
                    {"$set": {f"ratings.{user_id}": rating}},
                )
                if not is_billable_rating(rating):
                    await refund_rating(user_id, 1)
                    error_count += 1
                    print(f"[rating] [{job_id}] NOT-BILLABLE: {rating.get('verdict')}")
                else:
                    print(
                        f"[rating] [{job_id}] LLM-OK score={rating.get('score')} title='{job_title}'"
                    )
                return 1 if is_billable_rating(rating) else 0
            except Exception as e:
                await refund_rating(user_id, 1)
                await db.jobs.update_one(
                    {"_id": ObjectId(job["_id"])},
                    {"$unset": {f"ratings.{user_id}": ""}},
                )
                error_count += 1
                print(f"[rating] [{job_id}] UNEXPECTED ERROR during rating: {e}")
                return 0

    results = await asyncio.gather(
        *[rate_and_store(job) for job in jobs], return_exceptions=True
    )

    # Collect any top-level exceptions from gather
    for res in results:
        if isinstance(res, Exception):
            error_count += 1
            print(f"[rating] GATHER-EXCEPTION: {res}")

    rated_count = sum(1 for r in results if r == 1)

    print(f"[rating] === FINISHED {user_email} ===")
    print(
        f"[rating] [queue] Summary: total_in_queue={len(jobs)} | skipped(already_rated)={skipped_count} | prefiltered(cheap,no-LLM)={prefilter_count} | llm_fast={llm_count} | llm_full={full_llm_count} | errors={error_count} | successfully_stored={rated_count}"
    )
    return {
        "rated": rated_count,
        "skipped": skipped_count,
        "prefiltered": prefilter_count,
        "llm_calls": llm_count,
        "llm_full_calls": full_llm_count,
        "errors": error_count,
    }


# ── Roast mode ────────────────────────────────────────────────────────────────


@traceable(name="roast_job_fit", run_type="chain")
async def roast_job_fit(job: dict, user: dict) -> dict:
    cv = user.get("cv", {})
    structured = cv.get("structured", {})
    cv_text = f"""
Name: {structured.get('name')}
Summary: {structured.get('summary')}
Skills: {', '.join(structured.get('skills', []))}
Experience: {json.dumps(structured.get('experience', []))}
""".strip()

    jd_text = job.get("full_text") or job.get("snippet", "")

    user_id = str(user.get("_id", ""))
    llm = get_llm()
    provider = settings.llm_provider
    model = getattr(llm, "model", getattr(llm, "model_name", settings.openai_model))
    structured_llm = llm.with_structured_output(RoastResult, include_raw=True)

    messages = [
        SystemMessage(content=ROAST_SYSTEM_PROMPT),
        HumanMessage(
            content=f"JOB DESCRIPTION:\n{jd_text[:3000]}\n\nCANDIDATE CV:\n{cv_text}"
        ),
    ]

    try:
        raw_result = await structured_llm.ainvoke(messages)
        if isinstance(raw_result, dict):
            result: RoastResult = raw_result.get("parsed")
            raw_msg = raw_result.get("raw")
            if user_id and raw_msg:
                await record_from_llm_response(
                    user_id,
                    raw_msg,
                    operation="roast",
                    provider=provider,
                    model=str(model or "unknown"),
                )
        else:
            result = raw_result
        return result.model_dump()
    except Exception as e:
        return {"roast": f"Roast failed: {str(e)[:150]}", "savage_score": 0}


# ── Job brief ─────────────────────────────────────────────────────────────────


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
    experience_text = "\n\n".join(experience_lines) or "  (none listed)"

    project_lines = []
    for p in structured.get("projects", []):
        bullets = "\n".join(f"    - {b}" for b in p.get("bullets", []))
        tech = ", ".join(p.get("tech", []))
        project_lines.append(
            f"  {p.get('name')} [{tech}]\n  {p.get('description', '')}\n{bullets}"
        )
    projects_text = "\n\n".join(project_lines) or "  (none listed)"

    education_lines = []
    for edu in structured.get("education", []):
        education_lines.append(
            f"  {edu.get('degree')} — {edu.get('institution')} "
            f"({edu.get('start')} - {edu.get('end')})"
        )
    education_text = "\n".join(education_lines) or "  (none listed)"

    overrides = user.get("skill_overrides", {})
    overrides_text = (
        "\n".join(f"  {k}: {v}" for k, v in overrides.items())
        if overrides
        else "  (none)"
    )

    about_me = user.get("about_me", "").strip()
    constraints_text = _build_constraints_block(user)

    from services.jd_text import is_incomplete_jd

    jd_body = job.get("full_text", "")[:6000]
    jd_warning = ""
    if is_incomplete_jd(jd_body):
        jd_warning = (
            "⚠️  JD WARNING: The stored job description is incomplete (title/company only). "
            "Scores and gap analysis below may be unreliable until you paste the full JD "
            "via 'Paste JD' or open the URL and re-rate.\n\n"
        )

    brief = f"""
JOB BRIEF
==============================
ROLE:       {job.get('title', 'Unknown')}
COMPANY:    {job.get('company', 'Unknown')}
URL:        {job.get('url', 'N/A')}
FIT SCORE:  {rating.get('score', 'N/A')}/10
STRUCTURAL MISMATCH: {rating.get('structural_mismatch', False)}
{jd_warning}

MATCHED STRENGTHS:
{chr(10).join(f"  • {s}" for s in rating.get('matched_strengths', []))}

GAPS TO ADDRESS:
{chr(10).join(f"  • {g}" for g in rating.get('gaps', []))}

VERDICT:
  {rating.get('verdict', '')}

ACTIONABLE TAILORING TIPS (use these when applying):
{chr(10).join(f"  • {t}" for t in rating.get('tailoring_tips', [])) or "  (none generated)"}

==============================
CANDIDATE PROFILE
==============================
Name:     {structured.get('name', '')}
Summary:  {structured.get('summary', '')}
Skills:   {', '.join(structured.get('skills', []))}

ABOUT ME:
  {about_me or '(not set)'}

KNOWLEDGE OVERRIDES:
{overrides_text}

CONSTRAINTS:
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
{jd_body if jd_body.strip() else '(not available — listing had no description text stored)'}
==============================
""".strip()

    return brief
