"""
Apply pack, premium CV tailoring output (ATS keywords, XYZ bullets, LaTeX snippet).
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from datetime import datetime, timezone

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from config import settings
from services.ai_usage import record_from_llm_response
from services.jd_text import is_incomplete_jd
from services.llm import get_rating_llm, structured_output_kwargs
from services.ai_models import get_cost_multiplier, get_default_model_for_provider
from services.cv_latex_boilerplate import (
    _clean_bullet,
    _de_emdash,
    _latex_escape,
    format_boilerplate_section,
    suggested_tex_filename,
)
from services.rating import (
    _build_constraints_block,
    _GENERIC_TOKENS,
    _TOKEN_RE,
    generate_job_brief,
)
from services.prompt_safety import fence
from services.user_time import user_local_time

MIN_APPLY_PACK_SCORE = 6
# One structured call can sit on a slow/broken provider forever; fail loud instead.
# DeepSeek flash regularly spends ~110s on a structured draft; 120s was too tight.
_APPLY_PACK_LLM_TIMEOUT_S = 300.0


def _ap_log(msg: str) -> None:
    print(f"[apply_pack] {msg}", flush=True)


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
- Never use an em dash (the long dash). Use a comma, a colon, or a normal hyphen. Em dashes read as AI-written.
- MASTER CV is the only source of truth. Never invent skills, tools, metrics, job titles, or projects.
- Do not add numbers (%, counts, latency, scale) unless they appear verbatim in MASTER CV bullets or summary.
- tailored_experience: ONE entry per real MASTER CV experience role, `company` must exactly match a
  MASTER CV company, NEVER drop a role. At least 3 bullets per role where MASTER CV has 3+ real
  bullets to draw from for that specific role (more bullets for the most recent/relevant role,
  fewer than 3 only when MASTER CV genuinely has fewer than 3 bullets for that role, never pad or
  invent to hit a count). A short leadership/lead line near Education still counts as a role if it
  has its own company/context in MASTER CV, include it too, don't drop it for being brief.
- Google XYZ bullets: rephrase EXISTING experience/project bullets from MASTER CV. Use strict XYZ
  structure ([did X] as measured by [Y], by doing [Z]) ONLY where [Y] is an actual number,
  percentage, count, or scale that appears VERBATIM in that specific MASTER CV bullet (e.g. "25%",
  "15+", "10-second window"). [Y] is never a vague qualitative phrase like "client satisfaction",
  "client feedback", "positive reception", or "improved efficiency", those are NOT metrics even if
  they sound like ones, and inventing one to fill the measured-by slot is the same rule violation as
  inventing a number. If the specific bullet you're rephrasing has no real number attached to it in
  MASTER CV, use X/Z structure instead ([did X] by doing [Z], no measured-by clause at all),
  and set has_real_metric to False, since false claims here get stripped automatically regardless
  of what you write in `text`, so there is no upside to inventing one. A metric that exists in
  MASTER CV for a DIFFERENT bullet may not be borrowed for this one. No new roles or achievements.
- ONE bullet = ONE accomplishment. Each XYZ/X-Z bullet must be a rephrasing of a SINGLE existing
  MASTER CV bullet (one experience entry or one project). Never combine two unrelated MASTER CV
  bullets into one sentence with an invented "by doing"/"through"/"which enabled" link between them,
  e.g. do not merge "built LLM features" with "maintained WordPress sites" into one bullet just
  because both appear in MASTER CV. If two bullets are both worth including, output them as two
  separate bullets, never stitched into a false causal chain.
- Apply the SAME rephrasing rule to every bullet. Do not rephrase some bullets into XYZ/X-Z format
  and leave others as a verbatim copy-paste of the MASTER CV line, pick XYZ or X/Z per bullet based
  on whether it has a metric, but every bullet must be rephrased, none skipped.
- Vary the opening verb across bullets (Built, Led, Designed, Reduced, Automated, Shipped,
  Architected, Debugged, etc., pick whatever actually fits that bullet's real accomplishment).
  Do not open every single bullet with the same word, e.g. "Accomplished", that reads as an
  obvious template stamped 10+ times in a row, vary rhythm and sentence opening like an actual
  person wrote it, while keeping the underlying XYZ/X-Z measured-by structure intact.
- cover_letter: four SEPARATE fields, each different content, a real hiring-manager letter not
  a four-bullet form. Recruiter-readable: lead with match, prove it, name the one stack gap
  the posting leans on, close on this job's actual work.
    - strongest_match: 1-2 sentences, the single strongest unambiguous match, stated as fact, no
      "excited", no "aligns with"/"aligns directly".
    - concrete_example: 1-2 sentences. Map TWO distinct MASTER CV proof points to the JD's own
      wording when the posting has two themes (e.g. core stack AND a named product/process).
      Different substance from strongest_match and from gaps_named, do not reuse the same
      accomplishment or the same sentence you already used elsewhere.
    - gaps_named:
        * One sentence per ESSENTIAL gap (same order as listed). NAME the missing tech, then
          pivot to the closest real transferable evidence in the SAME sentence using TAILORING
          TIPS, e.g. "My REST API experience is in FastAPI rather than Flask specifically, though
          the same request/response and middleware patterns apply directly." NOT "My FastAPI
          experience closely aligns with Flask API development" alone. NO hedging ("my background
          doesn't include formal X experience" is hedging, banned) and no flat admission with
          zero reframe when a reframe is already in TAILORING TIPS.
        * If there are zero Essential gaps: still write ONE sentence for the single Preferred/
          Desirable gap the JD leans on hardest, especially any gap a TAILORING TIP told you to
          acknowledge (e.g. "actively working through native AWS managed services"). Empty only
          when there is no such gap and no such tip. Never claim the missing stack as a skill.
    - close: one sentence, specific, tied to this posting's actual work, never generic
      ("I look forward to hearing from you", "I look forward to discussing", "I'm confident I'd be
      a great fit" are all banned, that's the same generic pattern with different wording).
  This structure applies regardless of FIT SCORE, only the tone of strongest_match shifts: FIT
  SCORE >= 8 leads with the single strongest technical match as fact; FIT SCORE 6-7 still leads
  with a real match first, gaps come after, never the reverse.
- honest_notes: 1-3 caveats (e.g. structural mismatch, thin JD). No invented positives.
- selected_projects: separately from tailored_experience, pick 3-4 MASTER CV projects for this JD.
  Default 4-5 tailored bullets per project (MASTER CV may have 6-7, trim to the JD-relevant ones).
  If the project is a strong match for this JD (core stack or domain overlap), keep 5-6.
  If MASTER CV has fewer than 4 bullets for that project, still return 4: rephrase leftover
  description/tech/experience facts from THAT project, never invent metrics or tools.
  Same XYZ/X-Z rephrasing rule as above, using ONLY facts from that specific MASTER CV project:
    - Tier every candidate project Production (live/deployed, real or informal users) > Academic
      (coursework/dissertation, no live users) > Toy (small CRUD/tutorial builds). Prefer Production
      first. Use an Academic project only when it's the single best match for a specific JD
      requirement. Never lead with a Toy project.
    - Match project diversity to what the JD actually values, if it asks for range across
      paradigms/stacks, don't default to several similar CRUD-flavored projects; surface
      genuinely different technical territory (real-time systems, ML-from-scratch, ops platforms)
      even if the keyword match is less literal.
    - If FIT SCORE < 7, lead with the single most directly relevant Production project rather
      than spreading emphasis evenly across several medium-fit ones.
    - `name` must exactly match a MASTER CV project name, never invent a project.
    - If SHOWCASE WORK is listed, those MASTER CV projects/roles MUST lead selected_projects
      (user's order) and stay visible in tailored_experience. Never drop a showcase item that
      exists in MASTER CV. Fill remaining slots with other JD-relevant MASTER CV projects.
- tailored_summary: HARD CEILING of 2-4 sentences, not a suggestion, rewrite the MASTER CV summary
  emphasizing what's relevant to this JD. Trim, reorder, and reframe, never add a claim that isn't
  already somewhere in MASTER CV (summary, experience, or projects). A longer summary is a failed
  draft even if every sentence is honest, cut it down to 2-4 before returning it. This is the field
  most likely to accidentally fabricate a tool name, because it's free text instead of a
  validated list like selected_skills, watch this specifically: if the JD names a tool the
  candidate lacks (e.g. JD wants Flask, MASTER CV only has FastAPI), NEVER write "I have FastAPI
  and Flask" or any phrasing that claims the missing tool directly, that is fabrication. Either
  name only the real tool (FastAPI), or use honest transferable-skill language ("FastAPI-based
  REST API work") without ever naming the tool the candidate doesn't have. Before finalizing this
  field, re-check every named tool/tech word in it against Skills/Experience/Projects above, one
  at a time.
- selected_skills: for EACH MASTER CV skills category, use the EXACT category name shown under
  "Skills:" in MASTER CV above, copy it character for character, never invent a new category label
  (e.g. if MASTER CV shows "Cloud & DevOps", use that, not "Cloud Technologies" or "DevOps"). Trim
  `items` to the skills actually relevant to this JD, never invent a skill. A category with nothing
  relevant to this JD can be omitted entirely.

Keep language concrete. Use only project names, companies, and stack from MASTER CV.
""".strip()


