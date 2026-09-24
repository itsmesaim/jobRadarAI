"""Deterministic checks around apply-pack LLM nodes (no LLM calls)."""

from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

EM_DASH = "\u2014"
EN_DASH = "\u2013"

_DATE_EN = re.compile(r"(\d|[A-Za-z]{3})" + EN_DASH + r"(\d|Present|[A-Z][a-z]{2})")
_NUM = re.compile(r"\d+(?:[.,]\d+)?%?")
_TOKEN = re.compile(r"[A-Za-z][A-Za-z0-9.+#/_-]*")

# Required CoverLetterParts fields. Absence fails integrity (never silent pass).
_REQUIRED_COVER_FIELDS = (
    "strongest_match",
    "concrete_example",
    "gaps_named",
    "close",
)

# Short ASCII codes for X-Apply-Pack-Warnings (frontend maps to copy).
PDF_WARN_CODES = frozenset(
    {
        "pdf_missing",
        "page_overflow",
        "pdftotext_failed",
        "empty_extract",
        "em_dash",
        "ligature",
        "replacement_chars",
        "bare_pipe",
    }
)


def find_dashes(lines: list[str]) -> list[str]:
    hits = []
    for i, line in enumerate(lines, 1):
        if EM_DASH in line:
            hits.append(f"line {i}: em dash")
        for m in re.finditer(EN_DASH, line):
            ctx = line[max(0, m.start() - 3) : m.end() + 7]
            if not _DATE_EN.search(ctx):
                hits.append(f"line {i}: en dash outside a date range")
    return hits


def find_bare_pipes(latex: str) -> list[str]:
    """Return short codes (one per hit max) for bare | outside \\textbar."""
    for line in latex.splitlines():
        if "|" in line.replace("\\textbar", ""):
            return ["bare_pipe"]
    return []


def _facts(text: str) -> tuple[set[str], set[str]]:
    nums = set(_NUM.findall(text))
    techs: set[str] = set()
    for sentence in re.split(r"(?<=[.!?:])\s+|\n", text):
        words = _TOKEN.findall(sentence)
        for w in words[1:]:
            technical = any(c.isupper() for c in w[1:]) or any(
                c in w for c in "0123456789.+#/_"
            )
            if technical or w[0].isupper():
                techs.add(w.lower().strip(".,;:"))
    return nums, techs


def new_facts(
    before: str,
    after: str,
    *,
    pack_vocab: set[str] | None = None,
    pack_nums: set[str] | None = None,
) -> list[str]:
    """new number/term in `after` vs `before`, allowlisted against a wider vocab.

    `pack_vocab`/`pack_nums`, when given, cover the whole pack (summary +
    experience + cover) so a term/number that just moved sections (e.g. a
    bullet's tool name echoed into the summary) is not flagged as invented -
    only the section-local `before` is used otherwise.
    """
    n0, t0 = _facts(before)
    n1, t1 = _facts(after)
    vocab = (
        pack_vocab
        if pack_vocab is not None
        else {w.lower().strip(".,;:") for w in _TOKEN.findall(before)}
    )
    nums_allowed = pack_nums if pack_nums is not None else n0
    new_nums = sorted(n for n in (n1 - n0) if n not in nums_allowed)
    new_terms = sorted(t for t in t1 - t0 if t not in vocab)
    return [f"new number: {n}" for n in new_nums] + [
        f"new term: {t}" for t in new_terms
    ]


def _flatten_experience(exp: list) -> tuple[str, dict[str, int], dict[str, set[str]]]:
    """Return joined text, bullet counts by company, numbers by company."""
    chunks: list[str] = []
    counts: dict[str, int] = {}
    nums: dict[str, set[str]] = {}
    for role in exp or []:
        if isinstance(role, dict):
            company = (role.get("company") or "role").strip() or "role"
            bullets = role.get("bullets") or []
            texts = []
            for b in bullets:
                if isinstance(b, dict):
                    texts.append(b.get("text") or "")
                else:
                    texts.append(getattr(b, "text", None) or str(b))
        else:
            company = (getattr(role, "company", None) or "role").strip() or "role"
            bullets = getattr(role, "bullets", None) or []
            texts = [getattr(b, "text", None) or str(b) for b in bullets]
        counts[company] = len(texts)
        joined = "\n".join(texts)
        nums[company] = set(_NUM.findall(joined))
        chunks.append(f"{company}\n{joined}")
    return "\n\n".join(chunks), counts, nums


