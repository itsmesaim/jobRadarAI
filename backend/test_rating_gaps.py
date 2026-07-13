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


if __name__ == "__main__":
    demo()
