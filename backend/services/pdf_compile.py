"""
LaTeX -> PDF compilation via a self-hosted Tectonic binary.

Tectonic (github.com/tectonic-typesetting/tectonic) is a self-contained,
statically-linked LaTeX engine, no system TeXLive install needed. The binary
lives at backend/bin/tectonic (not in git, see deploy notes) and fetches/
caches TeX packages into TECTONIC_CACHE_DIR on first use, instant afterward
(measured: ~70s cold with an empty cache, ~1.2s once warm). Deploy should
run one throwaway compile after install to warm the cache ahead of the
first real user request, see deploy notes.
"""

import os
import subprocess
import tempfile
from pathlib import Path

import fitz  # PyMuPDF, already a dependency, see services/cv_parser.py

_BACKEND_DIR = Path(__file__).resolve().parent.parent
TECTONIC_BIN = _BACKEND_DIR / "bin" / "tectonic"
TECTONIC_CACHE_DIR = _BACKEND_DIR / ".tectonic_cache"


class PdfCompileError(Exception):
    """Raised when Tectonic fails to produce a PDF."""


def compile_tex_to_pdf(tex: str, timeout_s: int = 60) -> tuple[bytes, int]:
    """Compiles a LaTeX document to PDF, returns (pdf_bytes, page_count).

    Runs in a throwaway temp directory, no shell-escape (Tectonic doesn't
    support \\write18 by default), page_count is read back via PyMuPDF so
    callers can check for page overflow immediately, not as an afterthought.
    """
    TECTONIC_CACHE_DIR.mkdir(exist_ok=True)
    env = {**os.environ, "TECTONIC_CACHE_DIR": str(TECTONIC_CACHE_DIR)}

    with tempfile.TemporaryDirectory(prefix="jobradar_tex_") as tmp:
        tmp_path = Path(tmp)
        tex_path = tmp_path / "doc.tex"
        tex_path.write_text(tex, encoding="utf-8")

        try:
            result = subprocess.run(
                [str(TECTONIC_BIN), "doc.tex"],
                cwd=tmp_path,
                capture_output=True,
                timeout=timeout_s,
                text=True,
                env=env,
            )
        except subprocess.TimeoutExpired as exc:
            raise PdfCompileError(
                f"LaTeX compile timed out after {timeout_s}s"
            ) from exc

        pdf_path = tmp_path / "doc.pdf"
        if result.returncode != 0 or not pdf_path.exists():
            raise PdfCompileError(
                f"LaTeX compile failed (exit {result.returncode}): {result.stderr[-2000:]}"
            )

        pdf_bytes = pdf_path.read_bytes()
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        page_count = doc.page_count
        doc.close()
        return pdf_bytes, page_count
