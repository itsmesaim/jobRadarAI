"""
CV parsing service.

Two steps:
1. Extract raw text from PDF using PyMuPDF (fast, no API call)
2. Send raw text to LLM → returns structured CV as JSON

The structured JSON is what gets stored in MongoDB and used
for rating + CV tailoring in Week 2.
"""

import json
import re

import fitz  # PyMuPDF
from langchain_core.messages import HumanMessage, SystemMessage
from langsmith import traceable

from config import settings
from services.ai_usage import record_from_llm_response
from services.llm import get_llm


# ── Step 1: PDF → raw text ───────────────────────────────
def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    pages = [page.get_text() for page in doc]
    doc.close()
    raw = "\n".join(pages).strip()
    if not raw:
        raise ValueError("PDF appears to be empty or scanned (no extractable text).")
    return raw


# ── Step 2: raw text → structured JSON via LLM ──────────
SYSTEM_PROMPT = """
You are a CV parser. Extract structured information from the CV text provided.

Return ONLY valid JSON, no markdown, no backticks, no explanation.

The JSON must follow this exact structure:
{
  "name": "string",
  "email": "string or null",
  "phone": "string or null",
  "location": "string or null",
  "summary": "string — the professional summary or objective",
  "skills": ["skill1", "skill2"],
  "experience": [
    {
      "title": "string",
      "company": "string",
      "start": "string e.g. 2022",
      "end": "string e.g. 2025 or Present",
      "bullets": ["bullet1", "bullet2"]
    }
  ],
  "projects": [
    {
      "name": "string",
      "description": "string — one sentence summary",
      "tech": ["tech1", "tech2"],
      "bullets": ["bullet1", "bullet2"],
      "url": "string or null"
    }
  ],
  "education": [
    {
      "degree": "string",
      "institution": "string",
      "start": "string",
      "end": "string",
      "grade": "string or null"
    }
  ],
  "languages": ["English", "etc"],
  "certifications": []
}

Rules:
- Extract ONLY what is actually in the CV. Never invent or assume.
- If a field is missing, use null for strings or [] for arrays.
- skills should be individual technologies/tools, not sentences.
- Keep bullet points concise and exactly as written in the CV.
- The contact block has been replaced with [REDACTED_PHONE] / [REDACTED_EMAIL]
  placeholders — leave "phone" and "email" as null, they're filled in locally.
""".strip()

_PHONE_RE = re.compile(r"(\+?\d[\d\-.\s()]{7,}\d)")
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")


def _redact_contact_details(text: str) -> str:
    """Mask phone numbers and emails before the text leaves the server."""
    text = _EMAIL_RE.sub("[REDACTED_EMAIL]", text)
    text = _PHONE_RE.sub("[REDACTED_PHONE]", text)
    return text


def _extract_contact_details(text: str) -> tuple[str | None, str | None]:
    """Pull the real phone/email locally — never sent to the LLM."""
    email_match = _EMAIL_RE.search(text)
    phone_match = _PHONE_RE.search(text)
    return (
        phone_match.group(0).strip() if phone_match else None,
        email_match.group(0) if email_match else None,
    )


@traceable(name="parse_cv_with_llm", run_type="llm")
async def parse_cv_with_llm(raw_text: str, user_id: str | None = None) -> dict:
    llm = get_llm()

    redacted_text = _redact_contact_details(raw_text)
    messages = [
        SystemMessage(content=SYSTEM_PROMPT),
        HumanMessage(content=f"Parse this CV:\n\n{redacted_text}"),
    ]

    response = await llm.ainvoke(messages)
    if user_id:
        model = getattr(llm, "model", getattr(llm, "model_name", settings.openai_model))
        await record_from_llm_response(
            user_id,
            response,
            operation="cv_parse",
            provider=settings.llm_provider,
            model=str(model or "unknown"),
        )
    content = response.content.strip()

    # strip markdown fences if model wraps anyway
    content = re.sub(r"^```[a-z]*\n?", "", content)
    content = re.sub(r"\n?```$", "", content)
    content = content.strip()

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as e:
        raise ValueError(f"LLM returned invalid JSON: {e}\n\nRaw output:\n{content}")

    phone, email = _extract_contact_details(raw_text)
    parsed["phone"] = phone
    parsed["email"] = email
    return parsed


# ── Combined: PDF bytes → structured dict ────────────────
async def process_cv(pdf_bytes: bytes, user_id: str | None = None) -> tuple[str, dict]:
    """
    Returns (raw_text, structured_json).
    We store both — raw_text for embedding later, structured for display.
    """
    raw_text = extract_text_from_pdf(pdf_bytes)
    structured = await parse_cv_with_llm(raw_text, user_id=user_id)
    return raw_text, structured