ATS_CRITIQUE_SYSTEM_PROMPT = """
You are an Applicant Tracking System (ATS) screener. You did NOT write the draft below, a
different pass did, so read it cold and try to reject it, exactly like a real ATS/recruiter
scan would. Do not assume the draft is already optimized.

- Extract important terms from the JD (tools, frameworks, certifications, role phrases). Using
  MASTER CV (the candidate's real, complete background) and the DRAFT text together, split JD
  terms into matched (the draft's summary/bullets/skills/cover letter actually demonstrate it,
  or MASTER CV supports it) vs missing (JD asks for it, neither the draft nor MASTER CV shows it).
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
- Cover letter check: if TAILORING TIPS told the candidate to acknowledge a missing stack or
  JD-central theme (even Preferred/Desirable) and the cover letter never names it, that is an
  issue. A letter that only lists Essential gaps and skips a tip like "actively working through
  native AWS managed services" is incomplete.
- issues: list every CONCRETE reason a real ATS/recruiter would reject or rank this draft low,
  one per line: an Essential/Required JD keyword missing from the draft, a bullet with no
  measurable outcome where MASTER CV had a real metric available, a cover letter that opens with
  a hedge or cliche, a cover letter that ignored a TAILORING TIP acknowledgment, a dropped
  MASTER CV role, a keyword tier mismatch. Only list issues that are actually fixable or worth
  flagging, do not invent problems to pad the list. Leave issues empty if the draft would
  already pass a real ATS screen cleanly.
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

Apply the same bullet-rephrasing, cover-letter, project-selection, and skills-selection rules
that produced the original draft, just narrowly to resolve the listed issues.
""".strip()


