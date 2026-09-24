"""LangGraph apply-pack pipeline: draft -> ATS -> revise? -> humanize.

Node names are the stage ids the UI left rail shows.
"""

from __future__ import annotations

from typing import Any, AsyncIterator, Literal, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

import services.apply_pack as ap
from services.apply_pack_backstops import humanizer_integrity_failures, split_ats_issues
from services.prompt_safety import fence
from services.skill_prompts import ats_system_prompt, humanizer_system_prompt


class ApplyPackGraphState(TypedDict, total=False):
    job_header: str
    jd_block: str
    master_cv: str
    cv_context: str
    draft: dict | None
    critique: dict | None
    revision: dict | None
    revise_issues: list
    humanizer_brief: list
    user_questions: list
    ats_unaudited: bool
    humanizer_reverted: bool
    humanizer_fallback: str  # "" | "integrity" | "timeout"
    final_summary: str
    final_experience: list
    final_cover_letter: dict
    final_notes: list
    final_projects: list
    final_skills: list
    ats_fixes: list
    ats_alignment_pct: int
    ats_keywords_matched: list
    ats_keywords_missing: list


def _cfg(config: RunnableConfig) -> dict:
    return dict(config.get("configurable") or {})


def _emit_stage(stage: str) -> None:
    writer = get_stream_writer()
    writer(
        {
            "stage": stage,
            "messages": list(ap.STAGE_FLAVOR.get(stage, [stage])),
        }
    )


async def draft_node(state: ApplyPackGraphState, config: RunnableConfig) -> dict:
    _emit_stage("drafting")
    c = _cfg(config)
    llm = c["llm"]
    kwargs = c["kwargs"]
    usage = c["usage_kwargs"]
    draft_llm = llm.with_structured_output(
        ap.ApplyPackDraft, include_raw=True, method="function_calling", **kwargs
    )
    draft_human = f"""
    {state["job_header"]}

    {state["jd_block"]}

    {state["master_cv"]}

    CANDIDATE (JSON):
    {state["cv_context"]}
    """.strip()
    draft = await ap._run_structured(
        draft_llm,
        [
            SystemMessage(content=ap.DRAFT_SYSTEM_PROMPT),
            HumanMessage(content=draft_human),
        ],
        step="draft",
        **usage,
    )
    if not draft:
        raise ValueError("Could not generate apply pack. Try again.")
    return {"draft": draft.model_dump()}


async def ats_node(state: ApplyPackGraphState, config: RunnableConfig) -> dict:
    _emit_stage("screening")
    c = _cfg(config)
    llm = c["llm"]
    kwargs = c["kwargs"]
    usage = c["usage_kwargs"]
    draft = ap.ApplyPackDraft(**(state.get("draft") or {}))
    critique_llm = llm.with_structured_output(
        ap.ATSCritique, include_raw=True, method="function_calling", **kwargs
    )
    critique_human = f"""
    {state["job_header"]}

    {state["jd_block"]}

    {state["master_cv"]}

    DRAFT (written by a separate pass, read it cold):
    {ap._draft_dump(draft)}
    """.strip()
    try:
        critique = await ap._run_structured(
            critique_llm,
            [
                SystemMessage(content=ats_system_prompt(ap.ATS_CRITIQUE_SYSTEM_PROMPT)),
                HumanMessage(content=critique_human),
            ],
            step="ats_critique",
            **usage,
        )
    except ValueError as exc:
        if not ap._is_llm_timeout(exc):
            raise
        ap._ap_log("ATS timed out, shipping draft unaudited")
        return {
            "critique": {
                "ats_alignment_pct": 0,
                "ats_keywords_matched": [],
                "ats_keywords_missing": [],
                "issues": [],
            },
            "ats_unaudited": True,
            "revise_issues": [],
            "humanizer_brief": [],
            # Not a candidate question - system state. ats_unaudited plus the
            # "ATS screen timed out" note in humanize_node's ats_fixes already
            # covers this; putting it in user_questions duplicated it under
            # "Needs your input", conflating a system timeout with a real gap.
            "user_questions": [],
        }
    data = critique.model_dump()
    revise_i, hum_i, user_q = split_ats_issues(data.get("issues") or [])
    return {
        "critique": data,
        "ats_unaudited": False,
        "revise_issues": revise_i,
        "humanizer_brief": hum_i,
        "user_questions": user_q,
    }


def _route_after_ats(
    state: ApplyPackGraphState,
) -> Literal["revise", "humanize"]:
    if state.get("ats_unaudited"):
        return "humanize"
    if state.get("revise_issues"):
        return "revise"
    return "humanize"


