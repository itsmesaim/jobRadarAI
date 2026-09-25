"""
Pull title / company / location / salary / visa hints out of a pasted job page.

Rules run first and cost nothing. The LLM is only asked for title/company when
the rules could not find them (see llm_title_company), so most pastes never
spend a token.

Self-check: `python -m services.jd_extract`
"""

import json
import re

from langchain_core.messages import HumanMessage, SystemMessage

from config import settings
from services.ai_usage import record_from_llm_response
from services.llm import get_llm
from services.prompt_safety import fence

_DASH = chr(0x2013) + chr(
    0x2014
)  # en/em dash, built from code points so the source stays plain

# Page chrome and badges that show up before the real title when a page is copied whole.
_NOISE = re.compile(
    r"^(skip to|sign in|log in|apply|save|share|report|back|home|menu|jobs?|search|"
    r"easy apply|promoted|actively (hiring|recruiting)|\d+ (applicants?|clicks?)|"
    r"full[- ]time|part[- ]time|contract|remote|hybrid|on-?site|new|posted)\b",
    re.I,
)
_LABELS = {
    "title": re.compile(
        r"^\s*(?:job\s*title|position|role)\s*[:\-]\s*(.{3,100})$", re.I | re.M
    ),
    "company": re.compile(
        r"^\s*(?:company(?:\s*name)?|employer|hiring\s*organi[sz]ation)\s*[:\-]\s*(.{2,80})$",
        re.I | re.M,
    ),
    "location": re.compile(
        r"^\s*(?:work\s*)?location\s*[:\-]\s*(.{2,80})$", re.I | re.M
    ),
}
_ABOUT = re.compile(r"^\s*(?i:about|join)\s+([A-Z][\w&.'\- ]{1,60}?)\s*$", re.M)
_IS_A = re.compile(
    r"\b([A-Z][\w&.'\-]+(?: [A-Z][\w&.'\-]+){0,3}) (?:is|are) "
    r"(?:a|an|the|looking|hiring|seeking|one of)\b"
)
_TITLE_AT = re.compile(r"^(.{3,100}?)\s+(?:at|@|\|)\s+([A-Z][^|]{1,60})")

_CUR = r"(?:[€£$₹]|USD|EUR|GBP|INR|AED|CAD|AUD)"
_NUM = r"\d[\d,.]*\s?[kKmM]?"
_SALARY = re.compile(
    rf"{_CUR}\s?{_NUM}(?:\s?(?:-|to|[{_DASH}])\s?{_CUR}?\s?{_NUM})?"
    r"(?:\s?(?:per|/|a)\s?(?:year|yr|annum|month|hour|hr|day|week))?",
    re.I,
)

_NO_SPONSOR = re.compile(
    r"no (?:visa )?sponsorship|unable to sponsor|cannot sponsor|"
    r"not (?:able|in a position) to sponsor|"
    r"must (?:already )?(?:have|hold) (?:the )?(?:right|authori[sz]ation) to work|"
    r"must be (?:legally )?(?:authori[sz]ed|eligible) to work|"
    r"(?:u\.?s\.?|uk|eu) citizens? only|security clearance",
    re.I,
)
_SPONSOR = re.compile(
    r"visa sponsorship (?:is )?(?:available|provided|offered)|we (?:can |will )?sponsor|"
    r"sponsorship (?:is )?available|relocation (?:support|package|assistance)",
    re.I,
)


_CTRL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
_CAPS = {"title": 100, "company": 80, "location": 80, "salary_text": 60}


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", _CTRL.sub("", s)).strip(" \t-:|,")


def _cap(d: dict) -> dict:
    """Extracted values are shown in the UI and stored: keep them short plain text."""
    return {k: (v[: _CAPS[k]] if k in _CAPS else v) for k, v in d.items()}


def _title_and_company(text: str) -> tuple[str, str]:
    title = company = ""
    if m := _LABELS["title"].search(text):
        title = _clean(m.group(1))
    if m := _LABELS["company"].search(text):
        company = _clean(m.group(1))
    if not title:
        for line in text.splitlines()[:15]:
            line = _clean(line)
            if (
                3 <= len(line) <= 100
                and len(line.split()) <= 12
                and not _NOISE.match(line)
            ):
                title = line
                break
    if title and not company and (m := _TITLE_AT.match(title)):
        title, company = _clean(m.group(1)), _clean(m.group(2))
    if not company:
        if m := _ABOUT.search(text) or _IS_A.search(text):
            company = _clean(m.group(1))
    return title, company


def extract_fields(text: str) -> dict:
    """Rule-based pass. Empty string means "not found", never a guess."""
    text = text or ""
    title, company = _title_and_company(text)
    loc = _LABELS["location"].search(text)
    salary = next(
        (m.group(0).strip() for m in _SALARY.finditer(text) if len(m.group(0)) >= 5), ""
    )
    no_sponsor, sponsor = bool(_NO_SPONSOR.search(text)), bool(_SPONSOR.search(text))
    visa = "" if no_sponsor == sponsor else ("not_offered" if no_sponsor else "offered")
    return _cap(
        {
            "title": title,
            "company": company,
            "location": _clean(loc.group(1)) if loc else "",
            "salary_text": salary,
            "visa": visa,
            "source": "rules",
        }
    )


_LLM_PROMPT = (
    "Read the job posting and return ONLY a JSON object "
    '{"title": "", "company": "", "location": ""}. Use an empty string for anything '
    "the text does not state. Never guess. No markdown, no commentary."
)


async def llm_title_company(text: str, user_id: str) -> dict:
    """One small LLM call for what the rules missed. Any failure returns {}."""
    llm = get_llm()
    try:
        response = await llm.ainvoke(
            [
                SystemMessage(content=_LLM_PROMPT),
                HumanMessage(content=fence("job posting", text[:3000])),
            ]
        )
        raw = (response.content or "").strip()
        data = json.loads(raw[raw.index("{") : raw.rindex("}") + 1])
    except Exception:
        return {}
    model = getattr(llm, "model", getattr(llm, "model_name", settings.openai_model))
    await record_from_llm_response(
        user_id,
        response,
        operation="jd_extract",
        provider=settings.llm_provider,
        model=str(model or "unknown"),
    )
    return _cap(
        {k: _clean(str(data.get(k) or "")) for k in ("title", "company", "location")}
    )


if __name__ == "__main__":
    a = extract_fields(
        "Skip to content\nFull Stack Engineer at Licorne Society\nParis, France\n"
        "Salary: €45,000 - €60,000 per year\nWe are unable to sponsor visas."
    )
    assert a["title"] == "Full Stack Engineer" and a["company"] == "Licorne Society", a
    assert a["salary_text"].startswith("€45,000") and a["visa"] == "not_offered", a

    b = extract_fields(
        "Job title: Backend Dev\nCompany: Acme Ltd\nLocation: Dublin\nWe sponsor visas."
    )
    assert (b["title"], b["company"], b["location"], b["visa"]) == (
        "Backend Dev",
        "Acme Ltd",
        "Dublin",
        "offered",
    ), b

    c = extract_fields(
        "Apply\nSave\nData Engineer\nAbout Northwind Labs\nNo pay listed."
    )
    assert (c["title"], c["company"], c["salary_text"]) == (
        "Data Engineer",
        "Northwind Labs",
        "",
    ), c

    d = extract_fields("Remote\nhello")
    assert d["company"] == "", d  # nothing to find: caller falls back to the LLM
    print("jd_extract ok")