def _cover_field(cover: Any, key: str):
    if cover is None:
        return None
    if isinstance(cover, dict):
        return cover.get(key)
    return getattr(cover, key, None)


def cover_missing_fields(cover: Any) -> list[str]:
    """Loud failures when required cover fields are absent or empty.

    `gaps_named` is a list where `[]` is a legitimate "no gaps" answer, not a
    missing field - only its absence (None) counts as missing here. A real
    drop (candidate had gaps, humanizer erased them) is caught separately in
    `humanizer_integrity_failures` by comparing before/after.
    """
    if cover is None:
        return ["cover missing entirely"]
    missing: list[str] = []
    for key in _REQUIRED_COVER_FIELDS:
        val = _cover_field(cover, key)
        if key == "gaps_named":
            if val is None:
                missing.append(f"cover missing field: {key}")
        elif val is None or val == "":
            missing.append(f"cover missing field: {key}")
    return missing


def _cover_text(cover: Any) -> str:
    if not cover:
        return ""
    parts: list[str] = []
    for k in _REQUIRED_COVER_FIELDS:
        v = _cover_field(cover, k)
        if isinstance(v, list):
            parts.extend(str(x) for x in v)
        elif v:
            parts.append(str(v))
    return "\n".join(parts)


def humanizer_integrity_failures(before: dict, after: dict) -> list[str]:
    """
    Fail if humanizer changed bullet counts, invented numbers/terms, or dropped
    required cover fields. Missing checked fields always fail (never silent pass).
    """
    fails: list[str] = []
    fails += cover_missing_fields(before.get("cover_letter"))
    fails += [f"after {m}" for m in cover_missing_fields(after.get("cover_letter"))]

    before_gaps = _cover_field(before.get("cover_letter"), "gaps_named")
    after_gaps = _cover_field(after.get("cover_letter"), "gaps_named")
    if before_gaps and not after_gaps:
        fails.append("after cover dropped all gaps_named")

    if before.get("tailored_summary") in (None, ""):
        fails.append("before missing field: tailored_summary")
    if after.get("tailored_summary") in (None, ""):
        fails.append("after missing field: tailored_summary")
    if not (before.get("tailored_experience") or []):
        fails.append("before missing field: tailored_experience")
    if not (after.get("tailored_experience") or []):
        fails.append("after missing field: tailored_experience")

    b_sum = before.get("tailored_summary") or ""
    a_sum = after.get("tailored_summary") or ""

    b_text, b_counts, b_nums = _flatten_experience(
        before.get("tailored_experience") or []
    )
    a_text, a_counts, a_nums = _flatten_experience(
        after.get("tailored_experience") or []
    )
    for company, n in b_counts.items():
        if a_counts.get(company, -1) != n:
            fails.append(f"{company}: bullet count {a_counts.get(company)} != {n}")
        if not (a_nums.get(company) or set()).issubset(b_nums.get(company) or set()):
            extra = sorted(
                (a_nums.get(company) or set()) - (b_nums.get(company) or set())
            )
            if extra:
                fails.append(f"{company}: new numbers {extra}")

    b_c = _cover_text(before.get("cover_letter"))
    a_c = _cover_text(after.get("cover_letter"))

    # Allowlist against the whole pack's before-text, not just one section's -
    # a term/number the humanizer echoes from experience into the summary (or
    # vice versa) is not a fabrication (see gh issue: Viasat false revert).
    pack_before = f"{b_sum}\n{b_text}\n{b_c}"
    pack_vocab = {w.lower().strip(".,;:") for w in _TOKEN.findall(pack_before)}
    pack_nums = set(_NUM.findall(pack_before))

    fails += [
        f"summary {f}"
        for f in new_facts(b_sum, a_sum, pack_vocab=pack_vocab, pack_nums=pack_nums)
    ]
    fails += [
        f"experience {f}"
        for f in new_facts(b_text, a_text, pack_vocab=pack_vocab, pack_nums=pack_nums)
    ]
    fails += [
        f"cover {f}"
        for f in new_facts(b_c, a_c, pack_vocab=pack_vocab, pack_nums=pack_nums)
    ]

    lines = (a_sum + "\n" + a_text + "\n" + a_c).splitlines()
    fails += find_dashes(lines)
    return fails


