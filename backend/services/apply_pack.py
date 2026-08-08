"""
Apply pack, premium CV tailoring output (ATS keywords, XYZ bullets, LaTeX snippet).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from config import settings
from services.ai_usage import record_from_llm_response
from services.jd_text import is_incomplete_jd
from services.llm import get_rating_llm, structured_output_kwargs
from services.ai_models import get_cost_multiplier, get_default_model_for_provider
from services.cv_latex_boilerplate import (
    _latex_escape,
    format_boilerplate_section,
    suggested_tex_filename,
)
from services.rating import _build_constraints_block, generate_job_brief
from services.prompt_safety import fence
from services.user_time import user_local_time

MIN_APPLY_PACK_SCORE = 6


def _attribution_line(user: dict) -> str:
    name = user.get("name") or "you"
    local = user_local_time(user, datetime.now(timezone.utc))
    when = local.strftime("%Y-%m-%d %H:%M %Z")
    return f"Built by JobRadarAI ({settings.frontend_url.rstrip('/')}) for {name} on {when}"


DRAFT_SYSTEM_PROMPT = """
You help a candidate tailor their application for ONE specific job using ONLY their MASTER CV.

Build tailored bullets and cover opener per the Rules below. A separate ATS screening pass
will check this draft against the JD afterward, so focus on producing the strongest honest
draft from MASTER CV, don't try to game keyword coverage yourself.

Rules:
- MASTER CV is the only source of truth. Never invent skills, tools, metrics, job titles, or projects.
- Do not add numbers (%, counts, latency, scale) unless they appear verbatim in MASTER CV bullets or summary.
- Google XYZ bullets: rephrase EXISTING experience/project bullets from MASTER CV. Use strict XYZ
  format (Accomplished [X] as measured by [Y], by doing [Z]) ONLY where [Y] is an actual number,
  percentage, count, or scale that appears VERBATIM in that specific MASTER CV bullet (e.g. "25%",
  "15+", "10-second window"). [Y] is never a vague qualitative phrase like "client satisfaction",
  "client feedback", "positive reception", or "improved efficiency", those are NOT metrics even if
  they sound like ones, and inventing one to fill the measured-by slot is the same rule violation as
  inventing a number. If the specific bullet you're rephrasing has no real number attached to it in
  MASTER CV, use X/Z format instead (Accomplished [X] by doing [Z], no measured-by clause at all).
  A metric that exists in MASTER CV for a DIFFERENT bullet may not be borrowed for this one. Use 2-4
  bullets. No new roles or achievements.
- ONE bullet = ONE accomplishment. Each XYZ/X-Z bullet must be a rephrasing of a SINGLE existing
  MASTER CV bullet (one experience entry or one project). Never combine two unrelated MASTER CV
  bullets into one sentence with an invented "by doing"/"through"/"which enabled" link between them,
  e.g. do not merge "built LLM features" with "maintained WordPress sites" into one bullet just
  because both appear in MASTER CV. If two bullets are both worth including, output them as two
  separate bullets, never stitched into a false causal chain.
- Apply the SAME rephrasing rule to every bullet in the list. Do not rephrase some bullets into XYZ/
  X-Z format and leave others as a verbatim copy-paste of the MASTER CV line, pick XYZ or X/Z per
  bullet based on whether it has a metric, but every bullet must be rephrased, none skipped.
