"""
Regression check for gap-extraction rules in services/rating.py (STEP 2.5):
dedup of one JD requirement into a single gap, source restriction to the
requirements section, and tier tagging from the JD's own heading.

Fixture: a trimmed Guidewire SDET II JD that previously caused the rating
LLM to (a) split one test-automation-framework requirement into three
separate gaps, one pulled from the responsibilities section, and (b) tag
an "Enterprise exposure to AI tools" requirement as Desirable even though
it sits directly under a "(Required)" heading.

This makes a REAL call to the configured RATING_PROVIDER — it is a live
smoke test, not deterministic/offline, so it's not wired into CI. Run
manually with: python test_rating_gaps.py
"""

import asyncio
import re

from bson import ObjectId

from database import connect_to_mongo
from services.rating import rate_job_for_user

GUIDEWIRE_JD = """
Job title: SDET II - Guidewire

What you get to do:
- Execute and contribute to the refinement of the test strategy for our
  Guidewire integrations, working closely with engineering.
- Collaborate with developers on release readiness.

Core Engineering Foundations (Required):
- Expertise in UI and API test automation frameworks (e.g. Selenium,
  Playwright, TestCafe, Cypress, Karate, RestAssured or similar).
- Enterprise exposure to AI tools (e.g. Claude, Cursor, CoPilot).
- Strong SQL and relational database fundamentals.

Preferred:
- Experience with Guidewire PolicyCenter/BillingCenter.
- Exposure to performance testing tools.
""".strip()

MASTER_CV = {
    "name": "Test Candidate",
    "summary": "QA engineer with manual testing and SQL background.",
    "skills": ["SQL", "Postgres", "Jira", "Manual testing"],
    "experience": [
        {
            "title": "QA Engineer",
            "company": "Acme Corp",
            "description": "Wrote manual test plans and SQL queries against staging DBs.",
        }
    ],
    "projects": [],
    "education": [],
}

USER = {
    "_id": ObjectId(),
    "cv": {"structured": MASTER_CV},
    "experience_level": "mid",
    "work_authorization": "",
    "work_mode": {"remote": True, "hybrid": True, "onsite": False},
}

JOB = {"_id": ObjectId(), "full_text": GUIDEWIRE_JD, "salary_text": ""}

_AUTOMATION_TOOL_RE = re.compile(
    r"selenium|playwright|testcafe|cypress|karate|restassured|test automation framework",
    re.IGNORECASE,
)


async def _run():
    await connect_to_mongo()
    return await rate_job_for_user(JOB, USER)


def demo():
    rating = asyncio.run(_run())
    gaps = rating.get("gaps", [])
    print("Gaps returned:")
    for g in gaps:
        print(f"  - {g}")

    automation_gaps = [g for g in gaps if _AUTOMATION_TOOL_RE.search(g)]
    assert len(automation_gaps) == 1, (
        f"expected exactly ONE test-automation-framework gap, got "
        f"{len(automation_gaps)}: {automation_gaps}"
    )

    ai_tools_gaps = [g for g in gaps if "ai tool" in g.lower()]
    if ai_tools_gaps:
        assert any("[essential]" in g.lower() for g in ai_tools_gaps), (
            f"AI tools requirement sits under 'Core Engineering Foundations "
            f"(Required)' in the fixture JD — expected an [Essential] tag, got: "
            f"{ai_tools_gaps}"
        )

    refinement_gaps = [
        g for g in gaps if "refinement of the test strategy" in g.lower()
    ]
    assert not refinement_gaps, (
        f"'refinement of the test strategy' is a responsibilities bullet, not a "
        f"requirement — it must not appear as a gap: {refinement_gaps}"
    )

    print("OK — one automation-framework gap, no responsibilities-sourced gap")


