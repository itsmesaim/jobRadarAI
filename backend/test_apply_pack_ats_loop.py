"""
Offline check for the apply-pack draft -> ATS critique -> bounded revision loop in
services/apply_pack.py. Monkeypatches the LLM-calling seam (_run_structured) with canned
responses so it runs without network access, and asserts:
  1. a critique with issues triggers exactly one "revising" stage + revision call, and
     the final ats_fixes come from the revision output.
  2. a clean critique (no issues) skips the revision call entirely and falls back to the
     "passed cleanly" ats_fixes message.

Run manually with: python test_apply_pack_ats_loop.py
"""

import asyncio
from unittest.mock import AsyncMock, patch

import services.apply_pack as ap

JOB = {
    "title": "Backend Engineer",
    "company": "Acme",
    "location": "Remote",
    "full_text": "x" * 200,
}
USER = {"_id": "u1", "cv": {"structured": {}}, "about_me": ""}
RATING = {"score": 8, "matched_strengths": [], "gaps": [], "verdict": ""}

DRAFT = ap.ApplyPackDraft(
    xyz_bullets=["Did X"], cover_opener="Opener.", honest_notes=[]
)


async def _run(critique_issues):
    critique = ap.ATSCritique(
        ats_alignment_pct=70,
        ats_keywords_matched=["Python"],
        ats_keywords_missing=["Kubernetes"] if critique_issues else [],
        issues=critique_issues,
    )
    revision = ap.ApplyPackRevision(
        xyz_bullets=["Did X (revised)"],
        cover_opener="Opener revised.",
        honest_notes=[],
        ats_fixes=["Missing 'Kubernetes': added, appears in Skills."],
    )
    calls = {"n": 0}

    async def fake_run_structured(structured_llm, messages, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return DRAFT
        if calls["n"] == 2:
            return critique
        return revision

    stages = []

    with (
        patch.object(ap, "_run_structured", side_effect=fake_run_structured),
        patch.object(
            ap,
            "get_rating_llm",
            return_value=AsyncMock(with_structured_output=lambda *a, **k: None),
        ),
        patch.object(ap, "get_cost_multiplier", new=AsyncMock(return_value=1.0)),
        patch.object(
            ap,
            "get_default_model_for_provider",
            new=AsyncMock(return_value="test-model"),
        ),
        patch.object(ap, "generate_job_brief", new=AsyncMock(return_value="BRIEF")),
        patch.object(
            ap, "format_boilerplate_section", return_value="LATEX BOILERPLATE"
        ),
        patch.object(ap, "structured_output_kwargs", return_value={}),
    ):
        result = None
        async for kind, payload in ap.generate_apply_pack_stream(JOB, USER, RATING):
            if kind == "stage":
                stages.append(payload["stage"])
            else:
                result = payload
    return stages, result, calls["n"]


async def main():
    # Case 1: critique finds real issues -> revision call runs, real ats_fixes used.
    stages, result, n_calls = await _run(["Missing 'Kubernetes' (Essential)"])
    assert "revising" in stages, f"expected a revising stage, got {stages}"
    assert n_calls == 3, f"expected draft+critique+revision = 3 calls, got {n_calls}"
    assert result["ats"]["fixes"] == ["Missing 'Kubernetes': added, appears in Skills."]
    assert result["ats"]["alignment_pct"] == 70
    # latex_snippet must be a direct rendering of the (revised) xyz_bullets, not
    # independently generated, regression check for the "bare job titles" bug.
    assert "\\item Did X (revised)" in result["pack"], result["pack"]

    # Case 2: clean critique -> no revision call, fallback ats_fixes message.
    stages, result, n_calls = await _run([])
    assert "revising" not in stages, f"expected no revising stage, got {stages}"
    assert n_calls == 2, f"expected draft+critique only = 2 calls, got {n_calls}"
    assert result["ats"]["fixes"] == ["ATS screen passed cleanly, no revisions needed."]
    assert "\\item Did X" in result["pack"], result["pack"]

    print("ok: apply-pack draft/critique/revision loop behaves as expected")


if __name__ == "__main__":
    asyncio.run(main())