async def revise_node(state: ApplyPackGraphState, config: RunnableConfig) -> dict:
    _emit_stage("revising")
    c = _cfg(config)
    llm = c["llm"]
    kwargs = c["kwargs"]
    usage = c["usage_kwargs"]
    draft = ap.ApplyPackDraft(**(state.get("draft") or {}))
    issues = state.get("revise_issues") or []
    revision_llm = llm.with_structured_output(
        ap.ApplyPackRevision, include_raw=True, method="function_calling", **kwargs
    )
    revision_human = f"""
    {state["job_header"]}

    {state["master_cv"]}

    ORIGINAL DRAFT:
    {ap._draft_dump(draft)}

    ISSUES FROM ATS SCREEN (R1/R2 only - fix these; do not invent facts):
    {chr(10).join(f"- {issue}" for issue in issues)}
    """.strip()
    try:
        revision = await ap._run_structured(
            revision_llm,
            [
                SystemMessage(content=ap.ATS_REVISION_SYSTEM_PROMPT),
                HumanMessage(content=revision_human),
            ],
            step="revision",
            **usage,
        )
    except ValueError as exc:
        if not ap._is_llm_timeout(exc):
            raise
        ap._ap_log("revision timed out, using ATS-screened draft")
        revision = None
    return {"revision": revision.model_dump() if revision else None}


class _HumanizerPass(BaseModel):
    """Rewrites wording only; same shape as draft body fields we ship."""

    tailored_summary: str
    tailored_experience: list[ap.TailoredRole]
    cover_letter: ap.CoverLetterParts
    still_ai_notes: list[str] = Field(default_factory=list)


async def humanize_node(state: ApplyPackGraphState, config: RunnableConfig) -> dict:
    """Resume-humanizer skill: strip AI tells, keep MASTER CV facts."""
    _emit_stage("humanize")
    draft = ap.ApplyPackDraft(**(state.get("draft") or {}))
    critique = state.get("critique") or {}
    revision = state.get("revision")
    unaudited = bool(state.get("ats_unaudited"))
    user_questions = list(state.get("user_questions") or [])
    if revision:
        base = ap.ApplyPackRevision(**revision)
        ats_fixes = list(base.ats_fixes)
        notes = list(base.honest_notes)
        projects = [p.model_dump() for p in base.selected_projects]
        skills = [s.model_dump() for s in base.selected_skills]
    else:
        base = draft
        if unaudited:
            ats_fixes = ["ATS screen timed out; pack marked unaudited."]
        elif state.get("revise_issues"):
            ats_fixes = ["Revision skipped or timed out; shipping to humanizer."]
        else:
            ats_fixes = ["ATS screen had no R1/R2 issues."]
        notes = list(draft.honest_notes)
        projects = [p.model_dump() for p in draft.selected_projects]
        skills = [s.model_dump() for s in draft.selected_skills]

    if user_questions:
        notes = list(notes) + [f"Needs your input: {q}" for q in user_questions[:8]]

    pre = {
        "tailored_summary": base.tailored_summary,
        "tailored_experience": [
            r.model_dump() if hasattr(r, "model_dump") else r
            for r in base.tailored_experience
        ],
        "cover_letter": (
            base.cover_letter.model_dump()
            if hasattr(base.cover_letter, "model_dump")
            else base.cover_letter
        ),
    }

    c = _cfg(config)
    humanize_llm = c["llm"].with_structured_output(
        _HumanizerPass, include_raw=True, method="function_calling", **c["kwargs"]
    )
    brief = state.get("humanizer_brief") or []
    human = f"""
{fence("MASTER_CV", state.get("master_cv") or "")}

{fence("DRAFT", ap._draft_dump(base))}

BRIEF (R3 / humanizer-owned ATS items - fix wording only):
{chr(10).join(f"- {i}" for i in brief) or "- (none)"}

Rewrite summary, experience bullets, and cover letter so they sound human.
Keep every fact, metric, tool, company, and bullet count from DRAFT / MASTER_CV.
No em dashes. No invented experience. Cover letter: first person, plain gaps, specific close.
""".strip()

    polished = None
    reverted = False
    fallback = ""
    try:
        polished = await ap._run_structured(
            humanize_llm,
            [
                SystemMessage(content=humanizer_system_prompt()),
                HumanMessage(content=human),
            ],
            step="humanize",
            **c["usage_kwargs"],
        )
    except ValueError as exc:
        if not ap._is_llm_timeout(exc):
            raise
        ap._ap_log("humanize timed out, shipping prior draft")
        fallback = "timeout"
        ats_fixes = list(ats_fixes) + [
            "Humanizer timed out; shipped pre-humanize draft."
        ]
        notes = list(notes) + [
            "Humanizer fallback: timed out. Pack uses the pre-humanize draft."
        ]

    if polished:
        after = {
            "tailored_summary": polished.tailored_summary,
            "tailored_experience": [
                r.model_dump() for r in polished.tailored_experience
            ],
            "cover_letter": polished.cover_letter.model_dump(),
        }
        fails = humanizer_integrity_failures(pre, after)
        if fails:
            ap._ap_log(f"humanizer reverted: {fails[:5]}")
            polished = None
            reverted = True
            fallback = "integrity"
            ats_fixes = list(ats_fixes) + [
                "Humanizer reverted: integrity checks failed (facts/bullets/dashes). "
                "Shipped pre-humanize draft."
            ]
            notes = list(notes) + [
                "Humanizer fallback: integrity check failed. Pack uses the pre-humanize draft."
            ]
        else:
            if polished.still_ai_notes:
                notes = list(notes) + [
                    f"Humanizer note: {n}" for n in polished.still_ai_notes[:5]
                ]
            ats_fixes = list(ats_fixes) + ["Humanizer pass applied (AI-tell strip)."]

    out_base = {
        "final_notes": notes,
        "final_projects": projects,
        "final_skills": skills,
        "ats_fixes": ats_fixes,
        "ats_alignment_pct": int(critique.get("ats_alignment_pct") or 0),
        "ats_keywords_matched": list(critique.get("ats_keywords_matched") or []),
        "ats_keywords_missing": list(critique.get("ats_keywords_missing") or []),
        "humanizer_reverted": reverted,
        "humanizer_fallback": fallback,
        "user_questions": user_questions,
        "ats_unaudited": unaudited,
    }
    if polished:
        return {
            **out_base,
            "final_summary": polished.tailored_summary,
            "final_experience": [r.model_dump() for r in polished.tailored_experience],
            "final_cover_letter": polished.cover_letter.model_dump(),
        }
    return {
        **out_base,
        "final_summary": base.tailored_summary,
        "final_experience": [
            r.model_dump() if hasattr(r, "model_dump") else r
            for r in base.tailored_experience
        ],
        "final_cover_letter": (
            base.cover_letter.model_dump()
            if hasattr(base.cover_letter, "model_dump")
            else base.cover_letter
        ),
    }