- Cover opener: 3-4 sentences for email or LinkedIn note, specific, grounded in MASTER CV facts.
  Structure it by FIT SCORE (given below):
    - Score >= 8: lead with the single strongest technical match, stated as fact.
    - Score 6-7: sentence 1 states the strongest unambiguous match as fact (no "excited", no
      "aligns with"/"aligns directly"); sentence 2 gives one concrete example using the JD's exact
      wording; sentence 3 names the Essential gaps plainly ("I don't have X") with no hedging
      ("my background doesn't include formal X experience" is hedging, don't write that); sentence
      4 is a specific close tied to the actual work, not generic ("I look forward to hearing from
      you" / "I'm confident I'd be a great fit" are banned).
  NEVER write "aligns directly with" or "excited by the opportunity" before giving one concrete,
  specific connection first.
- honest_notes: 1-3 caveats (e.g. structural mismatch, thin JD). No invented positives.
- PROJECT SELECTION for any bullet drawn from MASTER CV projects (not experience):
    - Tier every candidate project Production (live/deployed, real or informal users) > Academic
      (coursework/dissertation, no live users) > Toy (small CRUD/tutorial builds). Prefer Production
      bullets. Use an Academic project only when it's the single best match for a specific JD
      requirement. Never lead with a Toy project.
    - Match project diversity to what the JD actually values, if it asks for range across
      paradigms/stacks, don't default to bullets from similar CRUD-flavored projects; surface
      genuinely different technical territory (real-time systems, ML-from-scratch, ops platforms)
      even if the keyword match is less literal.
    - If FIT SCORE < 7, lead with the bullet from the single most directly relevant Production
      project rather than spreading emphasis evenly across several medium-fit ones.

Keep language concrete. Use only project names, companies, and stack from MASTER CV.
""".strip()


ATS_CRITIQUE_SYSTEM_PROMPT = """
You are an Applicant Tracking System (ATS) screener. You did NOT write the draft below, a
different pass did, so read it cold and try to reject it, exactly like a real ATS/recruiter
scan would. Do not assume the draft is already optimized.

- Extract important terms from the JD (tools, frameworks, certifications, role phrases). Using
  MASTER CV (the candidate's real, complete background) and the DRAFT text together, split JD
  terms into matched (the draft's bullets/cover opener actually demonstrate it, or MASTER CV
  supports it) vs missing (JD asks for it, neither the draft nor MASTER CV shows it).
- Before listing anything as missing, re-read the FULL MASTER CV Experience, Projects, and Skills
  text yourself and confirm the term genuinely does not appear anywhere (including inside longer
  bullets, e.g. "AWS (EC2, S3)" satisfies "AWS", do not miss keywords buried in a longer phrase).
- Tier every keyword (Essential vs Desirable / Required vs Preferred) using the JD's OWN section
  headers exactly as written. Never infer or upgrade a tier from wording alone, if the JD lists a
  skill under "Desirable" or "Nice to have", it is Desirable, even if it sounds important.
- FALSE EQUIVALENCE CHECK on matched keywords: before listing a keyword as matched, confirm it
  actually satisfies the JD's requirement, not just a similar-sounding one. A CV term that sounds
  related but doesn't cover the JD ask (e.g. "mobile-first responsive web" ≠ "native mobile app
  development"; "LangSmith observability" ≠ "frontend observability tooling like Sentry/Lighthouse")
  must NOT be listed as matched, put it in missing instead, or if listed as matched, append an
  inline caveat to the string itself, e.g. "mobile-first development (web only, does not cover
  native mobile app development)".
- Specifically check for named AI/agent protocols or frameworks the JD calls out as core requirements
  (e.g. MCP / Model Context Protocol server experience). If MASTER CV only shows the candidate
  learning or building toward it (not shipped/production experience), list it as missing, do not
  treat "currently learning X" as equivalent to having X.
- ats_alignment_pct: 0-100 honest keyword alignment between JD and the draft/MASTER CV, not inflated.
- issues: list every CONCRETE reason a real ATS/recruiter would reject or rank this draft low,
  one per line: an Essential/Required JD keyword missing from the draft, a bullet with no
  measurable outcome where MASTER CV had a real metric available, a cover opener that opens with
  a hedge or cliche, a keyword tier mismatch. Only list issues that are actually fixable or worth
  flagging, do not invent problems to pad the list. Leave issues empty if the draft would already
  pass a real ATS screen cleanly.
""".strip()


ATS_REVISION_SYSTEM_PROMPT = """
You are fixing a CV draft that failed an ATS screening pass. You are given the original DRAFT,
MASTER CV, and a list of concrete ISSUES the ATS screen found. Fix ONLY what's listed, using
MASTER CV facts only, never invent anything to satisfy the ATS. Keep everything from the draft
that wasn't flagged.

For each issue, in order, add ONE line to ats_fixes describing what was changed and how, e.g.
"Missing 'Kubernetes' (Essential): added, appears in Skills as part of the CI/CD bullet." If an
issue genuinely cannot be fixed honestly from MASTER CV (the candidate really doesn't have it),
write that plainly instead, e.g. "Missing 'Terraform' (Essential): not present in MASTER CV,
left as a real gap." Never fabricate a fix.

Apply the same bullet-rephrasing, cover-opener FIT SCORE structure, and project-selection rules
that produced the original draft, just narrowly to resolve the listed issues.
""".strip()


class ApplyPackDraft(BaseModel):
    xyz_bullets: list[str] = Field(
        description=(
            "2-4 accomplishment bullets tailored to this role. Use Google XYZ format "
            "(Accomplished X as measured by Y, by doing Z) only where Y is an actual number, "
            "percentage, count, or scale that appears verbatim in that specific MASTER CV bullet. "
            "Y is never a vague qualitative phrase like 'client satisfaction' or 'positive "
            "reception', those are not metrics. Where the specific bullet has no real number, use "
            "X/Z format with no measured-by clause at all, never invent a Y and never borrow a "
            "metric from a different MASTER CV bullet. Each bullet must rephrase exactly ONE "
            "MASTER CV bullet, never merge two unrelated MASTER CV bullets into one sentence with "
            "a fabricated causal link. Every bullet in this list must be rephrased the same way; "
            "never leave one as a verbatim copy of MASTER CV."
        )
    )
    cover_opener: str = Field(
        description=(
            "3-4 sentence tailored cover note opener, structured by FIT SCORE per the system "
            'prompt rules. Never lead with "aligns directly with" or "excited by the opportunity".'
        )
    )
    honest_notes: list[str] = Field(
        default_factory=list, description="Caveats about fit or JD quality"
    )


class ATSCritique(BaseModel):
    ats_alignment_pct: int = Field(
        description="0-100 honest keyword alignment between JD and the draft/MASTER CV (not inflated)"
    )
    ats_keywords_matched: list[str] = Field(
        description=(
            "Important JD keywords/phrases already supported by the draft or MASTER CV. If a "
            "keyword only partially satisfies the JD ask, append an inline caveat instead of "
            'overstating it (e.g. "mobile-first development (web only, not native app dev)").'
        )
    )
    ats_keywords_missing: list[str] = Field(
        description="JD keywords not found in the draft or MASTER CV, gaps only, do not fabricate"
    )
    issues: list[str] = Field(
        default_factory=list,
        description=(
            "One line per concrete reason a real ATS/recruiter would reject or rank this draft "
            "low. Empty if the draft would already pass a real ATS screen cleanly."
        ),
    )


class ApplyPackRevision(BaseModel):
    xyz_bullets: list[str] = Field(
        description="Revised bullets, see ApplyPackDraft.xyz_bullets"
    )
    cover_opener: str = Field(
        description="Revised cover opener, see ApplyPackDraft.cover_opener"
    )
    honest_notes: list[str] = Field(
        default_factory=list, description="Revised honest_notes"
    )
    ats_fixes: list[str] = Field(
        description=(
            "One line per issue from the ATS critique: what was changed and how, or, if it "
            'couldn\'t be fixed honestly from MASTER CV, that it "remains a gap".'
        )
    )


class ApplyPackContent(BaseModel):
    """Final merged content used by format_apply_pack, assembled from the draft/critique/revision calls."""

    ats_alignment_pct: int
    ats_keywords_matched: list[str]
    ats_keywords_missing: list[str]
    xyz_bullets: list[str]
    cover_opener: str
    latex_snippet: str
    honest_notes: list[str] = Field(default_factory=list)
    ats_fixes: list[str] = Field(default_factory=list)


def _format_master_cv(user: dict) -> str:
    """Human-readable master CV, source of truth for tailoring (not JobRadar marketing copy)."""
    cv = user.get("cv", {})
    structured = cv.get("structured", {}) or {}
    overrides = user.get("skill_overrides", {}) or {}

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
        grade = edu.get("grade")
        grade_part = f", {grade}" if grade else ""
        education_lines.append(
            f"  {edu.get('degree')}, {edu.get('institution')} "
            f"({edu.get('start')} - {edu.get('end')}{grade_part})"
        )
    education_text = "\n".join(education_lines) or "  (none listed)"

    certs = structured.get("certifications") or []
    certs_text = "\n".join(f"  - {c}" for c in certs) if certs else "  (none listed)"
    langs = structured.get("languages") or []
    langs_text = ", ".join(langs) if langs else "(none listed)"

    overrides_text = (
        "\n".join(f"  {k}: {v}" for k, v in overrides.items())
        if overrides
        else "  (none)"
    )

    return f"""
MASTER CV, SOURCE OF TRUTH (tailor ONLY from this; do not invent facts)
{"=" * 42}
Name:     {structured.get("name", "")}
Summary:  {structured.get("summary", "")}
Skills:   {", ".join(structured.get("skills", []))}

ABOUT ME:
  {user.get("about_me", "").strip() or "(not set)"}

KNOWLEDGE OVERRIDES:
{overrides_text}

CONSTRAINTS:
{_build_constraints_block(user)}

EXPERIENCE:
{experience_text}

PROJECTS:
{projects_text}

EDUCATION:
{education_text}

CERTIFICATIONS:
{certs_text}

LANGUAGES:
  {langs_text}
{"=" * 42}
""".strip()


def _cv_context(user: dict) -> str:
    cv = user.get("cv", {})
    structured = cv.get("structured", {}) or {}
    overrides = user.get("skill_overrides", {}) or {}
    payload = {
        "name": structured.get("name"),
        "summary": structured.get("summary"),
        "skills": structured.get("skills", []),
        "experience": structured.get("experience", []),
        "projects": structured.get("projects", []),
        "education": structured.get("education", []),
        "certifications": structured.get("certifications", []),
        "languages": structured.get("languages", []),
        "about_me": user.get("about_me", ""),
        "skill_overrides": overrides,
        "constraints": _build_constraints_block(user),
    }
    return json.dumps(payload, indent=2)[:12000]


def format_apply_pack(
    job: dict, rating: dict, content: ApplyPackContent, user: dict
) -> str:
    matched = content.ats_keywords_matched or []
    missing = content.ats_keywords_missing or []
    xyz = content.xyz_bullets or []
    notes = content.honest_notes or []

    lines = [
        "APPLY PACK, JobRadar Pro",
        _attribution_line(user),
        "=" * 42,
        f"ROLE:     {job.get('title', 'Unknown')}",
        f"COMPANY:  {job.get('company', 'Unknown')}",
        f"URL:      {job.get('url', 'N/A')}",
        f"FIT:      {rating.get('score', 'N/A')}/10",
        "",
        f"ATS ALIGNMENT: ~{content.ats_alignment_pct}% (keyword overlap estimate, before automatic fixes below)",
        "",
        "KEYWORDS ALREADY IN YOUR CV (keep visible):",
    ]
    (
        lines.extend(f"  • {k}" for k in matched)
        if matched
        else lines.append("  (none identified)")
    )
    lines += [
        "",
        "JD KEYWORDS YOU LACK (do not fabricate):",
    ]
    (
        lines.extend(f"  • {k}" for k in missing)
        if missing
        else lines.append("  (none, strong overlap)")
    )
    lines += [
        "",
        "SUGGESTED XYZ BULLETS (rephrase MASTER CV only, drop any line with facts not in MASTER CV):",
    ]
    lines.extend(f"  • {b}" for b in xyz)
    lines += [
        "",
        "COVER NOTE OPENER:",
        f"  {content.cover_opener.strip()}",
        "",
        "LATEX SNIPPET (Experience section):",
        content.latex_snippet.strip(),
        "",
    ]

    ats_fixes = content.ats_fixes or []
    if ats_fixes:
        lines += ["ATS SCREENING (what would've gotten this rejected, and the fix):"]
        lines.extend(f"  • {f}" for f in ats_fixes)
        lines.append("")

    if notes:
        lines += ["HONEST NOTES:"]
        lines.extend(f"  • {n}" for n in notes)
        lines.append("")

    lines += [
        "=" * 42,
    ]
    return "\n".join(lines)


def build_one_shot_instructions(user: dict, job: dict, rating: dict) -> str:
    filename = suggested_tex_filename(user, job)
    score = rating.get("score")
    score_anchor_note = (
        f"FIT SCORE is {score}/10, below 7, so lead Key Projects with the single most directly "
        "relevant Production-tier project rather than spreading emphasis evenly across several."
        if isinstance(score, (int, float)) and score < 7
        else f"FIT SCORE is {score}/10." if score is not None else ""
    )
    return f"""
══════════════════════════════════════════════════════════════
ONE-SHOT PROMPT, paste this ENTIRE document into ChatGPT / Claude / Grok
══════════════════════════════════════════════════════════════
{_attribution_line(user)}

You are an expert CV writer and LaTeX author. Produce tailored application content,
then a complete compilable CV .tex file.

STRICT RULES:
- MASTER CV (below) is the ONLY source of truth. Do not invent skills, tools, metrics, or roles.
- Do not add numbers (%, counts, scale, latency) unless they appear in MASTER CV bullets or summary.
- Rephrase and reorder EXISTING experience/project bullets, do not create new jobs or projects.
- Do NOT write a fit assessment, preamble, commentary, or closing notes ("let me know", "production-ready", etc.).
- Do NOT omit Education, copy every entry from MASTER CV (degree, institution, dates, grade).
- The GAPS list and APPLY PACK "JD keywords you lack" were generated by an earlier automated pass,
  do not take them on faith. Before treating anything as a gap, re-read MASTER CV Experience,
  Projects, and Skills yourself; if the term is actually present (including inside a longer bullet,
  e.g. "AWS (EC2, S3)" covers "AWS"), drop it from the gap list instead of repeating the error.
- When discussing any gap's severity, use the JD's own section headers (Essential/Required vs
  Desirable/Preferred/Nice-to-have) exactly as written, never infer or upgrade severity from tone.
- If the JD names a specific AI/agent protocol or framework as a core requirement (e.g. MCP / Model
  Context Protocol server experience) and MASTER CV only shows the candidate learning or building
  toward it rather than shipped/production experience, that IS a real gap, call it out, don't skip it.
- Google XYZ format (Accomplished [X] as measured by [Y], by doing [Z]) applies only to bullets where
  a real metric for that specific accomplishment exists in MASTER CV. Where no real metric exists,
  write X/Z instead (Accomplished [X] by doing [Z], no measured-by clause), never invent a Y just to
  fill the format.
- ONE bullet = ONE accomplishment. Each bullet must rephrase a SINGLE existing MASTER CV bullet. Never
  merge two unrelated MASTER CV bullets into one sentence with an invented "by doing" / "through" link
  between them (e.g. do not connect an LLM-integration bullet to an unrelated WordPress-maintenance
  bullet as if one caused the other). If both are worth including, write two separate bullets.
- Apply the same rephrasing treatment to every bullet, do not rephrase some into XYZ/X-Z format and
  leave others as an unrephrased, verbatim copy of the MASTER CV line.
- Use LATEX BOILERPLATE (below) as the structural template, keep preamble and packages unchanged.

Use JOB BRIEF / JD only for emphasis and keyword ordering, not to invent experience.

PART 1, OUTPUT EXACTLY THESE MARKDOWN HEADINGS (no text before ## Professional Summary):

## Professional Summary
(max 3 lines, grounded in MASTER CV)

## Experience
(4-6 bullets, derived ONLY from MASTER CV experience and projects. Use Google XYZ format
 (Accomplished [X] as measured by [Y], by doing [Z]) only where MASTER CV has a real metric
 for that bullet; otherwise use X/Z format (Accomplished [X] by doing [Z]) with no invented Y.)

## Education
(ALL entries from MASTER CV)

## Skills
(Reorder MASTER CV skills for this JD; group for ATS; no new skills)

## Cover Note
(3-4 sentences; start from COVER NOTE OPENER in APPLY PACK section)

PART 2, AFTER Part 1, output exactly one more heading:

## Complete LaTeX CV
Output ONE fenced ```latex code block with a FULL compilable document:
- Start from LATEX BOILERPLATE below, same \\documentclass, packages, geometry, section order.
- Replace Summary, Technical Skills, Professional Experience, and Education using Part 1 content
  and MASTER CV facts only.
- KEY PROJECTS SELECTION, pick from MASTER CV projects using these rules, in order:
    1. Tier every candidate project Production (live/deployed, real or informal users) > Academic
       (coursework/dissertation, no live users) > Toy (small CRUD/tutorial builds). Always prefer
       Production. Use an Academic project only when it's the single best match for a specific JD
       requirement. Never lead with a Toy project.
    2. Never bundle multiple unrelated small projects into one bullet (e.g. "three REST APIs: X, Y,
       Z" reads as padding regardless of how true it is), give each real bullets, or drop the set
       in favor of a stronger single project.
    3. Match project diversity to what the JD actually values. If it explicitly asks for range
       across paradigms/stacks, do not submit several similar CRUD-flavored variants, surface
       genuinely different technical territory (real-time/server-authoritative systems, ML-from-
       scratch, multi-domain ops platforms) even if the keyword match is less literal.
    4. Cap at 3-4 projects, minimum 3 bullets each. Never include a project with only 1 bullet, if
       it can't support 3 real bullets from MASTER CV, replace it with a stronger project rather
       than padding it with filler.
    5. {score_anchor_note}
- Tailor bullet order and keyword emphasis for this role ({job.get("title", "")} @ {job.get("company", "")}).
- Escape LaTeX specials: % → \\%, & → \\&, _ → \\_ (outside \\texttt{{}}).
- Suggested filename: {filename}
- Must compile with pdflatex without errors.

If your environment can write files: save as {filename}, run pdflatex twice, and report the .tex and .pdf paths.
If not (most chat UIs): the ```latex block alone is enough, user pastes into Overleaf and Recompile.
No commentary after the code block.
""".strip()


# Rotating status lines shown to the user while each real generation step runs,
# keyed by the stage name yielded from generate_apply_pack_stream below.
STAGE_FLAVOR = {
    "drafting": [
        "Reading your CV against this job...",
        "Writing tailored bullets...",
    ],
    "screening": [
        "Running an independent ATS scan...",
        "Checking keyword coverage...",
    ],
    "revising": [
        "Fixing what the ATS scan flagged...",
    ],
    "brief": [
        "Writing your fit brief...",
        "Weighing strengths against gaps...",
    ],
    "packaging": [
        "Packaging everything up...",
        "Almost there...",
    ],
}


async def _run_structured(
    structured_llm, messages, *, user_id, provider, model, cost_multiplier
):
    """Runs one structured-output call and records its token usage. Shared by the
    draft/critique/revision calls below, they all follow the same include_raw shape."""
    raw_result = await structured_llm.ainvoke(messages)
    if isinstance(raw_result, dict):
        parsed = raw_result.get("parsed")
        raw_msg = raw_result.get("raw")
        if user_id and raw_msg:
            await record_from_llm_response(
                user_id,
                raw_msg,
                operation="apply_pack",
                provider=provider,
                model=str(model),
                cost_multiplier=cost_multiplier,
            )
    else:
        parsed = raw_result
    return parsed


async def generate_apply_pack_stream(job: dict, user: dict, rating: dict):
    """Async generator yielding ("stage", {"stage": key, "messages": [...]}) tuples as
    each real step starts, then a final ("done", {"pack": str, "ats": {...}}) with the
    finished apply pack. Lets the caller show live progress instead of one long blocking wait.

    Runs a real draft -> independent ATS critique -> bounded single revision loop (max 3 LLM
    calls), rather than asking one call to roleplay both a draft and its own critique.
    """
    if is_incomplete_jd(job.get("full_text", "")):
        raise ValueError(
            "Job description is incomplete. Paste the full JD or re-crawl before generating an apply pack."
        )

    score = rating.get("score") or 0
    if score < MIN_APPLY_PACK_SCORE:
        raise ValueError(
            f"Apply pack is available for jobs scoring {MIN_APPLY_PACK_SCORE}+. This job is {score}/10."
        )

    jd_text = (job.get("full_text") or "")[:5000]
    user_id = str(user.get("_id", ""))

    user_provider = user.get("rating_provider") or None
    user_model = user.get("rating_model") or (
        await get_default_model_for_provider(user_provider, "rating")
        if user_provider
        else None
    )
    cost_multiplier = await get_cost_multiplier(user_provider, user_model, "rating")
    llm = get_rating_llm(provider=user_provider, model=user_model)
    provider = user_provider or settings.rating_provider or settings.llm_provider
    model = getattr(
        llm,
        "model",
        getattr(llm, "model_name", user_model or settings.rating_model or "unknown"),
    )
    kwargs = structured_output_kwargs(provider)
    usage_kwargs = dict(
        user_id=user_id, provider=provider, model=model, cost_multiplier=cost_multiplier
    )

    jd_block = fence("JOB DESCRIPTION", jd_text)
    master_cv = _format_master_cv(user)
    job_header = f"""
JOB:
Title: {job.get("title")}
Company: {job.get("company")}
Location: {job.get("location", "")}

FIT SCORE: {rating.get("score")}/10
MATCHED STRENGTHS: {rating.get("matched_strengths", [])}
GAPS: {rating.get("gaps", [])}
VERDICT: {rating.get("verdict", "")}
""".strip()

    # --- Call 1: draft ---
    draft_llm = llm.with_structured_output(
        ApplyPackDraft, include_raw=True, method="function_calling", **kwargs
    )
    draft_human = f"""
{job_header}

{jd_block}

CANDIDATE (JSON):
{_cv_context(user)}
""".strip()
    yield "stage", {"stage": "drafting", "messages": STAGE_FLAVOR["drafting"]}
    draft: ApplyPackDraft | None = await _run_structured(
        draft_llm,
        [SystemMessage(content=DRAFT_SYSTEM_PROMPT), HumanMessage(content=draft_human)],
        **usage_kwargs,
    )
    if not draft:
        raise ValueError("Could not generate apply pack. Try again.")

    # --- Call 2: independent ATS critique of the draft ---
    critique_llm = llm.with_structured_output(
        ATSCritique, include_raw=True, method="function_calling", **kwargs
    )
    critique_human = f"""
{job_header}

{jd_block}

{master_cv}

DRAFT (written by a separate pass, read it cold):
XYZ BULLETS:
{chr(10).join(f"- {b}" for b in draft.xyz_bullets)}

COVER OPENER:
{draft.cover_opener}
""".strip()
    yield "stage", {"stage": "screening", "messages": STAGE_FLAVOR["screening"]}
    critique: ATSCritique | None = await _run_structured(
        critique_llm,
        [
            SystemMessage(content=ATS_CRITIQUE_SYSTEM_PROMPT),
            HumanMessage(content=critique_human),
        ],
        **usage_kwargs,
    )
    if not critique:
        raise ValueError("Could not generate apply pack. Try again.")

    # --- Call 3: bounded single revision, only if the critique found real issues ---
    if critique.issues:
        revision_llm = llm.with_structured_output(
            ApplyPackRevision, include_raw=True, method="function_calling", **kwargs
        )
        revision_human = f"""
{job_header}

{master_cv}

ORIGINAL DRAFT:
XYZ BULLETS:
{chr(10).join(f"- {b}" for b in draft.xyz_bullets)}

COVER OPENER:
{draft.cover_opener}

ISSUES FROM ATS SCREEN (fix these only):
{chr(10).join(f"- {issue}" for issue in critique.issues)}
""".strip()
        yield "stage", {"stage": "revising", "messages": STAGE_FLAVOR["revising"]}
        revision: ApplyPackRevision | None = await _run_structured(
            revision_llm,
            [
                SystemMessage(content=ATS_REVISION_SYSTEM_PROMPT),
                HumanMessage(content=revision_human),
            ],
            **usage_kwargs,
        )
        if not revision:
            raise ValueError("Could not generate apply pack. Try again.")
        final_bullets = revision.xyz_bullets
        final_cover_opener = revision.cover_opener
        final_notes = revision.honest_notes
        ats_fixes = revision.ats_fixes
    else:
        final_bullets = draft.xyz_bullets
        final_cover_opener = draft.cover_opener
        final_notes = draft.honest_notes
        ats_fixes = ["ATS screen passed cleanly, no revisions needed."]

    parsed = ApplyPackContent(
        ats_alignment_pct=critique.ats_alignment_pct,
        ats_keywords_matched=critique.ats_keywords_matched,
        ats_keywords_missing=critique.ats_keywords_missing,
        xyz_bullets=final_bullets,
        cover_opener=final_cover_opener,
        # Deterministic, not LLM-generated, turning bullets into \item lines is a
        # mechanical transform; asking the model to redo it kept drifting into
        # unrelated/lazier content (bare job titles) despite explicit instructions.
        latex_snippet="\n".join(f"\\item {_latex_escape(b)}" for b in final_bullets),
        honest_notes=final_notes,
        ats_fixes=ats_fixes,
    )

    tailoring = format_apply_pack(job, rating, parsed, user)
    latex_boilerplate = format_boilerplate_section(user, job)

    yield "stage", {"stage": "brief", "messages": STAGE_FLAVOR["brief"]}
    brief = await generate_job_brief(job, user, rating)

    yield "stage", {"stage": "packaging", "messages": STAGE_FLAVOR["packaging"]}
    pack = "\n\n".join(
        [
            build_one_shot_instructions(user, job, rating),
            latex_boilerplate,
            master_cv,
            tailoring,
            "=" * 42,
            "JOB CONTEXT (fit analysis + full job description)",
            "=" * 42,
            brief,
        ]
    )
    yield "done", {
        "pack": pack,
        "ats": {
            "alignment_pct": parsed.ats_alignment_pct,
            "matched": parsed.ats_keywords_matched,
            "missing": parsed.ats_keywords_missing,
            "fixes": parsed.ats_fixes,
        },
    }
