"""
Manual check for services/text_cleanup.py.

Uses a fake LLM so this runs offline, no live provider needed.
Run with: python test_text_cleanup.py
"""

import asyncio
from unittest.mock import patch

from services.text_cleanup import clean_candidate_text


class _FakeResponse:
    def __init__(self, content):
        self.content = content


class _FakeLLM:
    def __init__(self, content=None, raise_error=False):
        self._content = content
        self._raise = raise_error

    async def ainvoke(self, messages):
        if self._raise:
            raise RuntimeError("provider down")
        return _FakeResponse(self._content)


async def main():
    # empty input → no LLM call, returns as-is
    assert await clean_candidate_text("   ", "test") == ""

    # happy path → returns cleaned text
    with patch(
        "services.text_cleanup.get_llm", return_value=_FakeLLM("Cleaned sentence.")
    ):
        result = await clean_candidate_text("messy text pls fix", "candidate summary")
        assert result == "Cleaned sentence.", result

    # LLM failure → falls back to raw text, never raises
    with patch(
        "services.text_cleanup.get_llm", return_value=_FakeLLM(raise_error=True)
    ):
        result = await clean_candidate_text("keep me as-is", "candidate summary")
        assert result == "keep me as-is", result

    print("all checks passed")


if __name__ == "__main__":
    asyncio.run(main())
