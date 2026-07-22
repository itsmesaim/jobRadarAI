"""
Standing calibration notes — distills a user's rating feedback into a short
set of rules applied to EVERY rating, not just embedding-similar ones.

services/rating.py already retrieves the user's feedback on similar past
jobs per-rating (_retrieve_similar_rated_jobs), but that only surfaces
feedback when the new job happens to be embedding-similar to the specific
job the feedback was left on — a general correction ("stop penalizing me for
freelance-only experience") never becomes a standing rule under that scheme.
This module periodically summarizes ALL of a user's feedback into a
persistent note block (services/rating.py injects it into every prompt,
same as about_me/skill_overrides).
"""

from datetime import datetime, timezone

from bson import ObjectId
from langchain_core.messages import HumanMessage, SystemMessage

from database import get_database
from services.llm import get_llm

# Below this many feedback entries there isn't enough signal to distill
# recurring patterns from — leave calibration_notes empty rather than have
# the LLM invent "patterns" out of 1-2 data points.
MIN_FEEDBACK_FOR_CALIBRATION = 3

# Cap how much feedback history goes into one summarization call.
MAX_FEEDBACK_ENTRIES = 40

CALIBRATION_SYSTEM_PROMPT = """
You are analyzing a candidate's feedback on their AI job-fit ratings to
extract STANDING RULES the rater should follow on every future rating, not
just similar ones.

Look for recurring corrections — the same complaint or correction showing up
across multiple jobs. Ignore one-off comments that don't repeat.

Output 3-8 short, concrete, imperative rules (one per line, no numbering, no
preamble). Each rule must be actionable by a rater reading a JD, e.g.:
  "Don't penalize freelance/contract experience as if it were a gap."
  "Weight production LLM/agentic system experience heavily even without the exact framework named in the JD."
  "Ignore 'nice to have' cloud certifications entirely."

If nothing recurs clearly, output exactly: NO_CLEAR_PATTERN
""".strip()


async def _collect_feedback_entries(db, user_id: str) -> list[dict]:
    cursor = (
        db.jobs.find(
            {f"rating_feedback.{user_id}": {"$exists": True}},
            {"title": 1, f"ratings.{user_id}": 1, f"rating_feedback.{user_id}": 1},
        )
        .sort(f"rating_feedback.{user_id}.created_at", -1)
        .limit(MAX_FEEDBACK_ENTRIES)
    )
    entries = []
    async for job in cursor:
        feedback = (job.get("rating_feedback") or {}).get(user_id, {})
        rating = (job.get("ratings") or {}).get(user_id, {})
        if not feedback.get("comment") and not feedback.get("stars"):
            continue
        entries.append(
            {
                "title": job.get("title", "Untitled"),
                "score": rating.get("score"),
                "verdict": rating.get("verdict", ""),
                "stars": feedback.get("stars"),
                "comment": feedback.get("comment", ""),
            }
        )
    return entries


def _build_feedback_block(entries: list[dict]) -> str:
    lines = []
    for e in entries:
        line = f"- {e['title']}: AI scored {e['score']}/10 ({e['verdict']})"
        if e.get("stars"):
            line += f" — user rated the rating itself {e['stars']}/5 stars"
        if e.get("comment"):
            line += f" — user said: \"{e['comment']}\""
        lines.append(line)
    return "\n".join(lines)


async def regenerate_calibration_notes(user_id: str) -> str | None:
    """Re-summarize this user's feedback into standing rules. Returns the
    new notes (or None if there wasn't enough feedback to summarize)."""
    db = get_database()
    entries = await _collect_feedback_entries(db, user_id)

    if len(entries) < MIN_FEEDBACK_FOR_CALIBRATION:
        return None

    messages = [
        SystemMessage(content=CALIBRATION_SYSTEM_PROMPT),
        HumanMessage(content=_build_feedback_block(entries)),
    ]
    llm = get_llm()
    response = await llm.ainvoke(messages)
    notes = (response.content or "").strip()

    if not notes or notes == "NO_CLEAR_PATTERN":
        notes = ""

    await db.users.update_one(
        {"_id": ObjectId(user_id)},
        {
            "$set": {
                "calibration_notes": notes,
                "calibration_notes_updated_at": datetime.now(timezone.utc),
                "calibration_notes_source_count": len(entries),
            }
        },
    )
    return notes
