"""
Apply pack — premium CV tailoring output (ATS keywords, XYZ bullets, LaTeX snippet).
"""

from __future__ import annotations

import json

from langchain_core.messages import HumanMessage, SystemMessage
from langsmith import traceable
from pydantic import BaseModel, Field

from config import settings
from services.ai_usage import record_from_llm_response
from services.jd_text import is_incomplete_jd
from services.llm import get_rating_llm
from services.cv_latex_boilerplate import (
    format_boilerplate_section,
    suggested_tex_filename,
)
from services.rating import _build_constraints_block, generate_job_brief

MIN_APPLY_PACK_SCORE = 6

APPLY_PACK_SYSTEM_PROMPT = """
You help a candidate tailor their application for ONE specific job using ONLY their MASTER CV.

Rules:
- MASTER CV is the only source of truth. Never invent skills, tools, metrics, job titles, or projects.
- Do not add numbers (%, counts, latency, scale) unless they appear verbatim in MASTER CV bullets or summary.
- ATS keywords: extract important terms from the JD (tools, frameworks, certifications, role phrases).
  Split into matched (appear in MASTER CV) vs missing (in JD but not in MASTER CV).
- Before listing anything as missing, re-read the FULL MASTER CV Experience, Projects, and Skills
  text yourself and confirm the term genuinely does not appear anywhere (including inside longer
  bullets, e.g. "AWS (EC2, S3)" satisfies "AWS" — do not miss keywords buried in a longer phrase).
- Tier every keyword (Essential vs Desirable / Required vs Preferred) using the JD's OWN section
  headers exactly as written. Never infer or upgrade a tier from wording alone — if the JD lists a
  skill under "Desirable" or "Nice to have", it is Desirable, even if it sounds important.
- Specifically check for named AI/agent protocols or frameworks the JD calls out as core requirements
  (e.g. MCP / Model Context Protocol server experience). If MASTER CV only shows the candidate
  learning or building toward it (not shipped/production experience), list it as missing — do not
  treat "currently learning X" as equivalent to having X.
- Do NOT tell the candidate to add missing keywords unless MASTER CV or skill overrides support them.
- Google XYZ bullets: rephrase EXISTING experience/project bullets from MASTER CV. Use strict XYZ
  format (Accomplished [X] as measured by [Y], by doing [Z]) ONLY where a real metric for that bullet
  already exists in MASTER CV. Where no real metric exists, use X/Z format (Accomplished [X] by doing
  [Z], no measured-by clause) — never invent a Y. Use 2-4 bullets. No new roles or achievements.
- Cover opener: 3-4 sentences for email or LinkedIn note — specific, grounded in MASTER CV facts.
- LaTeX snippet: short \\item bullets for experience (plain LaTeX, no preamble) — hints for the full .tex file.
- honest_notes: 1-3 caveats (e.g. structural mismatch, thin JD). No invented positives.

Keep language concrete. Use only project names, companies, and stack from MASTER CV.
""".strip()


class ApplyPackContent(BaseModel):
    ats_alignment_pct: int = Field(
        description="0-100 honest keyword alignment between JD and CV (not inflated)"
    )
    ats_keywords_matched: list[str] = Field(
        description="Important JD keywords/phrases already supported by the CV"
    )
    ats_keywords_missing: list[str] = Field(
        description="JD keywords not found in CV — gaps only, do not fabricate"
    )
    xyz_bullets: list[str] = Field(
        description=(
            "2-4 accomplishment bullets tailored to this role. Use Google XYZ format "
            "(Accomplished X as measured by Y, by doing Z) only where MASTER CV has a real "
            "metric for that bullet; otherwise use X/Z format with no invented Y."
        )
    )
    cover_opener: str = Field(description="3-4 sentence tailored cover note opener")
    latex_snippet: str = Field(
        description="LaTeX \\\\item bullets for experience section, no preamble"
    )
    honest_notes: list[str] = Field(
        default_factory=list, description="Caveats about fit or JD quality"
    )


def _format_master_cv(user: dict) -> str:
    """Human-readable master CV — source of truth for tailoring (not JobRadar marketing copy)."""
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
            f"  {edu.get('degree')} — {edu.get('institution')} "
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
MASTER CV — SOURCE OF TRUTH (tailor ONLY from this; do not invent facts)
{"=" * 42}
Name:     {structured.get('name', '')}
Summary:  {structured.get('summary', '')}
Skills:   {', '.join(structured.get('skills', []))}

ABOUT ME:
  {user.get('about_me', '').strip() or '(not set)'}

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