_ISSUE_PREFIX = re.compile(
    r"^\s*\[?\s*(R[123])\s*[|/]\s*(drafter|humanizer|user)\s*\]?\s*[:\-]?\s*",
    re.I,
)
_ISSUE_PREFIX_TIER_ONLY = re.compile(
    r"^\s*\[?\s*(R[123])\s*\]?\s*[:\-]?\s*",
    re.I,
)


def _normalize_issue(issue: Any) -> tuple[str, str, str, bool]:
    """
    Return (tier, owner, text, parsed_ok).
    Structured dict/model preferred. Legacy strings need a clear [R#|owner] prefix;
    unparseable strings are not guessed into revise; caller routes to user_questions.
    """
    if issue is None:
        return "R2", "user", "", False
    if hasattr(issue, "model_dump"):
        issue = issue.model_dump()
    if isinstance(issue, dict) and (
        "tier" in issue or "owner" in issue or "reason" in issue or "text" in issue
    ):
        tier = str(issue.get("tier") or "").strip().upper()
        owner = str(issue.get("owner") or "").strip().lower()
        text = (
            str(issue.get("reason") or issue.get("text") or "").strip()
            or str(issue.get("direction") or "").strip()
        )
        if tier not in ("R1", "R2", "R3") or owner not in (
            "drafter",
            "humanizer",
            "user",
        ):
            return tier or "R2", "user", text or str(issue), False
        if tier == "R3" and owner == "drafter":
            owner = "humanizer"
        return tier, owner, text, True

    raw = str(issue).strip()
    if not raw:
        return "R2", "user", "", False
    m = _ISSUE_PREFIX.match(raw)
    if m:
        tier = m.group(1).upper()
        owner = m.group(2).lower()
        text = raw[m.end() :].strip()
        if tier == "R3" and owner == "drafter":
            owner = "humanizer"
        return tier, owner, text, True
    # Tier-only prefix without owner: do not invent an owner, escalate to user.
    m2 = _ISSUE_PREFIX_TIER_ONLY.match(raw)
    if m2:
        tier = m2.group(1).upper()
        text = raw[m2.end() :].strip()
        return tier, "user", text or raw, False
    return "R2", "user", raw, False


def classify_ats_issue(issue: Any) -> tuple[str, str, str]:
    """Return (tier, owner, text). Unparseable → owner user (safe bucket)."""
    tier, owner, text, _ok = _normalize_issue(issue)
    return tier, owner, text


def split_ats_issues(issues: list) -> tuple[list[str], list[str], list[str]]:
    """Split into (revise_issues, humanizer_brief, user_questions).

    Structured issues route by tier/owner. Unparseable legacy strings go to
    user_questions (never silently into revise).
    """
    revise: list[str] = []
    humanizer: list[str] = []
    user_q: list[str] = []
    for issue in issues or []:
        tier, owner, text, parsed_ok = _normalize_issue(issue)
        if not text:
            continue
        if not parsed_ok or owner == "user":
            label = text if parsed_ok else f"Unparsed ATS issue (needs review): {text}"
            user_q.append(label)
        elif tier == "R3" or owner == "humanizer":
            humanizer.append(text)
        else:
            revise.append(f"[{tier}] {text}")
    return revise, humanizer, user_q


def check_pdf_bytes(pdf: bytes, *, page_count: int | None = None) -> list[str]:
    """Return short warning codes (ASCII). Frontend maps to user-facing text."""
    if not pdf:
        return ["pdf_missing"]
    codes: list[str] = []
    if page_count is not None and page_count > 1:
        codes.append("page_overflow")
    if not shutil.which("pdftotext"):
        return codes
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "cv.pdf"
        path.write_bytes(pdf)
        try:
            out = subprocess.run(
                ["pdftotext", "-layout", str(path), "-"],
                check=False,
                capture_output=True,
                text=True,
                timeout=20,
            )
        except Exception:
            return codes + ["pdftotext_failed"]
        text = out.stdout or ""
        if len(text.strip()) < 40:
            codes.append("empty_extract")
        if EM_DASH in text:
            codes.append("em_dash")
        if "ﬁ" in text or "ﬂ" in text or "ﬀ" in text:
            codes.append("ligature")
        if text.count("\ufffd") > 2:
            codes.append("replacement_chars")
    return codes