# ── Braiins-style fixture: gap/strength inversion + title-named language ──
#
# Reproduces a real bug report: a Rust-first JD that names TypeScript/React
# and Python as OPTIONAL exposure areas ("you may also touch ...") got those
# same skills — which the candidate already has and which the model itself
# listed as matched strengths — also listed as [Preferred] gaps. Separately,
# duplicate entries showed up verbatim in matched_strengths, and the score
# (6/10) didn't reflect that Rust, the language the job title is built
# around, is completely absent from the candidate's profile.

BRAIINS_JD = """
Job title: Backend Rust Developer

About the role:
We're looking for a backend engineer to build and maintain core services in
Rust that power our infrastructure.

Required:
- 3+ years professional experience writing production Rust.
- Strong understanding of systems programming, concurrency, and performance.
- Experience designing and maintaining backend services and APIs.

You may also touch TypeScript/React frontend code, Python-based tools or
legacy services, internal tooling, and CI/CD pipelines as needed — these are
not the focus of the role but come up occasionally.

Preferred:
- Experience with embedded systems or low-level networking.
- Familiarity with distributed systems.
""".strip()

RUST_MASTER_CV = {
    "name": "Test Candidate",
    "summary": "Full-stack engineer with a TypeScript/React and Python/FastAPI background.",
    "skills": ["TypeScript", "React", "Python", "FastAPI", "PostgreSQL", "Docker"],
    "experience": [
        {
            "title": "Full-Stack Developer",
            "company": "Acme Corp",
            "description": "Built full-stack applications with React/TypeScript frontends and Python/FastAPI backends. No Rust.",
        }
    ],
    "projects": [
        {
            "name": "JobRadar AI",
            "description": "Production agentic job-rating platform built with Python/FastAPI and a React/TypeScript frontend.",
        }
    ],
    "education": [],
}

RUST_USER = {
    "_id": ObjectId(),
    "cv": {"structured": RUST_MASTER_CV},
    "experience_level": "mid",
    "work_authorization": "",
    "work_mode": {"remote": True, "hybrid": True, "onsite": False},
}

RUST_JOB = {"_id": ObjectId(), "full_text": BRAIINS_JD, "salary_text": ""}


async def _run_rust():
    await connect_to_mongo()
    return await rate_job_for_user(RUST_JOB, RUST_USER)


def _normalize(entry: str) -> str:
    return re.sub(
        r"^\[(essential|preferred)\]\s*", "", entry.strip(), flags=re.IGNORECASE
    ).lower()


def demo_gap_strength_inversion():
    rating = asyncio.run(_run_rust())
    strengths = rating.get("matched_strengths", [])
    gaps = rating.get("gaps", [])
    score = rating.get("score")

    print("Score:", score)
    print("Matched strengths:")
    for s in strengths:
        print(f"  - {s}")
    print("Gaps:")
    for g in gaps:
        print(f"  - {g}")

    # Bug 2: no duplicate entries in matched_strengths.
    normalized = [_normalize(s) for s in strengths]
    assert len(normalized) == len(
        set(normalized)
    ), f"matched_strengths contains duplicate entries: {strengths}"

    # Bug 1: a skill already confirmed as a strength (TypeScript/React/Python)
    # must never also appear in gaps, regardless of "may also touch" phrasing.
    already_have = {"typescript", "react", "python"}
    inverted_gaps = [g for g in gaps if any(kw in g.lower() for kw in already_have)]
    assert not inverted_gaps, (
        f"gaps list contains skills the candidate already has (present in "
        f"matched_strengths): {inverted_gaps}"
    )

    # Bug 3: job title names Rust as the core skill; candidate has zero Rust
    # evidence anywhere in the profile — score must reflect that, not just a
    # standard per-item Essential deduction.
    assert score is not None and score <= 4, (
        f"expected score <= 4 for a title-named language (Rust) with zero "
        f"evidence in the candidate's profile, got {score}"
    )

    print(
        "OK — no gap/strength inversion, no duplicate strengths, score reflects missing title-named language"
    )


if __name__ == "__main__":
    demo()
    demo_gap_strength_inversion()
