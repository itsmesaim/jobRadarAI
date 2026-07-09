"""Regression check for the hard pre-filter gate. Run: python3 test_filters.py"""

import re

# ponytail: standalone smoke test — canonical copy in services/rating.py
_SALARY_CEILING = 70000
_SALARY_NUMBER_PATTERN = re.compile(r"[\d,]{3,}")


def parse_comp_max(salary_text: str) -> int | None:
    if not salary_text:
        return None
    numbers = [
        int(n.replace(",", "")) for n in _SALARY_NUMBER_PATTERN.findall(salary_text)
    ]
    return max(numbers) if numbers else None


def hard_disqualify(
    comp_max: int | None, salary_ceiling: int = _SALARY_CEILING
) -> tuple[bool, str]:
    if comp_max and comp_max > salary_ceiling * 1.5:
        return True, f"comp_max {comp_max} exceeds {salary_ceiling * 1.5} ceiling"
    return False, ""


CASES = [
    (None, False),
    (100_000, False),
    (250_000, True),
]

if __name__ == "__main__":
    for comp_max, expected in CASES:
        excluded, reason = hard_disqualify(comp_max)
        status = "PASS" if excluded == expected else "FAIL"
        print(
            f"[{status}] comp_max={comp_max} -> excluded={excluded} ({reason or 'n/a'})"
        )
        assert (
            excluded == expected
        ), f"comp_max={comp_max}: expected excluded={expected}, got {excluded}"

    assert parse_comp_max("") is None
    assert parse_comp_max("€50,000 - €60,000") == 60000
    assert parse_comp_max("no numbers here") is None
    print("[PASS] parse_comp_max cases")
    print("\nAll cases passed.")
