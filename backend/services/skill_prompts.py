"""Load ATS / humanizer skill prompts from backend/skills/."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

_SKILLS = Path(__file__).resolve().parent.parent / "skills"


@lru_cache(maxsize=8)
def load_skill(name: str) -> str:
    path = _SKILLS / name
    if not path.exists():
        return ""
    text = path.read_text(encoding="utf-8").strip()
    # Drop markdown title noise for system prompts
    if text.startswith("#"):
        lines = text.splitlines()
        # keep from first non-heading block after front matter
        while lines and (not lines[0].strip() or lines[0].startswith("#")):
            lines.pop(0)
        text = "\n".join(lines).strip()
    return text


def ats_system_prompt(fallback: str) -> str:
    skill = load_skill("ats_critic_prompt.md")
    if not skill:
        return fallback
    return (
        f"{fallback}\n\n"
        "## Additional ATS verification skill rules\n"
        f"{skill}\n\n"
        "Still output the structured ATSCritique schema used by this app "
        "(ats_alignment_pct, matched/missing keywords, issues[] of "
        "{tier, owner, reason, evidence, direction}). "
        "Never invent MASTER CV facts."
    )


def humanizer_system_prompt() -> str:
    skill = load_skill("humanizer_prompt.md")
    tells = load_skill("ai-tells.md")
    base = skill or (
        "Rewrite CV/cover wording so it sounds human. Never invent facts. "
        "No em dashes. Strip AI tells."
    )
    if tells:
        base = f"{base}\n\n## AI tells reference\n{tells}"
    return base