class SelectedProject(BaseModel):
    name: str = Field(
        description="Must exactly match a MASTER CV project name, never invented"
    )
    bullets: list[str] = Field(
        description="4-5 tailored bullets (5-6 if this project strongly matches the JD), "
        "same XYZ/X-Z rules as experience bullets. Trim a long MASTER CV list; pad a short "
        "one from that project's own description/tech, never invent."
    )


class SelectedSkillGroup(BaseModel):
    category: str = Field(
        description="Must exactly match a MASTER CV skills category name"
    )
    items: list[str] = Field(
        description="Trimmed to skills from this category actually relevant to the JD, only "
        "real MASTER CV items, never invented, never a skill with no backing project/experience"
    )


class TailoredBullet(BaseModel):
    text: str = Field(
        description="One tailored XYZ/X-Z bullet, see system prompt rules"
    )
    has_real_metric: bool = Field(
        description="True only if the measured-by clause in `text` is an actual number/percentage/"
        "count/scale that appears verbatim in the specific MASTER CV bullet being rephrased. False "
        "if this bullet uses X/Z format with no measured-by clause. A measured-by clause on a "
        "bullet marked False gets stripped automatically, there's no upside to marking this True "
        "dishonestly."
    )


class TailoredRole(BaseModel):
    company: str = Field(
        description="Must exactly match a MASTER CV experience entry's company, never invented"
    )
    bullets: list[TailoredBullet] = Field(
        min_length=1,
        description="Tailored bullets for THIS role specifically, at least 3 where MASTER CV has "
        "3+ real bullets for this role, fewer only when MASTER CV genuinely has fewer, never a "
        "pool shared across roles.",
    )


class CoverLetterParts(BaseModel):
    strongest_match: str = Field(
        description="Part 1: 1-2 sentences, strongest unambiguous match, stated as fact, no hedging"
    )
    concrete_example: str = Field(
        description="Part 2: 1-2 sentences mapping distinct MASTER CV proof points to JD wording"
    )
    gaps_named: list[str] = Field(
        description="Part 3: one sentence per Essential gap; if none, one sentence for the "
        "JD-central Preferred gap a TAILORING TIP said to acknowledge. Name-then-pivot, never empty "
        "when a tip asked for an acknowledgment."
    )
    close: str = Field(
        description="Part 4: specific close tied to the actual work discussed, never generic"
    )


