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
from docx import Document as DocxDocument
from odf import teletype
from odf.opendocument import load as load_odf
from langchain_core.messages import HumanMessage, SystemMessage
from langsmith import traceable

from config import settings
from services.ai_models import get_cost_multiplier, get_default_model_for_provider
from services.ai_usage import record_from_llm_response
from services.llm import get_llm
from services.prompt_safety import fence


# ── Step 1: file bytes → raw text (format-specific) ──────
def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    pages = [page.get_text() for page in doc]
    doc.close()
    raw = "\n".join(pages).strip()
    if not raw:
        raise ValueError("PDF appears to be empty or scanned (no extractable text).")
    return raw


def extract_text_from_docx(file_bytes: bytes) -> str:
    import io

    doc = DocxDocument(io.BytesIO(file_bytes))
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    for table in doc.tables:
        for row in table.rows:
            paragraphs.extend(cell.text for cell in row.cells if cell.text.strip())
    raw = "\n".join(paragraphs).strip()
    if not raw:
        raise ValueError("Word document appears to be empty.")
    return raw


def extract_text_from_odt(file_bytes: bytes) -> str:
    import io

    doc = load_odf(io.BytesIO(file_bytes))
    raw = teletype.extractText(doc.text).strip()
    if not raw:
        raise ValueError("ODT document appears to be empty.")
    return raw


def extract_text_from_plain(file_bytes: bytes) -> str:
    """Covers .txt and .tex, both are just plain text to the parser."""
    raw = file_bytes.decode("utf-8", errors="ignore").strip()
    if not raw:
        raise ValueError("File appears to be empty.")
    return raw


_EXTRACTORS = {
    "pdf": extract_text_from_pdf,
    "docx": extract_text_from_docx,
    "odt": extract_text_from_odt,
    "txt": extract_text_from_plain,
    "tex": extract_text_from_plain,
}


def extract_text(file_bytes: bytes, extension: str) -> str:
    extractor = _EXTRACTORS.get(extension.lower().lstrip("."))
    if not extractor:
        raise ValueError(f"Unsupported CV file format: .{extension}")
    return extractor(file_bytes)


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
  "summary": "string, the professional summary or objective",
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
      "description": "string, one sentence summary",
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
  placeholders, leave "phone" and "email" as null, they're filled in locally.
""".strip()

_PHONE_RE = re.compile(r"(\+?\d[\d\-.\s()]{7,}\d)")
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")


def _redact_contact_details(text: str) -> str:
    """Mask phone numbers and emails before the text leaves the server."""
    text = _EMAIL_RE.sub("[REDACTED_EMAIL]", text)
    text = _PHONE_RE.sub("[REDACTED_PHONE]", text)
    return text


def _extract_contact_details(text: str) -> tuple[str | None, str | None]:
    """Pull the real phone/email locally, never sent to the LLM."""
    email_match = _EMAIL_RE.search(text)
    phone_match = _PHONE_RE.search(text)
    return (
        phone_match.group(0).strip() if phone_match else None,
        email_match.group(0) if email_match else None,
    )


@traceable(name="parse_cv_with_llm", run_type="llm")
async def parse_cv_with_llm(raw_text: str, user: dict | None = None) -> dict:
    user = user or {}
    user_id = str(user.get("_id", "")) or None
    user_provider = user.get("cv_parsing_provider") or None
    user_model = user.get("cv_parsing_model") or (
        await get_default_model_for_provider(user_provider, "cv_parsing")
        if user_provider
        else None
    )
    cost_multiplier = await get_cost_multiplier(user_provider, user_model, "cv_parsing")
    llm = get_llm(provider=user_provider, model=user_model)
    provider = user_provider or settings.llm_provider

    redacted_text = _redact_contact_details(raw_text)
    messages = [
        SystemMessage(content=SYSTEM_PROMPT),
        HumanMessage(content=f"Parse this CV:\n\n{fence('CV TEXT', redacted_text)}"),
    ]

    try:
        response = await llm.ainvoke(messages)
    except Exception as e:
        raise ValueError(f"CV parsing failed ({provider}): {e}") from e
    model = getattr(
        llm, "model", getattr(llm, "model_name", user_model or settings.openai_model)
    )
    model = str(model or "unknown")
    if user_id:
        await record_from_llm_response(
            user_id,
            response,
            operation="cv_parse",
            provider=provider,
            model=model,
            cost_multiplier=cost_multiplier,
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
    parsed["parsed_by_model"] = f"{provider}:{model}"
    return parsed


# ── Combined: file bytes → structured dict ───────────────
async def process_cv(
    file_bytes: bytes, extension: str = "pdf", user: dict | None = None
) -> tuple[str, dict]:
    """
    Returns (raw_text, structured_json).
    We store both, raw_text for embedding later, structured for display.
    """
    raw_text = extract_text(file_bytes, extension)
    structured = await parse_cv_with_llm(raw_text, user=user)
    return raw_text, structured
