"""
Thin FAISS retrieval helpers shared by the rating pipeline.

FAISS indexes here are always rebuilt in-memory from embeddings already
cached in MongoDB (jd_embedding, jd_chunks[].embedding) — there is no
persistent vector store. Mongo stays the single source of truth; FAISS is
just an ANN accelerator over vectors we already have.
"""

from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter


def chunk_text(text: str, chunk_size: int = 800, overlap: int = 100) -> list[str]:
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size, chunk_overlap=overlap
    )
    return splitter.split_text(text or "")


def build_faiss_index(
    texts: list[str],
    embeddings: list[list[float]],
    embedding_model: Embeddings,
    metadatas: list[dict] | None = None,
) -> FAISS | None:
    """Build an in-memory FAISS index from precomputed embeddings (no re-embedding).

    embedding_model is only stored on the index for interface completeness
    (FAISS.from_embeddings requires it) — queries always go through
    retrieve_top_k, which uses precomputed query vectors, never re-embeds.
    """
    if not texts or not embeddings or len(texts) != len(embeddings):
        return None
    text_embeddings = list(zip(texts, embeddings))
    return FAISS.from_embeddings(
        text_embeddings,
        embedding=embedding_model,
        metadatas=metadatas,
    )


def retrieve_top_k(
    index: FAISS, query_embedding: list[float], k: int = 6
) -> list[Document]:
    if not index:
        return []
    return index.similarity_search_by_vector(query_embedding, k=k)
