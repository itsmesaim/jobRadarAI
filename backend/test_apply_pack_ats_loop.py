"""
Offline check for the apply-pack draft -> ATS critique -> bounded revision loop.

Monkeypatches _run_structured so it runs without network access.
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
USER = {
    "_id": "u1",
    "cv": {
        "structured": {
            "experience": [
                {"company": "Acme", "title": "Engineer", "bullets": ["Did X"]}
            ],
            "projects": [
                {"name": "Proj0", "bullets": ["a", "b", "c", "d"]},
                {"name": "Proj1", "bullets": ["a", "b", "c", "d"]},
                {"name": "Proj2", "bullets": ["a", "b", "c", "d"]},
            ],
        }
    },
    "about_me": "",
}
RATING = {
    "score": 8,
    "matched_strengths": [],
    "gaps": ["[Essential] gap1"],
    "verdict": "",
}


def _cover_letter(n=1):
    return ap.CoverLetterParts(
        strongest_match="Strong match.",
        concrete_example="Example.",
        gaps_named=["Gap."] * n,
        close="Close.",
    )


def _draft(n_projects: int, extra_company: str | None = None) -> ap.ApplyPackDraft:
    roles = [
        ap.TailoredRole(
            company="Acme",
            bullets=[ap.TailoredBullet(text="Did X", has_real_metric=False)],
        )
    ]
    if extra_company:
        roles.append(
            ap.TailoredRole(
                company=extra_company,
                bullets=[ap.TailoredBullet(text="Did Y", has_real_metric=False)],
            )
        )
    return ap.ApplyPackDraft(
        tailored_summary="A tailored summary.",
        tailored_experience=roles,
        cover_letter=_cover_letter(),
        honest_notes=[],
        selected_projects=[
            ap.SelectedProject(name=f"Proj{i}", bullets=["Did Y", "Did Y2", "Did Y3"])
            for i in range(n_projects)
        ],
        selected_skills=[ap.SelectedSkillGroup(category="Backend", items=["Python"])],
    )


async def _run(user=USER, n_projects=3, critique_issues=None, timeout_on=None):
    if critique_issues is None:
        critique_issues = []
    draft = _draft(n_projects)
    critique = ap.ATSCritique(
        ats_alignment_pct=70,
        ats_keywords_matched=["Python"],
        ats_keywords_missing=["Kubernetes"] if critique_issues else [],
        issues=critique_issues,
    )
    dumped = draft.model_dump()
    dumped["tailored_summary"] = "A revised summary."
    revision = ap.ApplyPackRevision(
        **dumped,
        ats_fixes=["Missing 'Kubernetes': added, appears in Skills."],
    )
    calls = {"n": 0}

    async def fake_run_structured(structured_llm, messages, **kwargs):
        calls["n"] += 1
        step = kwargs.get("step")
        if timeout_on and step == timeout_on:
            raise ValueError(f"Apply pack {step} timed out after 300s (test).")
        if calls["n"] == 1:
            return draft
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
        async for kind, payload in ap.generate_apply_pack_stream(JOB, user, RATING):
            if kind == "stage":
                stages.append(payload["stage"])
            else:
                result = payload
    return stages, result, calls["n"]


async def main():
    stages, result, n_calls = await _run(
        critique_issues=["Missing 'Kubernetes' (Essential)"]
    )
    assert "revising" in stages, stages
    assert n_calls == 3, n_calls
    assert result["ats"]["fixes"] == ["Missing 'Kubernetes': added, appears in Skills."]
    assert result["ats"]["alignment_pct"] == 70
    assert "Did X" in result["pack"]
    assert result["content"]["tailored_summary"] == "A revised summary."

    stages, result, n_calls = await _run(critique_issues=[])
    assert "revising" not in stages, stages
    assert n_calls == 2, n_calls
    assert result["ats"]["fixes"] == ["ATS screen passed cleanly, no revisions needed."]
    assert result["content"]["selected_projects"]

    missing_role_user = {
        **USER,
        "cv": {
            "structured": {
                "experience": [
                    {"company": "Acme", "title": "Engineer", "bullets": ["Did X"]},
                    {"company": "OtherCo", "title": "Dev", "bullets": ["Did Z"]},
                ],
                "projects": USER["cv"]["structured"]["projects"],
            }
        },
    }
    _, result, n_calls = await _run(user=missing_role_user, critique_issues=[])
    assert n_calls == 2
    companies = {r["company"] for r in result["content"]["tailored_experience"]}
    assert "OtherCo" in companies, companies

    thin = {
        "name": "LearnOS",
        "description": "Quiz platform for students with login and scoring.",
        "tech": ["React", "FastAPI", "PostgreSQL"],
        "bullets": ["Shipped a live quiz site used by classmates."],
    }
    padded = ap._fit_project_bullets(
        thin, ["Shipped a live quiz site used by classmates."], "FastAPI React backend"
    )
    assert len(padded) >= 4, padded

    led = ap._lead_with_showcase(
        [
            ap.SelectedProject(name="Other", bullets=["a"]),
            ap.SelectedProject(name="Flagship", bullets=["b"]),
        ],
        ["Flagship"],
        [{"name": "Flagship"}, {"name": "Other"}],
    )
    assert [p.name for p in led] == ["Flagship", "Other"]

    from services.cv_latex_boilerplate import assemble_cover_letter_tex, _de_emdash

    assert "\u2014" not in _de_emdash("Shipped agents \u2014 including JobRadar.")
    assert _de_emdash("Shipped agents \u2014 including JobRadar.") == (
        "Shipped agents, including JobRadar."
    )

    tex = assemble_cover_letter_tex(USER, JOB, ap.ApplyPackContent(**result["content"]))
    assert "Strong match.\n\nExample." in tex
    assert "Strong match. Example." not in tex

    _, result, n_calls = await _run(
        critique_issues=["Missing 'Kubernetes' (Essential)"],
        timeout_on="revision",
    )
    assert n_calls == 3
    assert result["ats"]["fixes"] == ["Revision timed out; using ATS-screened draft."]
    assert result["content"]["tailored_summary"] == "A tailored summary."

    _, result, n_calls = await _run(timeout_on="ats_critique")
    assert n_calls == 2
    assert result["ats"]["fixes"] == ["ATS screen timed out; shipping the draft as-is."]
    assert result["pack"]

    print("ok: apply-pack draft/critique/revision loop")


if __name__ == "__main__":
    asyncio.run(main())
