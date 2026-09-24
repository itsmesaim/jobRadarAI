"""FAQ RAG for product questions (who built / why / how to use).

Loads backend/data/faq/jobradar_faq.json. Prefers embedding+FAISS when OpenAI
embeddings are configured; otherwise alias/keyword overlap. Answers are
canned FAQ text (no free invention).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from services.prompt_safety import fence

_FAQ_PATH = (
    Path(__file__).resolve().parent.parent / "data" / "faq" / "jobradar_faq.json"
)

_PRODUCT = re.compile(
    r"\b(who (built|made|created|developed)|why (was |did )?(you |this |jobradar )?(built|exist|made)|"
    r"what (is|does) jobradar|how (do i|to) use|getting started|tutorial|"
    r"apply pack|tailored cv|job sources?|jooble|indeed|greenhouse|privacy|"
    r"token limit|which model|what is track|kanban|pipeline|"
    r"what can i ask|chat rules|founder|saim|"
    r"junior|senior|wrong (jobs|roles)|irrelevant|not (my|getting) |"
    r"experience level|proper roles)\b",
    re.I,
)

_INJECTION = re.compile(
    r"(ignore (all |previous )?instructions|system prompt|jailbreak|"
    r"<\s*script|javascript:|<<<|END_[A-Z]+>>>)",
    re.I,
)


def sanitize_faq_query(text: str) -> str:
    text = (text or "").strip()
    text = "".join(ch for ch in text if ch in "\n\t" or ord(ch) >= 32)
    return text[:500]


def looks_like_product_question(text: str) -> bool:
    return bool(_PRODUCT.search(text or ""))


def looks_like_injection(text: str) -> bool:
    return bool(_INJECTION.search(text or ""))


_faq_cache: list[dict] | None = None
_faq_mtime: float | None = None


def _load_faq() -> list[dict]:
    global _faq_cache, _faq_mtime
    mtime = _FAQ_PATH.stat().st_mtime
    if _faq_cache is not None and _faq_mtime == mtime:
        return _faq_cache
    raw = json.loads(_FAQ_PATH.read_text(encoding="utf-8"))
    out = []
    for row in raw:
        q = (row.get("question") or "").strip()
        a = (
            (row.get("answer") or "")
            .strip()
            .replace("\u2014", "-")
            .replace("\u2013", "-")
        )
        if not q or not a:
            continue
        aliases = [str(x).strip() for x in (row.get("aliases") or []) if str(x).strip()]
        out.append(
            {
                "id": row.get("id") or q,
                "question": q,
                "answer": a,
                "aliases": aliases,
                "blob": " ".join([q, *aliases, a]).lower(),
            }
        )
    _faq_cache = out
    _faq_mtime = mtime
    return out


def list_faq() -> list[dict]:
    """Public list for Help UI (question + answer, no blobs)."""
    return [
        {"id": f["id"], "question": f["question"], "answer": f["answer"]}
        for f in _load_faq()
    ]


def _keyword_score(query: str, item: dict) -> float:
    q = query.lower()
    tokens = [t for t in re.split(r"[^a-z0-9]+", q) if len(t) >= 3]
    if not tokens:
        return 0.0
    blob = item["blob"]
    hits = sum(1 for t in tokens if t in blob)
    # Strong boost for alias / question phrase containment
    for alias in [item["question"].lower(), *item["aliases"]]:
        if alias and alias in q:
            hits += 4
        elif alias and q in alias:
            hits += 3
    return hits / max(len(tokens), 1)


def _retrieve_keyword(query: str, k: int = 3) -> list[tuple[dict, float]]:
    scored = [(_item, _keyword_score(query, _item)) for _item in _load_faq()]
    scored = [(it, s) for it, s in scored if s > 0]
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:k]


_index = None
_index_failed = False


def _get_vector_index():
    """Lazy FAISS over FAQ questions+aliases. None if embeddings unavailable."""
    global _index, _index_failed
    if _index is not None or _index_failed:
        return _index
    try:
        from langchain_community.vectorstores import FAISS
        from services.llm import get_embeddings

        emb = get_embeddings()
        texts = []
        metas = []
        for item in _load_faq():
            texts.append(item["question"])
            metas.append({"id": item["id"]})
            for alias in item["aliases"]:
                texts.append(alias)
                metas.append({"id": item["id"]})
        _index = FAISS.from_texts(texts, embedding=emb, metadatas=metas)
        return _index
    except Exception as exc:
        print(f"[faq_rag] embeddings unavailable, keyword only: {exc}", flush=True)
        _index_failed = True
        return None


def retrieve_faq(query: str, k: int = 3) -> list[dict]:
    """Return top FAQ rows for a query."""
    query = (query or "").strip()
    if not query:
        return []

    by_id = {f["id"]: f for f in _load_faq()}
    ranked: list[tuple[str, float]] = []

    idx = _get_vector_index()
    if idx is not None:
        try:
            docs = idx.similarity_search_with_score(query, k=max(k * 3, 6))
            # FAISS score: lower distance is better for L2
            for doc, dist in docs:
                fid = (doc.metadata or {}).get("id")
                if not fid or fid not in by_id:
                    continue
                score = 1.0 / (1.0 + float(dist))
                ranked.append((fid, score))
        except Exception as exc:
            print(f"[faq_rag] vector retrieve failed: {exc}", flush=True)

    for item, score in _retrieve_keyword(query, k=k + 2):
        ranked.append((item["id"], score + 0.15))  # slight keyword boost

    best: dict[str, float] = {}
    for fid, score in ranked:
        best[fid] = max(best.get(fid, 0.0), score)
    ordered = sorted(best.items(), key=lambda x: x[1], reverse=True)[:k]
    return [by_id[fid] for fid, _ in ordered if fid in by_id]


def answer_from_faq(query: str) -> dict | None:
    """
    Return {reply, faq_ids, refuse:false} if confident enough, else None.
    Uses top FAQ answers directly (no LLM) - free, canned, injection-safe.
    """
    query = sanitize_faq_query(query)
    if not query:
        return None
    if looks_like_injection(query):
        return {
            "refuse": True,
            "reply": (
                "That looks like an injection attempt, not a Help question.\n\n"
                "Ask about JobRadar itself (who built it, how Search works, "
                "why junior roles appear, privacy, models)."
            ),
            "answers": [],
            "faq_ids": [],
            "source": "faq_rag",
        }
    hits = retrieve_faq(query, k=3)
    if not hits:
        return None
    top = hits[0]
    kw = _keyword_score(query, top)
    # Weak match and not clearly a product ask → let job-chat LLM / refuse handle it
    if kw < 0.2 and not looks_like_product_question(query):
        return None
    # If the top hit is weak vs the query, do not answer from FAQ
    q_tokens = {t for t in re.split(r"[^a-z0-9]+", query.lower()) if len(t) >= 3}
    top_tokens = {t for t in re.split(r"[^a-z0-9]+", top["blob"]) if len(t) >= 3}
    overlap = len(q_tokens & top_tokens) / max(len(q_tokens), 1)
    if overlap < 0.2 and kw < 0.45:
        return None

    # One answer only - never glue a second unrelated FAQ onto the reply
    return {
        "refuse": False,
        "reply": top["answer"][:2500],
        "answers": [],
        "faq_ids": [top["id"]],
        "source": "faq_rag",
    }


def faq_context_fence(query: str) -> str:
    """Optional fenced context for LLM fallback (unused in v1 canned path)."""
    hits = retrieve_faq(query, k=3)
    if not hits:
        return ""
    body = "\n\n".join(f"Q: {h['question']}\nA: {h['answer']}" for h in hits)
    return fence("FAQ", body)


if __name__ == "__main__":
    assert looks_like_product_question("Who built JobRadar?")
    assert looks_like_product_question("How do I use this?")
    hits = retrieve_faq("who made this app")
    assert hits and hits[0]["id"] == "who-built"
    ans = answer_from_faq("why was this built")
    assert ans and "Job hunting" in ans["reply"]
    print("ok", [h["id"] for h in list_faq()])
