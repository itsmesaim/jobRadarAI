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
""".strip()


async def parse_cv_with_llm(raw_text: str) -> dict:
    llm = get_llm()

    messages = [
        SystemMessage(content=SYSTEM_PROMPT),
        HumanMessage(content=f"Parse this CV:\n\n{raw_text}"),
    ]

    response = await llm.ainvoke(messages)
    content = response.content.strip()

    # strip markdown fences if model wraps anyway
    content = re.sub(r"^```[a-z]*\n?", "", content)
    content = re.sub(r"\n?```$", "", content)
    content = content.strip()

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as e:
        raise ValueError(f"LLM returned invalid JSON: {e}\n\nRaw output:\n{content}")

    return parsed


# ── Combined: PDF bytes → structured dict ────────────────
async def process_cv(pdf_bytes: bytes) -> tuple[str, dict]:
    """
    Returns (raw_text, structured_json).
    We store both — raw_text for embedding later, structured for display.
    """
    raw_text = extract_text_from_pdf(pdf_bytes)
    structured = await parse_cv_with_llm(raw_text)
    return raw_text, structured