class ApplyPackDraft(BaseModel):
    tailored_summary: str = Field(
        description="2-4 sentences, a trimmed/JD-relevant rewrite of the MASTER CV summary, only "
        "facts from MASTER CV, never a new claim not already in the summary or experience/projects"
    )
    tailored_experience: list[TailoredRole] = Field(
        min_length=1,
        description="ONE entry per real MASTER CV experience role, never omit a role, never pool "
        "bullets across roles.",
    )
    cover_letter: CoverLetterParts = Field(
        description="4-part cover letter, see system prompt"
    )
    honest_notes: list[str] = Field(
        default_factory=list, description="Caveats about fit or JD quality"
    )
    selected_projects: list[SelectedProject] = Field(
        description="3-4 MASTER CV projects chosen and tailored for this JD, see PROJECT SELECTION rules"
    )
    selected_skills: list[SelectedSkillGroup] = Field(
        description="MASTER CV skill categories trimmed to what's relevant for this JD, see "
        "SKILLS SELECTION rules"
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


class ApplyPackRevision(ApplyPackDraft):
    ats_fixes: list[str] = Field(
        description=(
            "One line per issue from the ATS critique: what was changed and how, or, if it "
            'couldn\'t be fixed honestly from MASTER CV, that it "remains a gap".'
        )
    )


class ApplyPackCvOnly(BaseModel):
    """Partial regen: CV fields only, cover letter stays as-is."""

    tailored_summary: str
    tailored_experience: list[TailoredRole]
    selected_projects: list[SelectedProject]
    selected_skills: list[SelectedSkillGroup]
    honest_notes: list[str] = Field(default_factory=list)


class ApplyPackContent(BaseModel):
    """Final merged content used by format_apply_pack, assembled from the draft/critique/revision calls."""

    ats_alignment_pct: int
    ats_keywords_matched: list[str]
    ats_keywords_missing: list[str]
    tailored_summary: str = ""
    tailored_experience: list[TailoredRole]
    cover_letter: CoverLetterParts
    selected_projects: list[SelectedProject] = Field(default_factory=list)
    selected_skills: list[SelectedSkillGroup] = Field(default_factory=list)
    honest_notes: list[str] = Field(default_factory=list)
    ats_fixes: list[str] = Field(default_factory=list)


_PROPER_NOUN_RE = re.compile(r"\b[A-Z][A-Za-z0-9+.#]{2,}\b")


def _unbacked_summary_terms(summary: str, master_cv_text: str) -> list[str]:
    """Deterministic backstop: tailored_summary is free text, not validated against real
    MASTER CV facts the way selected_skills/selected_projects/tailored_experience are (each
    of those is checked against real names in assemble_tailored_tex). Flags any capitalized,
    tech-looking word in the summary that never appears anywhere in the full MASTER CV text,
    catching real fabrication (e.g. "FastAPI and Flask" when only FastAPI is real) without
    needing to parse natural language, real tool names the candidate has are always somewhere
    in MASTER CV verbatim (skills, experience, or project bullets).
    ponytail: token-presence heuristic, not full fact-checking, won't catch a fabricated CLAIM
    built entirely from real words (e.g. inventing a metric using real tool names), only a
    genuinely new tool/tech name, that's the specific failure mode this was written for.
    """
    vocab = {w.lower() for w in _PROPER_NOUN_RE.findall(master_cv_text)}
    sentences = re.split(r"(?<=[.!?])\s+", summary.strip())
    unbacked = []
    for sentence in sentences:
        words = _PROPER_NOUN_RE.findall(sentence)
        for i, w in enumerate(words):
            if i == 0:
                continue  # sentence-initial capitalization isn't a proper-noun signal
            if w.lower() not in vocab and w not in unbacked:
                unbacked.append(w)
    return unbacked


def _ensure_matched_strength_skills_survive(
    selected_skills: list, matched_strengths: list, structured_skills: list
) -> list:
    """A skill the rating already credited as a matched strength (e.g. "Expert-level Git
    operations") shouldn't then get trimmed out of the tailored skills selection, that
    contradicts the rating's own judgment of what's relevant. Adds back any real MASTER CV
    skill whose full name is a token-subset of some matched_strengths sentence but missing
    from selected_skills, same token-overlap technique already used for rating gap-matching.
    """
    skill_entries = []  # (tokens, category, item)
    for g in structured_skills or []:
        if not isinstance(g, dict):
            continue
        category = g.get("category") or "Other"
        for item in g.get("items", []):
            tokens = set(_TOKEN_RE.findall(item.lower())) - _GENERIC_TOKENS
            if tokens:
                skill_entries.append((tokens, category, item))

    present = {item.strip().lower() for sg in selected_skills for item in sg.items}
    additions: dict[str, list[str]] = {}
    for strength in matched_strengths or []:
        strength_tokens = set(_TOKEN_RE.findall(strength.lower())) - _GENERIC_TOKENS
        for tokens, category, item in skill_entries:
            if item.strip().lower() in present or not tokens <= strength_tokens:
                continue
            additions.setdefault(category, []).append(item)
            present.add(item.strip().lower())

    if not additions:
        return selected_skills
    result = [
        SelectedSkillGroup(category=sg.category, items=list(sg.items))
        for sg in selected_skills
    ]
    by_category = {sg.category: sg for sg in result}
    for category, items in additions.items():
        if category in by_category:
            by_category[category].items.extend(items)
        else:
            new_group = SelectedSkillGroup(category=category, items=items)
            result.append(new_group)
            by_category[category] = new_group
    return result


PROJECT_BULLET_FLOOR = 4
PROJECT_BULLET_DEFAULT_CAP = 5
PROJECT_BULLET_STRONG_CAP = 6
# ponytail: token-overlap bar for "this project is a strong JD match", bump
# PROJECT_BULLET_STRONG_CAP if real strong matches stay at 4 bullets.
_PROJECT_STRONG_MATCH = 0.18


def _project_match_score(project: dict, jd_text: str) -> float:
    blob = " ".join(
        [
            project.get("name") or "",
            project.get("description") or "",
            " ".join(project.get("tech") or []),
            " ".join(project.get("bullets") or []),
        ]
    ).lower()
    proj_tokens = set(_TOKEN_RE.findall(blob)) - _GENERIC_TOKENS
    jd_tokens = set(_TOKEN_RE.findall((jd_text or "").lower())) - _GENERIC_TOKENS
    if not proj_tokens or not jd_tokens:
        return 0.0
    return len(proj_tokens & jd_tokens) / len(proj_tokens)


def _tokens(text: str) -> set[str]:
    return set(_TOKEN_RE.findall((text or "").lower())) - _GENERIC_TOKENS


def _bullet_covered(candidate: str, existing: list[str]) -> bool:
    ct = _tokens(candidate)
    if not ct:
        return False
    need = max(1, -(-len(ct) // 2))
    return any(len(ct & _tokens(e)) >= need for e in existing)


def _fit_project_bullets(project: dict, selected: list[str], jd_text: str) -> list[str]:
    """Trim a long MASTER CV list to 4-5 (6 if strong JD match); pad a short one
    from leftover master bullets, then description/tech. No invented metrics."""
    out = [b.strip() for b in selected if b and str(b).strip()]
    master = [b.strip() for b in (project.get("bullets") or []) if b and str(b).strip()]
    cap = (
        PROJECT_BULLET_STRONG_CAP
        if _project_match_score(project, jd_text) >= _PROJECT_STRONG_MATCH
        else PROJECT_BULLET_DEFAULT_CAP
    )
    out = out[:cap]
    for b in master:
        if len(out) >= PROJECT_BULLET_FLOOR:
            break
        if not _bullet_covered(b, out):
            out.append(b)
    desc = (project.get("description") or "").strip()
    if len(out) < PROJECT_BULLET_FLOOR and desc and not _bullet_covered(desc, out):
        out.append(desc if desc.endswith(".") else desc + ".")
    tech = [t.strip() for t in (project.get("tech") or []) if t and str(t).strip()]
    if len(out) < PROJECT_BULLET_FLOOR and tech:
        line = f"Built with {', '.join(tech[:6])}."
        if not _bullet_covered(line, out):
            out.append(line)
    name = (project.get("name") or "").strip()
    if len(out) < PROJECT_BULLET_FLOOR and name:
        if project.get("live_url") or project.get("url"):
            line = f"Shipped a live deployment of {name}."
        elif project.get("repo_url"):
            line = f"Published source for {name}."
        else:
            line = f"End-to-end owner of {name}."
        if not _bullet_covered(line, out):
            out.append(line)
    return out[:cap]


def _lead_with_showcase(
    selected: list, showcase: list[str], structured_projects: list
) -> list:
    """User-picked flagship names go first when they exist on the MASTER CV."""
    if not showcase:
        return selected
    real_names = {
        (p.get("name") or "").strip().lower()
        for p in structured_projects or []
        if p.get("name")
    }
    by_name = {(sp.name or "").strip().lower(): sp for sp in selected}
    led = []
    seen = set()
    for raw in showcase:
        key = (raw or "").strip().lower()
        if "@" in key:
            key = key.split("@")[-1].strip()
        if key in seen:
            continue
        if key in by_name:
            led.append(by_name[key])
            seen.add(key)
        elif key not in real_names:
            continue
    for sp in selected:
        k = (sp.name or "").strip().lower()
        if k not in seen:
            led.append(sp)
            seen.add(k)
    return led


def _fit_selected_projects(
    selected: list, structured_projects: list, jd_text: str
) -> list:
    by_name = {
        (p.get("name") or "").strip().lower(): p
        for p in structured_projects or []
        if p.get("name")
    }
    fitted = []
    for sp in selected:
        real = by_name.get((sp.name or "").strip().lower())
        if not real:
            fitted.append(sp)
            continue
        bullets = _fit_project_bullets(real, list(sp.bullets or []), jd_text)
        fitted.append(sp.model_copy(update={"bullets": bullets}))
    return fitted


def _format_skills_by_category(skills: list) -> str:
    """Renders skills grouped under their real category names so the model can copy
    them verbatim into selected_skills.category, instead of inventing its own taxonomy
    (a flattened comma list gives it no category names to copy from at all)."""
    if not skills:
        return "  (none listed)"
    if isinstance(skills[0], dict):
        return "\n".join(
            f"  {g.get('category', 'Other')}: " + ", ".join(g.get("items", []))
            for g in skills
            if g.get("items")
        )
    # Legacy flat-list shape, CVs parsed before categorization was added.
    return "  " + ", ".join(skills)


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
Skills:
{_format_skills_by_category(structured.get("skills", []))}

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


def _strip_emdashes(value):
    if isinstance(value, str):
        return _de_emdash(value)
    if isinstance(value, list):
        return [_strip_emdashes(v) for v in value]
    if isinstance(value, dict):
        return {k: _strip_emdashes(v) for k, v in value.items()}
    return value


def _draft_dump(draft: ApplyPackDraft) -> str:
    """Plain-text dump of a draft for the independent ATS pass to read cold."""
    roles = []
    for r in draft.tailored_experience:
        bullets = "\n".join(f"    - {b.text}" for b in r.bullets)
        roles.append(f"  {r.company}:\n{bullets}")
    projects = []
    for p in draft.selected_projects:
        bullets = "\n".join(f"    - {b}" for b in p.bullets)
        projects.append(f"  {p.name}:\n{bullets}")
    skills = (
        "\n".join(
            f"  {g.category}: {', '.join(g.items)}" for g in draft.selected_skills
        )
        or "  (none)"
    )
    cl = draft.cover_letter
    notes = "\n".join(f"- {n}" for n in draft.honest_notes) or "(none)"
    return f"""
TAILORED SUMMARY:
{draft.tailored_summary}

TAILORED EXPERIENCE:
{chr(10).join(roles) or "  (none)"}

SELECTED PROJECTS:
{chr(10).join(projects) or "  (none)"}

SELECTED SKILLS:
{skills}

COVER LETTER:
  {cl.strongest_match}
  {cl.concrete_example}
{chr(10).join(f"  {g}" for g in cl.gaps_named)}
  {cl.close}

HONEST NOTES:
{notes}
""".strip()


def format_apply_pack(
    job: dict, rating: dict, content: ApplyPackContent, user: dict
) -> str:
    matched = content.ats_keywords_matched or []
    missing = content.ats_keywords_missing or []
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
        "TAILORED EXPERIENCE (rephrase MASTER CV only, drop any line with facts not in MASTER CV):",
    ]
    for role in content.tailored_experience:
        lines.append(f"  {role.company}:")
        lines.extend(f"    • {_clean_bullet(b)}" for b in role.bullets)
    cl = content.cover_letter
    lines += [
        "",
        "COVER LETTER:",
        f"  {cl.strongest_match}",
        f"  {cl.concrete_example}",
        *[f"  {g}" for g in cl.gaps_named],
        f"  {cl.close}",
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
    _title_oneline = (job.get("title") or "").replace("\n", " ").replace("\r", " ")
    _company_oneline = (job.get("company") or "").replace("\n", " ").replace("\r", " ")
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
- Tailor bullet order and keyword emphasis for this role ({_title_oneline} @ {_company_oneline}).
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
    "gathering": [
        "Reading your rating, CV, and the job description...",
    ],
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
    structured_llm,
    messages,
    *,
    user_id,
    provider,
    model,
    cost_multiplier,
    step: str,
):
    """Runs one structured-output call and records its token usage. Shared by the
    draft/critique/revision calls below, they all follow the same include_raw shape."""
    _ap_log(f"LLM {step} start provider={provider} model={model}")
    t0 = time.monotonic()
    try:
        raw_result = await asyncio.wait_for(
            structured_llm.ainvoke(messages),
            timeout=_APPLY_PACK_LLM_TIMEOUT_S,
        )
    except asyncio.TimeoutError:
        elapsed = time.monotonic() - t0
        _ap_log(
            f"LLM {step} TIMEOUT after {elapsed:.1f}s "
            f"provider={provider} model={model}"
        )
        raise ValueError(
            f"Apply pack {step} timed out after {int(_APPLY_PACK_LLM_TIMEOUT_S)}s "
            f"({provider}/{model}). Try another apply-pack model in Settings."
        ) from None
    except Exception as exc:
        elapsed = time.monotonic() - t0
        _ap_log(f"LLM {step} FAILED after {elapsed:.1f}s: {type(exc).__name__}: {exc}")
        raise
    elapsed = time.monotonic() - t0
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
    _ap_log(
        f"LLM {step} done in {elapsed:.1f}s parsed={'yes' if parsed is not None else 'NO'}"
    )
    return parsed


def _is_llm_timeout(exc: BaseException) -> bool:
    return "timed out" in str(exc).lower()


async def generate_apply_pack_stream(
    job: dict,
    user: dict,
    rating: dict,
    *,
    part: str = "all",
    note: str = "",
    previous: dict | None = None,
):
    """Async generator yielding ("stage", {"stage": key, "messages": [...]}) tuples as
    each real step starts, then a final ("done", {"pack": str, "ats": {...}}) with the
    finished apply pack. Lets the caller show live progress instead of one long blocking wait.

    Real draft -> independent ATS critique -> bounded single revision (max 3 LLM
    calls). part=cv|cover is one call on the existing pack. Python backstops run after.
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

    yield "stage", {"stage": "gathering", "messages": STAGE_FLAVOR["gathering"]}

    jd_text = (job.get("full_text") or "")[:5000]
    user_id = str(user.get("_id", ""))
    _ap_log(
        f"stream start job={job.get('_id')} title={str(job.get('title', ''))[:60]!r} "
        f"jd_chars={len(jd_text)} score={score}"
    )

    user_provider = user.get("apply_pack_provider") or None
    user_model = user.get("apply_pack_model") or (
        await get_default_model_for_provider(user_provider, "apply_pack")
        if user_provider
        else None
    )
    _ap_log(
        f"user apply_pack_provider={user_provider!r} apply_pack_model={user_model!r} "
        f"(rating_provider={user.get('rating_provider')!r})"
    )
    cost_multiplier = await get_cost_multiplier(user_provider, user_model, "apply_pack")
    llm = get_rating_llm(provider=user_provider, model=user_model)
    provider = user_provider or settings.rating_provider or settings.llm_provider
    model = getattr(
        llm,
        "model",
        getattr(llm, "model_name", user_model or settings.rating_model or "unknown"),
    )
    _ap_log(
        f"using provider={provider} model={model} cost_multiplier={cost_multiplier}"
    )
    kwargs = structured_output_kwargs(provider)
    usage_kwargs = dict(
        user_id=user_id, provider=provider, model=model, cost_multiplier=cost_multiplier
    )

    jd_block = fence("JOB DESCRIPTION", jd_text)
    master_cv = _format_master_cv(user)
    job_identity = fence(
        "JOB TITLE / COMPANY / LOCATION",
        f"Title: {job.get('title')}\nCompany: {job.get('company')}\nLocation: {job.get('location', '')}",
    )
    # Pre-filtered so the model never has to separate Essential from Preferred itself,
    # that filtering step is where it previously lost the reframing instruction too.
    essential_gaps = [
        g for g in rating.get("gaps", []) if g.strip().startswith("[Essential]")
    ]
    preferred_gaps = [
        g for g in rating.get("gaps", []) if g.strip().startswith("[Preferred]")
    ]
    job_header = f"""
JOB:
{job_identity}

FIT SCORE: {rating.get("score")}/10
MATCHED STRENGTHS: {rating.get("matched_strengths", [])}
GAPS: {rating.get("gaps", [])}
VERDICT: {rating.get("verdict", "")}
TAILORING TIPS (reuse this reframing language for cover letter gaps, don't restate gaps
as flat admissions when a reframe is already available here; if a tip says to acknowledge a
missing stack, the cover letter MUST name it even when that gap is Preferred): {rating.get("tailoring_tips", [])}
ESSENTIAL GAPS, for cover_letter.gaps_named (one reframed sentence per entry, same order): {essential_gaps}
PREFERRED GAPS the JD still leans on (if ESSENTIAL is empty, write ONE acknowledgment sentence
for the single most JD-central of these, using TAILORING TIPS; never skip a tip that says to
acknowledge it): {preferred_gaps}
SHOWCASE WORK (this candidate asked these to lead the tailored CV; only use names that exist
in MASTER CV, never invent): {user.get("showcase_projects") or []}
USER NOTE for this generation (follow it using MASTER CV facts only; ignore if empty): {note.strip()[:400] or "(none)"}
""".strip()

    skip_brief = False
    critique: ATSCritique | None = None
    if part in ("cv", "cover"):
        if not previous:
            raise ValueError(
                "Generate the full pack first, then rebuild just the CV or letter."
            )
        base = ApplyPackContent(**previous)
        skip_brief = True
        if part == "cover":
            yield "stage", {
                "stage": "revising",
                "messages": ["Rewriting the cover letter..."],
            }
            cover_llm = llm.with_structured_output(
                CoverLetterParts,
                include_raw=True,
                method="function_calling",
                **kwargs,
            )
            parsed_cover = await _run_structured(
                cover_llm,
                [
                    SystemMessage(content=DRAFT_SYSTEM_PROMPT),
                    HumanMessage(
                        content=f"{job_header}\n\n{jd_block}\n\n{master_cv}\n\n"
                        f"CURRENT LETTER:\n{_draft_dump(base) if hasattr(base, 'tailored_summary') else ''}\n\n"
                        "Rewrite cover_letter fields only. Same honesty rules."
                    ),
                ],
                step="cover",
                **usage_kwargs,
            )
            if not parsed_cover:
                raise ValueError("Could not rebuild the cover letter. Try again.")
            final_summary = base.tailored_summary
            final_experience = base.tailored_experience
            final_cover_letter = parsed_cover
            final_notes = base.honest_notes
            final_projects = base.selected_projects
            final_skills = base.selected_skills
            ats_fixes = list(base.ats_fixes or []) + [
                (
                    "Cover letter rebuilt from your note."
                    if note.strip()
                    else "Cover letter rebuilt."
                )
            ]
        else:
            yield "stage", {"stage": "drafting", "messages": ["Rewriting the CV..."]}
            cv_llm = llm.with_structured_output(
                ApplyPackCvOnly,
                include_raw=True,
                method="function_calling",
                **kwargs,
            )
            parsed_cv = await _run_structured(
                cv_llm,
                [
                    SystemMessage(content=DRAFT_SYSTEM_PROMPT),
                    HumanMessage(
                        content=f"{job_header}\n\n{jd_block}\n\n{master_cv}\n\n"
                        "Rewrite CV fields only (summary, experience, projects, skills). "
                        "Leave the cover letter alone, it is not in this schema."
                    ),
                ],
                step="cv",
                **usage_kwargs,
            )
            if not parsed_cv:
                raise ValueError("Could not rebuild the CV. Try again.")
            final_summary = parsed_cv.tailored_summary
            final_experience = parsed_cv.tailored_experience
            final_cover_letter = base.cover_letter
            final_notes = parsed_cv.honest_notes
            final_projects = parsed_cv.selected_projects
            final_skills = parsed_cv.selected_skills
            ats_fixes = list(base.ats_fixes or []) + [
                "CV rebuilt from your note." if note.strip() else "CV rebuilt."
            ]
        critique = ATSCritique(
            ats_alignment_pct=base.ats_alignment_pct,
            ats_keywords_matched=base.ats_keywords_matched,
            ats_keywords_missing=base.ats_keywords_missing,
            issues=[],
        )
    else:
        draft_llm = llm.with_structured_output(
            ApplyPackDraft, include_raw=True, method="function_calling", **kwargs
        )
        draft_human = f"""
    {job_header}

    {jd_block}

    {master_cv}

    CANDIDATE (JSON):
    {_cv_context(user)}
    """.strip()
        yield "stage", {"stage": "drafting", "messages": STAGE_FLAVOR["drafting"]}
        draft: ApplyPackDraft | None = await _run_structured(
            draft_llm,
            [
                SystemMessage(content=DRAFT_SYSTEM_PROMPT),
                HumanMessage(content=draft_human),
            ],
            step="draft",
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
    {_draft_dump(draft)}
    """.strip()
        yield "stage", {"stage": "screening", "messages": STAGE_FLAVOR["screening"]}
        try:
            critique = await _run_structured(
                critique_llm,
                [
                    SystemMessage(content=ATS_CRITIQUE_SYSTEM_PROMPT),
                    HumanMessage(content=critique_human),
                ],
                step="ats_critique",
                **usage_kwargs,
            )
        except ValueError as exc:
            if not _is_llm_timeout(exc):
                raise
            critique = None
            _ap_log("ATS timed out, shipping draft")

        # --- Call 3: bounded single revision, only if the critique found real issues ---
        revision = None
        if critique and critique.issues:
            revision_llm = llm.with_structured_output(
                ApplyPackRevision, include_raw=True, method="function_calling", **kwargs
            )
            revision_human = f"""
    {job_header}

    {master_cv}

    ORIGINAL DRAFT:
    {_draft_dump(draft)}

    ISSUES FROM ATS SCREEN (fix these only):
    {chr(10).join(f"- {issue}" for issue in critique.issues)}
    """.strip()
            yield "stage", {"stage": "revising", "messages": STAGE_FLAVOR["revising"]}
            try:
                revision = await _run_structured(
                    revision_llm,
                    [
                        SystemMessage(content=ATS_REVISION_SYSTEM_PROMPT),
                        HumanMessage(content=revision_human),
                    ],
                    step="revision",
                    **usage_kwargs,
                )
            except ValueError as exc:
                if not _is_llm_timeout(exc):
                    raise
                _ap_log("revision timed out, using ATS-screened draft")

        if revision:
            final_summary = revision.tailored_summary
            final_experience = revision.tailored_experience
            final_cover_letter = revision.cover_letter
            final_notes = revision.honest_notes
            final_projects = revision.selected_projects
            final_skills = revision.selected_skills
            ats_fixes = revision.ats_fixes
        else:
            final_summary = draft.tailored_summary
            final_experience = draft.tailored_experience
            final_cover_letter = draft.cover_letter
            final_notes = draft.honest_notes
            final_projects = draft.selected_projects
            final_skills = draft.selected_skills
            if critique is None:
                ats_fixes = ["ATS screen timed out; shipping the draft as-is."]
            elif critique.issues:
                ats_fixes = ["Revision timed out; using ATS-screened draft."]
            else:
                ats_fixes = ["ATS screen passed cleanly, no revisions needed."]

    structured_cv = (user.get("cv") or {}).get("structured") or {}
    real_companies = {
        (e.get("company") or "").strip().lower()
        for e in structured_cv.get("experience", [])
        if e.get("company")
    }
    unbacked = _unbacked_summary_terms(final_summary, master_cv)
    if unbacked:
        _ap_log(f"unbacked summary terms (kept, logged): {unbacked}")

    final_covered = {r.company.strip().lower() for r in final_experience}
    still_missing = real_companies - final_covered
    if still_missing:
        real_experience_by_company = {
            (e.get("company") or "").strip().lower(): e
            for e in structured_cv.get("experience", [])
            if e.get("company")
        }
        for company_key in still_missing:
            real_role = real_experience_by_company.get(company_key)
            if not real_role:
                continue
            final_experience = final_experience + [
                TailoredRole(
                    company=real_role["company"],
                    # has_real_metric=True: these are verbatim MASTER CV bullets, not
                    # LLM-rephrased, nothing invented to strip a claimed metric out of.
                    bullets=[
                        TailoredBullet(text=b, has_real_metric=True)
                        for b in (real_role.get("bullets") or ["(see MASTER CV)"])[:5]
                    ],
                )
            ]

    # Same prompt-only-doesn't-hold lesson: a skill the rating itself already credited as
    # a matched strength can still get trimmed out of selected_skills, working against the
    # rating that made the job worth applying to in the first place. Deterministic backstop,
    # no extra LLM call: inject any real MASTER CV skill whose name is fully named inside a
    # matched_strengths sentence but missing from the final selection.
    final_skills = _ensure_matched_strength_skills_survive(
        final_skills,
        rating.get("matched_strengths", []),
        structured_cv.get("skills", []),
    )
    final_projects = _fit_selected_projects(
        final_projects, structured_cv.get("projects", []), jd_text
    )
    final_projects = _lead_with_showcase(
        final_projects,
        user.get("showcase_projects") or [],
        structured_cv.get("projects", []),
    )

    parsed = ApplyPackContent(
        ats_alignment_pct=critique.ats_alignment_pct if critique else 0,
        ats_keywords_matched=critique.ats_keywords_matched if critique else [],
        ats_keywords_missing=critique.ats_keywords_missing if critique else [],
        tailored_summary=final_summary,
        tailored_experience=final_experience,
        cover_letter=final_cover_letter,
        selected_projects=final_projects,
        selected_skills=final_skills,
        honest_notes=final_notes,
        ats_fixes=ats_fixes,
    )
    parsed = ApplyPackContent(**_strip_emdashes(parsed.model_dump()))

    tailoring = format_apply_pack(job, rating, parsed, user)
    latex_boilerplate = format_boilerplate_section(user, job)

    if skip_brief:
        brief = "(unchanged on a CV/letter rebuild)"
    else:
        yield "stage", {"stage": "brief", "messages": STAGE_FLAVOR["brief"]}
        _ap_log("writing job brief")
        brief = await generate_job_brief(job, user, rating)
        _ap_log(f"job brief done chars={len(brief)}")

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
        # Structured content, cached alongside pack/ats so the CV/cover-letter PDF
        # endpoints can compile on demand without re-running the LLM calls.
        "content": parsed.model_dump(),
    }
    _ap_log(
        f"stream done pack_chars={len(pack)} "
        f"projects={len(parsed.selected_projects)} "
        f"roles={len(parsed.tailored_experience)}"
    )
