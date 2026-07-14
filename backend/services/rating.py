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
import re
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
from services.vectorstore import build_faiss_index, chunk_text, retrieve_top_k


# ── Pydantic models ───────────────────────────────────────────────────────────


class JobRating(BaseModel):
    score: int = Field(description="Fit score from 1-10. Be honest, do not inflate.")
    matched_strengths: list[str] = Field(
        description="Specific ways the candidate's profile matches the JD requirements"
    )
    gaps: list[str] = Field(
        description="Specific JD requirements the candidate is missing or weak on. "
        "Each entry MUST start with '[Essential]' or '[Preferred]' per the JD's own "
        "section heading (see STEP 2.5). One entry per distinct underlying "
        "requirement — do not list the same missing skill more than once."
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


# Hard pre-filter (runs before any LLM rating call)
_HARD_FILTER_SALARY_CEILING = 70000
_SALARY_NUMBER_PATTERN = re.compile(r"[\d,]{3,}")


_GAP_TAG_RE = re.compile(r"^\[(essential|preferred)\]\s*", re.IGNORECASE)
_TOKEN_RE = re.compile(r"[a-z0-9+#]{3,}")
_GENERIC_TOKENS = {
    "experience",
    "with",
    "and",
    "the",
    "for",
    "development",
    "building",
    "deploying",
    "using",
    "knowledge",
    "familiarity",
    "understanding",
    "strong",
    "solid",
    "working",
    "hands",
    "years",
    "based",
    "systems",
    "production",
    "tools",
    "tooling",
    "applications",
    "services",
    "required",
    "requirement",
    "essential",
    "preferred",
    "not",
    "evidenced",
    "missing",
}


def _clean_rating_lists(
    strengths: list[str], gaps: list[str]
) -> tuple[list[str], list[str]]:
    """Deterministic backstop for STEP 2.5/2.6: dedup both lists and drop any
    gap that overlaps a confirmed strength. The prompt already tells the
    model to do this, but the same dedup rule already existed for gaps alone
    and the model still violated it — so this doesn't rely on the model
    getting it right every time.
    ponytail: gap/strength overlap is a token-overlap heuristic (at least
    half the gap's meaningful words also present in one strength), not
    semantic matching — upgrade to embedding similarity if paraphrased
    dupes start slipping through.
    """

    def norm(s: str) -> str:
        return _GAP_TAG_RE.sub("", s.strip()).lower()

    seen_strengths: set[str] = set()
    deduped_strengths: list[str] = []
    for s in strengths:
        key = norm(s)
        if key and key not in seen_strengths:
            seen_strengths.add(key)
            deduped_strengths.append(s)

    strength_token_sets = [
        set(_TOKEN_RE.findall(norm(s))) - _GENERIC_TOKENS for s in deduped_strengths
    ]

    seen_gaps: set[str] = set()
    cleaned_gaps: list[str] = []
    for g in gaps:
        key = norm(g)
        if not key or key in seen_gaps:
            continue
        gap_tokens = set(_TOKEN_RE.findall(key)) - _GENERIC_TOKENS
        overlap_needed = max(1, -(-len(gap_tokens) // 2))  # ceil(len/2), min 1
        if gap_tokens and any(
            len(gap_tokens & st) >= overlap_needed for st in strength_token_sets
        ):
            continue
        seen_gaps.add(key)
        cleaned_gaps.append(g)

    return deduped_strengths, cleaned_gaps


def parse_comp_max(salary_text: str) -> int | None:
    if not salary_text:
        return None
    numbers = [
        int(n.replace(",", "")) for n in _SALARY_NUMBER_PATTERN.findall(salary_text)
    ]
    return max(numbers) if numbers else None


def hard_disqualify(
    comp_max: int | None,
    salary_ceiling: int = _HARD_FILTER_SALARY_CEILING,
) -> tuple[bool, str]:
    if not salary_ceiling:
        return False, ""
    if comp_max and comp_max > salary_ceiling * 1.5:
        return True, f"comp_max {comp_max} exceeds {salary_ceiling * 1.5} ceiling"
    return False, ""


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

5. PROFESSIONAL-EXPERIENCE-YEARS MISMATCH
   Freelance work, contract-for-multiple-clients, self-employment, internships,
   and academic/personal projects are REAL skill evidence — never penalise the
   tech-stack match because of them. But they are NOT the same thing as
   continuous full-time employment at a single employer, and must not be
   summed with corporate tenure to satisfy a JD's stated years-of-experience
   requirement.
   If the JD requires N+ years of professional/corporate/industry experience
   (e.g. "5+ years professional experience", "senior-level, 4-6 years in
   industry") and the candidate's matching years are freelance/academic/
   internship rather than full-time corporate roles, treat this as a
   structural mismatch: cap the score per the Step 1 cap, and say so plainly
   in verdict (e.g. "JD wants 5+ years corporate experience; candidate's
   relevant years are freelance/academic, not full-time employment").
   The "Stated experience level" in candidate constraints (junior/mid/senior)
   is the candidate's own self-assessment — treat it as authoritative over
   whatever a raw year-count on the CV timeline might suggest.

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
STEP 2.5 — GAP LIST RULES (source, dedup, tier)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Before writing the `gaps` list, apply all four rules below:

1. SOURCE RESTRICTION — only pull gaps from the JD's actual requirements /
   qualifications section (whatever it's labeled: "Required", "Minimum
   Qualifications", "What we like you to have", "Core Engineering
   Foundations", etc.). NEVER extract a gap from a responsibilities /
   "What you'll do" / "day to day" section — those describe the job, not
   the hiring bar. If a skill only appears in a responsibilities bullet and
   nowhere in the requirements section, it is not a gap.

2. ONE GAP PER UNDERLYING REQUIREMENT — if a single JD bullet lists several
   interchangeable examples (e.g. "Selenium, Playwright, TestCafe, Cypress,
   Karate, RestAssured or similar"), that is ONE requirement, not one per
   tool. If the candidate has none of them, write ONE gap entry for that
   whole bullet (name the category, e.g. "UI/API test automation framework
   experience"). Do not also write separate gap entries for individual tool
   names mentioned in that same bullet — that double- or triple-counts a
   single deficiency.

3. TIER TAG FROM THE JD'S OWN HEADING — look at which heading the bullet
   actually sits under in the JD, and prefix the gap string with exactly
   that tier, derived directly from the heading text, not inferred loosely:
     - Heading contains "Required", "Essential", "Must-have", "Minimum
       Qualifications", "Core ... (Required)" → prefix "[Essential]"
     - Heading contains "Preferred", "Desirable", "Nice-to-have", "Bonus"
       → prefix "[Preferred]"
   Example: "[Essential] UI/API test automation framework experience
   (Selenium/Playwright/Cypress/TestCafe/Karate/RestAssured) not evidenced".

4. CROSS-CHECK AGAINST STRENGTHS — before a skill/technology goes into
   `gaps`, check whether it is already present in `matched_strengths` (or is
   otherwise confirmed in the candidate's Skills/Projects/experience). If it
   is, it must NEVER also appear in `gaps`, no matter how the JD phrases the
   requirement. This matters most for soft/optional phrasing like "you may
   also touch X", "exposure to X", "occasionally work with X", "nice to have
   X" — this kind of language means the JD is naming an OPTIONAL AREA, not
   claiming the candidate lacks it. Read it as "this role sometimes touches
   X" and then check the candidate's actual profile for X. If the candidate
   already has X, it is a strength (or simply irrelevant), never a gap. Do
   not default to "mentioned in JD but not the primary skill = gap" — always
   verify against the candidate's confirmed skills first.

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
  - Experience level mismatch (if stated) — do not treat freelance/academic
    calendar years as equivalent to the corporate tenure a "Senior"/
    "N+ years professional experience" JD expects (see Step 1.5)
  - Domain exposure gap (if required, not just mentioned)

Caps:
  - Structural mismatch (Step 1): ≤ 3
  - TITLE-NAMED LANGUAGE/FRAMEWORK COMPLETELY ABSENT: if the job title
    itself names a specific programming language or framework as the core
    of the role (e.g. "Backend Rust Developer", "Senior Golang Engineer",
    "React Native Developer") and the candidate has ZERO evidence of that
    language/framework anywhere in Skills, Projects, or experience — this is
    not one requirement among many, it is the primary axis the entire role
    is built on. Do not apply the standard per-item Essential deduction for
    this case. Instead cap the score at ≤ 4, regardless of how strong the
    rest of the stack match is.
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

Never suggest reframing freelance/academic years as if they were corporate
tenure (e.g. do not say "frame your N years as full professional experience")
— that is dishonest and is exactly what Step 1.5 exists to catch, not paper over.

Make the tips specific to the JD text and the candidate's actual projects. Avoid generic advice.
""".strip()

RATING_IN_PROGRESS = "__rating_in_progress__"


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
    "Hard filter:",
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
        verdict_path: {"$ne": RATING_IN_PROGRESS},
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
    if verdict == RATING_IN_PROGRESS:
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
async def rate_job_for_user(job: dict, user: dict) -> dict:
    disqualified, reason = hard_disqualify(
        parse_comp_max(job.get("salary_text", "")),
        salary_ceiling=user.get("min_salary", 0) or 0,
    )
    if disqualified:
        return {
            "score": 1,
            "matched_strengths": [],
            "gaps": [reason],
            "verdict": f"Hard filter: {reason}",
            "auto_reject": True,
            "structural_mismatch": True,
        }

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

    user_id = str(user.get("_id", ""))

    # RAG: retrieve the JD chunks most relevant to this candidate instead of
    # naively truncating, so long JDs don't silently lose tail content.
    jd_context = await _retrieve_relevant_jd_context(job, cv_text)

    # Calibrate against the user's own rating history on similar jobs
    # (reuses jd_embedding if already cached from the prefilter step).
    jd_embedding = job.get("jd_embedding")
    if not jd_embedding:
        try:
            jd_embedding = await _get_jd_embedding(
                job, get_embeddings(), user_id=user_id
            )
        except Exception:
            jd_embedding = None
    similar_block = ""
    if jd_embedding:
        similar_jobs = await _retrieve_similar_rated_jobs(user, job, jd_embedding)
        similar_block = _build_similar_jobs_block(similar_jobs)

    # Compose the human message in the order that matters most
    # (about_me and overrides BEFORE the JD so they're in the LLM's context
    # when it reads the requirements, not appended as an afterthought)
    sections = ["CANDIDATE CV:", cv_text]

    if about_me_block:
        sections += ["", about_me_block]

    if overrides_block:
        sections += ["", "CANDIDATE KNOWLEDGE OVERRIDES:", overrides_block]

    sections += ["", "CANDIDATE STATED CONSTRAINTS:", constraints_block]

    if similar_block:
        sections += ["", similar_block]

    sections += ["", f"JOB DESCRIPTION:\n{jd_context}"]

    human_message_content = "\n".join(sections)

    prompt_chars = len(RATING_SYSTEM_PROMPT) + len(human_message_content)

    messages = [
        SystemMessage(content=RATING_SYSTEM_PROMPT),
        HumanMessage(content=human_message_content),
    ]

    async def _try_structured(
        llm, provider_label: str, model_label: str, max_attempts: int
    ):
        """Retry a structured rating call against one LLM. Some providers
        (observed with DeepSeek) intermittently report finish_reason=
        "tool_calls" but return an empty tool_calls array — a nondeterministic
        client/provider parsing glitch, not a prompt or schema problem
        (reproduced ~15-30% of the time, independent of concurrency and of
        the specific job/CV content). Returns the parsed result, or None if
        every attempt fails."""
        structured_llm = llm.with_structured_output(
            JobRating, include_raw=True, method="function_calling"
        )
        for attempt in range(1, max_attempts + 1):
            raw_result = await structured_llm.ainvoke(messages)
            parsed = None
            raw_msg = None
            if isinstance(raw_result, dict):
                parsed = raw_result.get("parsed")
                raw_msg = raw_result.get("raw")
                completion_chars = len(parsed.model_dump_json()) if parsed else 0
                if user_id and raw_msg:
                    await record_from_llm_response(
                        user_id,
                        raw_msg,
                        operation="job_rating",
                        provider=provider_label,
                        model=model_label,
                        prompt_chars=prompt_chars,
                        completion_chars=completion_chars,
                    )
            else:
                parsed = raw_result
                if user_id:
                    await record_ai_usage(
                        user_id,
                        operation="job_rating",
                        provider=provider_label,
                        model=model_label,
                        llm_calls=1,
                        prompt_tokens=max(prompt_chars // 4, 1),
                    )

            if parsed is not None:
                return parsed

            raw_tool_calls = getattr(raw_msg, "tool_calls", None) if raw_msg else None
            raw_content = getattr(raw_msg, "content", None) if raw_msg else None
            print(
                f"[rating] !!! Structured output parsed as None (attempt "
                f"{attempt}/{max_attempts}, provider={provider_label} "
                f"model={model_label}) — model returned no valid tool call. "
                f"tool_calls={raw_tool_calls!r} content={raw_content!r}"
            )
        return None

    try:
        llm = get_rating_llm()
        provider = settings.rating_provider or settings.llm_provider
        model = getattr(
            llm, "model", getattr(llm, "model_name", settings.rating_model or "unknown")
        )
        print(f"[rating] [job] LLM invoke provider={provider} model={model}")
        result = await _try_structured(llm, provider, str(model), max_attempts=3)
        used_by = f"{provider}:{model}"

        # If the (usually cheaper) rating provider keeps failing to return a
        # valid structured response, fall back to the main LLM once before
        # giving up — trades a bit of cost for not losing the rating outright
        # to one provider's flakiness.
        if result is None and settings.llm_provider != provider:
            print(
                f"[rating] [job] Falling back to main LLM_PROVIDER="
                f"{settings.llm_provider} after {provider} failed all attempts"
            )
            fallback_llm = get_llm()
            fallback_model = getattr(
                fallback_llm,
                "model",
                getattr(fallback_llm, "model_name", settings.openai_model or "unknown"),
            )
            result = await _try_structured(
                fallback_llm, settings.llm_provider, str(fallback_model), max_attempts=2
            )
            used_by = f"{settings.llm_provider}:{fallback_model}"

        if result is None:
            raise ValueError(
                "Rating LLM did not return a valid structured response "
                "(no tool call, or arguments failed schema validation), "
                "including after falling back to the main LLM provider"
            )
        print("[rating] [job] LLM response received successfully")
        rating_dict = result.model_dump()
        rating_dict["matched_strengths"], rating_dict["gaps"] = _clean_rating_lists(
            rating_dict.get("matched_strengths", []), rating_dict.get("gaps", [])
        )
        rating_dict["rated_by_model"] = used_by
        return rating_dict
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
            "rated_by_model": None,
        }


# ── Fast path config ──────────────────────────────────────────────────────────

# Max concurrent LLM rating calls. Tune via RATING_CONCURRENCY in .env based
# on your provider's tokens-per-minute limit — every call now sends the full
# rating prompt (no cheap first pass), so this is what controls burst TPM.
RATING_CONCURRENCY = settings.rating_concurrency

# Embedding similarity threshold (cosine).
# Jobs below this get a cheap low score (no full LLM call) to save tokens on irrelevant results from broad search.
# Lower value = more jobs go through the expensive model.
EMBEDDING_SIMILARITY_CUTOFF = 0.18

# Max jobs to pull in one rate-all run. Set high to process hundreds in one background task.
RATE_ALL_MAX_JOBS = 2000


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
    """Text used for CV embedding — structured fields only (never raw_text,
    which carries contact details that add no semantic value here)."""
    cv = user.get("cv", {})
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


# ── RAG: JD chunk retrieval (replaces naive truncation) ──────────────────────

JD_CHUNK_SIZE = 800
JD_CHUNK_OVERLAP = 100

# How many of the user's own past-rated jobs to consider as calibration
# candidates. ponytail: bounds the FAISS rebuild cost to a small in-memory
# index; move to a persistent index if a power user's rated-job count makes
# this rebuild show up in latency.
SIMILAR_JOBS_LOOKBACK = 200


async def _get_jd_chunks(job: dict) -> list[dict]:
    """Chunk + embed the JD once; cache on the job doc like jd_embedding."""
    cached = job.get("jd_chunks")
    if isinstance(cached, list) and cached:
        return cached

    jd_text = job.get("full_text") or job.get("snippet", "")
    if len(jd_text) < 100:
        return []

    chunks = chunk_text(jd_text, chunk_size=JD_CHUNK_SIZE, overlap=JD_CHUNK_OVERLAP)
    if not chunks:
        return []

    try:
        embeddings = get_embeddings()
        vecs = await embeddings.aembed_documents(chunks)
    except Exception:
        return []

    jd_chunks = [{"text": t, "embedding": v} for t, v in zip(chunks, vecs)]
    db = get_database()
    await db.jobs.update_one(
        {"_id": ObjectId(job["_id"])},
        {"$set": {"jd_chunks": jd_chunks}},
    )
    return jd_chunks


async def _retrieve_relevant_jd_context(
    job: dict, query_text: str, k: int = 6, char_budget: int = 4000
) -> str:
    """Retrieve the JD chunks most relevant to query_text, in original order.

    Falls back to plain head-truncation if chunking/embedding isn't
    available (e.g. embeddings provider down) — degrade gracefully instead
    of blocking rating.
    """
    fallback = (job.get("full_text") or job.get("snippet", ""))[:char_budget]

    jd_chunks = await _get_jd_chunks(job)
    if not jd_chunks:
        return fallback

    try:
        embeddings = get_embeddings()
        query_vec = await embeddings.aembed_query(query_text)
    except Exception:
        return fallback

    texts = [c["text"] for c in jd_chunks]
    vecs = [c["embedding"] for c in jd_chunks]
    metadatas = [{"order": i} for i in range(len(texts))]
    index = build_faiss_index(texts, vecs, embeddings, metadatas=metadatas)
    if not index:
        return fallback

    results = retrieve_top_k(index, query_vec, k=k)
    if not results:
        return fallback

    # Keep chunks by relevance rank first (a highly relevant chunk that
    # happens to sit late in the document must not lose to the budget cap —
    # that would just reintroduce the truncation bug this replaces), then
    # sort the kept chunks back into original order so they read coherently.
    kept = []
    budget_left = char_budget
    for doc in results:
        if budget_left <= 0:
            break
        kept.append(doc)
        budget_left -= len(doc.page_content)

    ordered = sorted(kept, key=lambda d: d.metadata.get("order", 0))
    return "\n\n".join(d.page_content for d in ordered)


# ── RAG: calibration against the user's own rating history ───────────────────


async def _retrieve_similar_rated_jobs(
    user: dict, current_job: dict, current_job_embedding: list[float], k: int = 3
) -> list[dict]:
    """Find the user's own past-rated jobs most similar to current_job, so
    the rating LLM can calibrate against how the user felt about similar
    roles before (including any feedback they left on those ratings)."""
    if not current_job_embedding:
        return []

    user_id = str(user.get("_id", ""))
    rating_path = f"ratings.{user_id}"
    db = get_database()
    cursor = (
        db.jobs.find(
            {
                "crawled_by": user_id,
                f"{rating_path}.score": {"$gt": 0},
                "jd_embedding": {"$exists": True, "$ne": []},
                "_id": {"$ne": ObjectId(current_job["_id"])},
            },
            {
                "title": 1,
                "jd_embedding": 1,
                rating_path: 1,
                f"rating_feedback.{user_id}": 1,
            },
        )
        .sort(f"{rating_path}.rated_at", -1)
        .limit(SIMILAR_JOBS_LOOKBACK)
    )
    candidates = await cursor.to_list(length=SIMILAR_JOBS_LOOKBACK)
    if not candidates:
        return []

    texts, vecs, metadatas = [], [], []
    for c in candidates:
        rating = (c.get("ratings") or {}).get(user_id, {})
        user_feedback = (c.get("rating_feedback") or {}).get(user_id, {})
        title = c.get("title", "Untitled")
        texts.append(title)
        vecs.append(c["jd_embedding"])
        metadatas.append(
            {
                "title": title,
                "score": rating.get("score"),
                "verdict": rating.get("verdict", ""),
                "feedback": user_feedback.get("comment", ""),
                "stars": user_feedback.get("stars"),
            }
        )

    try:
        embeddings = get_embeddings()
    except Exception:
        return []
    index = build_faiss_index(texts, vecs, embeddings, metadatas=metadatas)
    if not index:
        return []

    results = retrieve_top_k(index, current_job_embedding, k=k)
    return [r.metadata for r in results]


def _build_similar_jobs_block(similar: list[dict]) -> str:
    if not similar:
        return ""
    lines = ["Similar jobs you've already rated (use these to calibrate consistency):"]
    for s in similar:
        line = f"  - {s['title']}: {s.get('score')}/10 — {s.get('verdict', '')}"
        if s.get("stars"):
            line += f" (user rated {s['stars']}/5 stars)"
        if s.get("feedback"):
            line += f" | user feedback: '{s['feedback']}'"
        lines.append(line)
    return "\n".join(lines)


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
        "rated_by_model": "auto (no LLM — low semantic match)",
    }


# ── Rate all (now fast for hundreds of jobs) ──────────────────────────────────


@traceable(name="rate_all_jobs", run_type="chain")
async def rate_all_jobs_for_user(user: dict, queue_filter: dict | None = None) -> dict:
    """queue_filter overrides which jobs are eligible (defaults to the normal
    "unrated only" queue). Callers passing a wider filter — e.g. re-rating
    jobs the user already tracked in their Kanban pipeline, or (admin-only)
    every job regardless of score — must include the same
    `verdict != RATING_IN_PROGRESS` guard so overlapping runs can't
    double-claim a job; see routes/jobs.py for the scope→filter mapping."""
    db = get_database()
    user_id = str(user["_id"])
    queue_filter = queue_filter or unrated_jobs_filter(user_id)
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

    # Jobs matching queue_filter; per-job quota still enforced inside rate_and_store.
    jobs = await db.jobs.find(queue_filter).to_list(length=RATE_ALL_MAX_JOBS)
    print(
        f"[rating] [queue] jobs found in queue for user: {len(jobs)} (capped by remaining quota)"
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
    skipped_count = 0
    error_count = 0

    async def rate_and_store(job):
        nonlocal prefilter_count, llm_count, skipped_count, error_count
        async with sem:
            job_id = str(job["_id"])
            job_title = str(job.get("title", "Unknown"))[:50]

            # Atomic claim — prevents duplicate LLM calls if rate-all runs overlap
            claimed = await db.jobs.find_one_and_update(
                {
                    "_id": ObjectId(job["_id"]),
                    "crawled_by": user_id,
                    **queue_filter,
                },
                {
                    "$set": {
                        f"ratings.{user_id}": {
                            "score": 0,
                            "matched_strengths": [],
                            "gaps": [],
                            "verdict": RATING_IN_PROGRESS,
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

            # Full accurate LLM rating — same prompt path as manual "Paste JD".
            # A cheap "fast" pass used to run first and only promoted to the
            # full prompt when its own (cruder) score was >= 7, so a real 8/9
            # match that the fast prompt under-scored as a 5 or 6 got stuck
            # there forever. That silently tanked match quality for crawled
            # jobs while manual paste-JD (always full prompt) stayed accurate.
            llm_count += 1
            sim_str = f" sim={sim:.3f}" if sim is not None else ""
            print(f"[rating] [{job_id}] LLM-FULL{sim_str} title='{job_title}'")
            try:
                rating = await rate_job_for_user(job, fresh_user)
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
        f"[rating] [queue] Summary: total_in_queue={len(jobs)} | skipped(already_rated)={skipped_count} | prefiltered(cheap,no-LLM)={prefilter_count} | llm_full={llm_count} | errors={error_count} | successfully_stored={rated_count}"
    )
    return {
        "rated": rated_count,
        "skipped": skipped_count,
        "prefiltered": prefilter_count,
        "llm_calls": llm_count,
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

    jd_context = await _retrieve_relevant_jd_context(
        job, cv_text, k=5, char_budget=3000
    )

    user_id = str(user.get("_id", ""))
    llm = get_llm()
    provider = settings.llm_provider
    model = getattr(llm, "model", getattr(llm, "model_name", settings.openai_model))
    structured_llm = llm.with_structured_output(
        RoastResult, include_raw=True, method="function_calling"
    )

    messages = [
        SystemMessage(content=ROAST_SYSTEM_PROMPT),
        HumanMessage(
            content=f"JOB DESCRIPTION:\n{jd_context}\n\nCANDIDATE CV:\n{cv_text}"
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
