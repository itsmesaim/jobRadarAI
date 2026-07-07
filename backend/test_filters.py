"""Regression check for the hard pre-filter gate. Run: python3 test_filters.py"""

import re

# ponytail: standalone smoke test — canonical copy in services/rating.py
_SALARY_CEILING = 70000
_SENIOR_TITLE_PATTERN = re.compile(
    r"\b(senior|sr\.?|lead|staff|principal|iii|iv|v)\b", re.IGNORECASE
)
_SALARY_NUMBER_PATTERN = re.compile(r"[\d,]{3,}")


def parse_comp_max(salary_text: str) -> int | None:
    if not salary_text:
        return None
    numbers = [
        int(n.replace(",", "")) for n in _SALARY_NUMBER_PATTERN.findall(salary_text)
    ]
    return max(numbers) if numbers else None


def hard_disqualify(
    job_title: str, comp_max: int | None, salary_ceiling: int = _SALARY_CEILING
) -> tuple[bool, str]:
    title = job_title or ""
    if _SENIOR_TITLE_PATTERN.search(title):
        return True, f"title matched seniority pattern: '{title}'"
    if comp_max and comp_max > salary_ceiling * 1.5:
        return True, f"comp_max {comp_max} exceeds {salary_ceiling * 1.5} ceiling"
    return False, ""


CASES = [
    ("Senior Software Engineer", None, True),
    ("Sr. Backend Developer", None, True),
    ("Lead Platform Engineer", None, True),
    ("Staff Software Engineer", None, True),
    ("Principal Engineer", None, True),
    ("Forward Deployed Engineer III", None, True),
    ("Cloud Architect IV", None, True),
    ("Full Stack Developer", None, False),
    ("Software Engineer II", None, False),
    ("Junior Python Developer", None, False),
    ("Graduate Software Engineer", None, False),
    ("Full Stack Developer", 250_000, True),
]

if __name__ == "__main__":
    for title, comp_max, expected in CASES:
        excluded, reason = hard_disqualify(title, comp_max)
        status = "PASS" if excluded == expected else "FAIL"
        print(
            f"[{status}] '{title}' comp_max={comp_max} -> excluded={excluded} ({reason or 'n/a'})"
        )
        assert (
            excluded == expected
        ), f"{title!r}: expected excluded={expected}, got {excluded}"

    assert parse_comp_max("") is None
    assert parse_comp_max("€50,000 - €60,000") == 60000
    assert parse_comp_max("no numbers here") is None
    print("[PASS] parse_comp_max cases")
    print("\nAll cases passed.")
