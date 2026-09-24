"""LangGraph apply-pack pipeline: draft -> ATS -> revise? -> humanize (stub).

Node names are the stage ids the UI / future job-chat left rail will show.
# ponytail: humanize is a no-op until the user skill lands (Phase 4).
"""

from __future__ import annotations

from typing import Any, AsyncIterator, Literal, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph

import services.apply_pack as ap


class ApplyPackGraphState(TypedDict, total=False):
    job_header: str
    jd_block: str
    master_cv: str
    cv_context: str
    draft: dict | None
    critique: dict | None
    revision: dict | None
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
                SystemMessage(content=ap.ATS_CRITIQUE_SYSTEM_PROMPT),
                HumanMessage(content=critique_human),
            ],
            step="ats_critique",
            **usage,
        )
    except ValueError as exc:
        if not ap._is_llm_timeout(exc):
            raise
        ap._ap_log("ATS timed out, shipping draft")
        critique = None
    return {"critique": critique.model_dump() if critique else None}


def _route_after_ats(
    state: ApplyPackGraphState,
) -> Literal["revise", "humanize"]:
    critique = state.get("critique")
    if critique and critique.get("issues"):
        return "revise"
    return "humanize"


async def revise_node(state: ApplyPackGraphState, config: RunnableConfig) -> dict:
    _emit_stage("revising")
    c = _cfg(config)
    llm = c["llm"]
    kwargs = c["kwargs"]
    usage = c["usage_kwargs"]
    draft = ap.ApplyPackDraft(**(state.get("draft") or {}))
    critique = state.get("critique") or {}
    issues = critique.get("issues") or []
    revision_llm = llm.with_structured_output(
        ap.ApplyPackRevision, include_raw=True, method="function_calling", **kwargs
    )
    revision_human = f"""
    {state["job_header"]}

    {state["master_cv"]}

    ORIGINAL DRAFT:
    {ap._draft_dump(draft)}

    ISSUES FROM ATS SCREEN (fix these only):
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


async def humanize_node(state: ApplyPackGraphState, config: RunnableConfig) -> dict:
    """Stub: pass through. Real humanizer skill wires in here later."""
    _emit_stage("humanize")
    draft = ap.ApplyPackDraft(**(state.get("draft") or {}))
    critique = state.get("critique")
    revision = state.get("revision")
    if revision:
        rev = ap.ApplyPackRevision(**revision)
        return {
            "final_summary": rev.tailored_summary,
            "final_experience": [r.model_dump() for r in rev.tailored_experience],
            "final_cover_letter": rev.cover_letter.model_dump(),
            "final_notes": list(rev.honest_notes),
            "final_projects": [p.model_dump() for p in rev.selected_projects],
            "final_skills": [s.model_dump() for s in rev.selected_skills],
            "ats_fixes": list(rev.ats_fixes),
            "ats_alignment_pct": (critique or {}).get("ats_alignment_pct", 0),
            "ats_keywords_matched": list(
                (critique or {}).get("ats_keywords_matched") or []
            ),
            "ats_keywords_missing": list(
                (critique or {}).get("ats_keywords_missing") or []
            ),
        }
    if critique is None:
        ats_fixes = ["ATS screen timed out; shipping the draft as-is."]
    elif critique.get("issues"):
        ats_fixes = ["Revision timed out; using ATS-screened draft."]
    else:
        ats_fixes = ["ATS screen passed cleanly, no revisions needed."]
    # ponytail: humanize stage is a no-op pass-through until Phase 4 skill.
    return {
        "final_summary": draft.tailored_summary,
        "final_experience": [r.model_dump() for r in draft.tailored_experience],
        "final_cover_letter": draft.cover_letter.model_dump(),
        "final_notes": list(draft.honest_notes),
        "final_projects": [p.model_dump() for p in draft.selected_projects],
        "final_skills": [s.model_dump() for s in draft.selected_skills],
        "ats_fixes": ats_fixes,
        "ats_alignment_pct": (
            (critique or {}).get("ats_alignment_pct", 0) if critique else 0
        ),
        "ats_keywords_matched": (
            list((critique or {}).get("ats_keywords_matched") or []) if critique else []
        ),
        "ats_keywords_missing": (
            list((critique or {}).get("ats_keywords_missing") or []) if critique else []
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
