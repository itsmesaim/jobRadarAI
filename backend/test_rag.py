"""
Manual check for the RAG retrieval helpers in services/vectorstore.py.

No live LLM/embedding provider needed — uses a deterministic fake Embeddings
so this runs offline. Run with: python test_rag.py
"""

import asyncio

from services.vectorstore import build_faiss_index, chunk_text, retrieve_top_k


class FakeEmbeddings:
    """Deterministic bag-of-words embedding so retrieval results are checkable."""

    VOCAB = ["python", "kubernetes", "react", "mongodb"]

    def _vec(self, text: str) -> list[float]:
        t = text.lower()
        raw = [float(t.count(w)) for w in self.VOCAB]
        # Normalize to unit length so FAISS's L2 ranking matches cosine
        # similarity ranking (||a-b||^2 = 2 - 2*a.b for unit vectors).
        norm = sum(x * x for x in raw) ** 0.5
        return [x / norm for x in raw] if norm else raw

    def embed_documents(self, texts):
        return [self._vec(t) for t in texts]

    async def aembed_query(self, text):
        return self._vec(text)


def demo():
    long_jd = (
        "Intro paragraph about the company culture and benefits. " * 30
        + "Required skills: python and mongodb experience is mandatory. "
        + "Nice to have: kubernetes and react exposure. "
        + "Filler paragraph about the office and perks. " * 30
    )

    chunks = chunk_text(long_jd, chunk_size=200, overlap=20)
    assert len(chunks) > 5, "expected the long JD to split into multiple chunks"

    old_truncation_cutoff = 400
    assert len(long_jd) > old_truncation_cutoff, "test JD must exceed old truncation"
    tail_content = "Required skills: python and mongodb"
    assert (
        tail_content not in long_jd[:old_truncation_cutoff]
    ), "test setup bug: the requirements line must fall past the old cutoff"

    fake = FakeEmbeddings()
    vecs = fake.embed_documents(chunks)
    metadatas = [{"order": i} for i in range(len(chunks))]
    index = build_faiss_index(chunks, vecs, fake, metadatas=metadatas)
    assert index is not None

    query_vec = asyncio.run(
        fake.aembed_query("candidate skilled in python and mongodb")
    )
    results = retrieve_top_k(index, query_vec, k=3)
    assert results, "expected at least one retrieved chunk"

    retrieved_text = "\n\n".join(r.page_content for r in results)
    assert len(retrieved_text) < len(
        long_jd
    ), "retrieval should be shorter than the full doc"
    assert (
        "python" in retrieved_text.lower() and "mongodb" in retrieved_text.lower()
    ), "retrieval should surface the requirements chunk that naive truncation would have dropped"

    print(
        "OK — retrieval reaches tail content the old fixed-char truncation would drop"
    )


if __name__ == "__main__":
    demo()