def build_apply_pack_graph():
    g = StateGraph(ApplyPackGraphState)
    g.add_node("draft", draft_node)
    g.add_node("ats", ats_node)
    g.add_node("revise", revise_node)
    g.add_node("humanize", humanize_node)
    g.add_edge(START, "draft")
    g.add_edge("draft", "ats")
    g.add_conditional_edges(
        "ats",
        _route_after_ats,
        {"revise": "revise", "humanize": "humanize"},
    )
    g.add_edge("revise", "humanize")
    g.add_edge("humanize", END)
    return g.compile()


_GRAPH = None


def get_apply_pack_graph():
    global _GRAPH
    if _GRAPH is None:
        _GRAPH = build_apply_pack_graph()
    return _GRAPH


async def stream_apply_pack_graph(
    *,
    job_header: str,
    jd_block: str,
    master_cv: str,
    cv_context: str,
    llm: Any,
    kwargs: dict,
    usage_kwargs: dict,
) -> AsyncIterator[tuple[str, dict]]:
    """Yields ("stage", {...}) then ("graph_done", final_state)."""
    graph = get_apply_pack_graph()
    initial: ApplyPackGraphState = {
        "job_header": job_header,
        "jd_block": jd_block,
        "master_cv": master_cv,
        "cv_context": cv_context,
        "draft": None,
        "critique": None,
        "revision": None,
        "revise_issues": [],
        "humanizer_brief": [],
        "user_questions": [],
        "ats_unaudited": False,
        "humanizer_reverted": False,
        "humanizer_fallback": "",
    }
    config = {
        "configurable": {
            "llm": llm,
            "kwargs": kwargs,
            "usage_kwargs": usage_kwargs,
        }
    }
    final: ApplyPackGraphState | None = None
    async for mode, chunk in graph.astream(
        initial, config=config, stream_mode=["custom", "values"]
    ):
        if mode == "custom":
            yield "stage", chunk
        elif mode == "values":
            final = chunk
    if not final or not final.get("final_summary"):
        raise ValueError("Apply pack graph finished with no content.")
    yield "graph_done", dict(final)