def format_apply_pack(job: dict, rating: dict, content: ApplyPackContent) -> str:
    matched = content.ats_keywords_matched or []
    missing = content.ats_keywords_missing or []
    xyz = content.xyz_bullets or []
    notes = content.honest_notes or []

    lines = [
        "APPLY PACK — JobRadar Pro",
        "=" * 42,
        f"ROLE:     {job.get('title', 'Unknown')}",
        f"COMPANY:  {job.get('company', 'Unknown')}",
        f"URL:      {job.get('url', 'N/A')}",
        f"FIT:      {rating.get('score', 'N/A')}/10",
        "",
        f"ATS ALIGNMENT: ~{content.ats_alignment_pct}% (keyword overlap estimate)",
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
        else lines.append("  (none — strong overlap)")
    )
    lines += [
        "",
        "SUGGESTED XYZ BULLETS (rephrase MASTER CV only — drop any line with facts not in MASTER CV):",
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

    if notes:
        lines += ["HONEST NOTES:"]
        lines.extend(f"  • {n}" for n in notes)
        lines.append("")

    lines += [
        "=" * 42,
    ]
    return "\n".join(lines)


def build_one_shot_instructions(user: dict, job: dict) -> str:
    filename = suggested_tex_filename(user, job)
    return f"""
══════════════════════════════════════════════════════════════
ONE-SHOT PROMPT — paste this ENTIRE document into ChatGPT / Claude / Grok
══════════════════════════════════════════════════════════════

You are an expert CV writer and LaTeX author. Produce tailored application content,
then a complete compilable CV .tex file.

STRICT RULES:
- MASTER CV (below) is the ONLY source of truth. Do not invent skills, tools, metrics, or roles.
- Do not add numbers (%, counts, scale, latency) unless they appear in MASTER CV bullets or summary.
- Rephrase and reorder EXISTING experience/project bullets — do not create new jobs or projects.
- Do NOT write a fit assessment, preamble, commentary, or closing notes ("let me know", "production-ready", etc.).
- Do NOT omit Education — copy every entry from MASTER CV (degree, institution, dates, grade).
- The GAPS list and APPLY PACK "JD keywords you lack" were generated by an earlier automated pass —
  do not take them on faith. Before treating anything as a gap, re-read MASTER CV Experience,
  Projects, and Skills yourself; if the term is actually present (including inside a longer bullet,
  e.g. "AWS (EC2, S3)" covers "AWS"), drop it from the gap list instead of repeating the error.
- When discussing any gap's severity, use the JD's own section headers (Essential/Required vs
  Desirable/Preferred/Nice-to-have) exactly as written — never infer or upgrade severity from tone.
- If the JD names a specific AI/agent protocol or framework as a core requirement (e.g. MCP / Model
  Context Protocol server experience) and MASTER CV only shows the candidate learning or building
  toward it rather than shipped/production experience, that IS a real gap — call it out, don't skip it.
- Google XYZ format (Accomplished [X] as measured by [Y], by doing [Z]) applies only to bullets where
  a real metric for that specific accomplishment exists in MASTER CV. Where no real metric exists,
  write X/Z instead (Accomplished [X] by doing [Z], no measured-by clause) — never invent a Y just to
  fill the format.
- Use LATEX BOILERPLATE (below) as the structural template — keep preamble and packages unchanged.

Use JOB BRIEF / JD only for emphasis and keyword ordering — not to invent experience.

PART 1 — OUTPUT EXACTLY THESE MARKDOWN HEADINGS (no text before ## Professional Summary):

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

PART 2 — AFTER Part 1, output exactly one more heading:

## Complete LaTeX CV
Output ONE fenced ```latex code block with a FULL compilable document:
- Start from LATEX BOILERPLATE below — same \\documentclass, packages, geometry, section order.
- Replace Summary, Technical Skills, Professional Experience, Key Projects, and Education
  using Part 1 content and MASTER CV facts only.
- Tailor bullet order and keyword emphasis for this role ({job.get('title', '')} @ {job.get('company', '')}).
- Escape LaTeX specials: % → \\%, & → \\&, _ → \\_ (outside \\texttt{{}}).
- Suggested filename: {filename}
- Must compile with pdflatex without errors.

If your environment can write files: save as {filename}, run pdflatex twice, and report the .tex and .pdf paths.
If not (most chat UIs): the ```latex block alone is enough — user pastes into Overleaf and Recompile.
No commentary after the code block.
""".strip()


@traceable(name="generate_apply_pack", run_type="chain")
async def generate_apply_pack(job: dict, user: dict, rating: dict) -> str:
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

    llm = get_rating_llm()
    structured_llm = llm.with_structured_output(
        ApplyPackContent, include_raw=True, method="function_calling"
    )
    provider = settings.rating_provider or settings.llm_provider
    model = getattr(
        llm, "model", getattr(llm, "model_name", settings.rating_model or "unknown")
    )

    human = f"""
JOB:
Title: {job.get('title')}
Company: {job.get('company')}
Location: {job.get('location', '')}

FIT SCORE: {rating.get('score')}/10
MATCHED STRENGTHS: {rating.get('matched_strengths', [])}
GAPS: {rating.get('gaps', [])}
VERDICT: {rating.get('verdict', '')}

JOB DESCRIPTION:
{jd_text}

CANDIDATE (JSON):
{_cv_context(user)}
""".strip()

    messages = [
        SystemMessage(content=APPLY_PACK_SYSTEM_PROMPT),
        HumanMessage(content=human),
    ]

    raw_result = await structured_llm.ainvoke(messages)
    if isinstance(raw_result, dict):
        parsed: ApplyPackContent | None = raw_result.get("parsed")
        raw_msg = raw_result.get("raw")
        if user_id and raw_msg:
            await record_from_llm_response(
                user_id,
                raw_msg,
                operation="apply_pack",
                provider=provider,
                model=str(model),
            )
    else:
        parsed = raw_result

    if not parsed:
        raise ValueError("Could not generate apply pack. Try again.")

    tailoring = format_apply_pack(job, rating, parsed)
    master_cv = _format_master_cv(user)
    latex_boilerplate = format_boilerplate_section(user, job)
    brief = await generate_job_brief(job, user, rating)

    return "\n\n".join(
        [
            build_one_shot_instructions(user, job),
            latex_boilerplate,
            master_cv,
            tailoring,
            "=" * 42,
            "JOB CONTEXT (fit analysis + full job description)",
            "=" * 42,
            brief,
        ]
    )
