"""
One-off diagnostic: why is a user getting no/few matching jobs.

Run on the server (same env as the app):
    cd backend
    uv run python diagnose_matching.py you@example.com

Paste the output back — no DB access needed on the other end.
"""

import asyncio
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone

from database import connect_to_mongo, close_mongo_connection, get_database
from services.rating import parse_comp_max, hard_disqualify, _HARD_FILTER_SALARY_CEILING


async def main(email: str):
    await connect_to_mongo()
    db = get_database()

    user = await db.users.find_one({"email": email})
    if not user:
        print(f"No user found with email={email}")
        return
    user_id = str(user["_id"])

    print("=" * 70)
    print(f"USER: {email} (id={user_id})")
    print(f"  experience_level: {user.get('experience_level')!r}")
    print(f"  work_authorization: {user.get('work_authorization')!r}")
    print(f"  location: {user.get('location')!r}")
    print(f"  full_access: {user.get('full_access')}")
    print(f"  has_cv: {bool(user.get('cv'))}")
    print(f"  overrides: {user.get('limits_override')}")
    print(
        f"  is_admin_email: {email.lower() == (getattr(__import__('config').settings, 'admin_email', '') or '').lower()}"
    )
    print(f"  primary_role: {user.get('primary_role')!r}")
    print(f"  secondary_roles: {user.get('secondary_roles')}")
    print(f"  key_skills: {user.get('key_skills')}")
    print(
        f"  preferred_locations: {user.get('preferred_locations')} (default if unset: ['Dublin Ireland'])"
    )

    now = datetime.now(timezone.utc)
    since = now - timedelta(days=7)

    total_all_time = await db.jobs.count_documents({"crawled_by": user_id})
    print(f"JOBS crawled_by this user, ALL TIME: {total_all_time}")

    jobs_cursor = db.jobs.find({"crawled_by": user_id, "crawled_at": {"$gte": since}})
    jobs = await jobs_cursor.to_list(length=5000)
    print("=" * 70)
    print(f"JOBS crawled_by this user in last 7 days: {len(jobs)}")

    by_day = Counter()
    by_source = Counter()
    for j in jobs:
        ca = j.get("crawled_at")
        if ca:
            by_day[ca.strftime("%Y-%m-%d")] += 1
        by_source[j.get("source", "unknown")] += 1
    print(f"  by day: {dict(sorted(by_day.items()))}")
    print(f"  by source: {dict(by_source)}")

    print("=" * 70)
    rated = [j for j in jobs if (j.get("ratings") or {}).get(user_id)]
    print(f"JOBS with a rating for this user: {len(rated)} / {len(jobs)}")

    score_dist = Counter()
    auto_reject_count = 0
    hard_filter_count = 0
    structural_count = 0
    hard_filter_samples = []
    visa_verdict_samples = []

    for j in rated:
        r = j["ratings"][user_id]
        score_dist[r.get("score")] += 1
        if r.get("auto_reject"):
            auto_reject_count += 1
        if r.get("structural_mismatch"):
            structural_count += 1
        verdict = r.get("verdict") or ""
        if verdict.startswith("Hard filter:"):
            hard_filter_count += 1
            if len(hard_filter_samples) < 10:
                hard_filter_samples.append(
                    (j.get("title"), j.get("salary_text"), verdict)
                )
        elif (
            "visa" in verdict.lower()
            or "sponsor" in verdict.lower()
            or "auth" in verdict.lower()
        ):
            if len(visa_verdict_samples) < 10:
                visa_verdict_samples.append((j.get("title"), verdict))

    print(
        f"  score distribution: {dict(sorted(score_dist.items(), key=lambda x: (x[0] is None, x[0])))}"
    )
    print(f"  auto_reject=true: {auto_reject_count}")
    print(f"  structural_mismatch=true: {structural_count}")
    print(f"  hard-filter (pre-LLM keyword/salary reject): {hard_filter_count}")

    if hard_filter_samples:
        print("-" * 70)
        print("SAMPLE hard-filter rejections (title / salary_text / verdict):")
        for title, salary_text, verdict in hard_filter_samples:
            comp = parse_comp_max(salary_text or "")
            print(
                f"  - {title!r} | salary_text={salary_text!r} | parsed_comp_max={comp} | ceiling={_HARD_FILTER_SALARY_CEILING * 1.5} | {verdict}"
            )

    if visa_verdict_samples:
        print("-" * 70)
        print("SAMPLE LLM verdicts mentioning visa/sponsorship/authorization:")
        for title, verdict in visa_verdict_samples:
            print(f"  - {title!r}: {verdict}")

    print("=" * 70)
    from services.limits import get_user_usage, get_remaining_ratings

    usage = await get_user_usage(user_id)
    remaining = await get_remaining_ratings(user)
    print(f"TODAY'S QUOTA: {usage} | remaining_ratings={remaining}")

    unrated_total = await db.jobs.count_documents(
        {"crawled_by": user_id, f"ratings.{user_id}": {"$exists": False}}
    )
    print(f"UNRATED jobs, all-time (not just last 7 days): {unrated_total}")

    unrated = len(jobs) - len(rated)
    print(f"UNRATED jobs still sitting in queue (last 7 days window): {unrated}")
    if unrated == 0 and len(jobs) == 0:
        print("  -> No jobs were crawled at all in the last 7 days for this user.")
        print("     Check crawler logs / whether POST /crawler/search is being called.")

    await close_mongo_connection()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: python diagnose_matching.py <user-email>")
        sys.exit(1)
    asyncio.run(main(sys.argv[1]))
