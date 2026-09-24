"""Validate user-uploaded LaTeX CV templates (injection / shell-escape guard)."""

from __future__ import annotations

import re

_MAX_TEX_BYTES = 200_000

# Patterns that enable file/shell escape or arbitrary reads in TeX engines.
_FORBIDDEN = [
    re.compile(p, re.I)
    for p in (
        r"\\write\s*18",
        r"\\immediate",
        r"\\openout",
        r"\\openin",
        r"\\input\s*\{\s*\|",
        r"\\usepackage\s*\{[^}]*shellesc",
        r"\\catcode",
        r"\\special\s*\{",
        r"\\directlua",
        r"\\luaexec",
        r"\\ReadStream",
        r"\\csname\s*write",
        r"\\filename@parse",
        r"\\include\s*\{\s*\|",
    )
]

_REQUIRED_ANY = (
    "NAME_PLACEHOLDER",
    "{{{SUMMARY_PLACEHOLDER}}}",
    "{{{EXPERIENCE_PLACEHOLDER}}}",
)


def sanitize_and_validate_latex(raw: str | bytes) -> str:
    if isinstance(raw, bytes):
        if len(raw) > _MAX_TEX_BYTES:
            raise ValueError("Template too large (max 200KB).")
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ValueError("Template must be UTF-8 text (.tex).") from exc
    else:
        text = raw
    text = text.replace("\x00", "")
    if len(text.encode("utf-8")) > _MAX_TEX_BYTES:
        raise ValueError("Template too large (max 200KB).")
    if "\\documentclass" not in text:
        raise ValueError("Template must include \\documentclass.")
    if "\\begin{document}" not in text or "\\end{document}" not in text:
        raise ValueError("Template must include \\begin{document} ... \\end{document}.")
    # Strip TeX comments before scanning for escapes (sample docs mention \\write18).
    code_only = re.sub(r"(?<!\\)%[^\n]*", "", text)
    for pat in _FORBIDDEN:
        if pat.search(code_only):
            raise ValueError(
                "Template contains a disallowed TeX command (shell/file escape). "
                "Remove \\write18, \\input{|...}, \\openout, \\directlua, etc."
            )
    missing = [tok for tok in _REQUIRED_ANY if tok not in text]
    if missing:
        raise ValueError(
            "Template is missing required placeholders: "
            + ", ".join(missing)
            + ". Download the sample .tex for the full list."
        )
    return text
