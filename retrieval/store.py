"""ChromaDB storage (spec B5).

One persistent client per process (path from CHROMA_PATH, default ./chroma_db). Collections are
named smart_<doc_id>, naive_<doc_id> and summary_<doc_id>, use cosine space, and always receive
embeddings from us (Chroma never embeds). Chroma metadata cannot hold lists, so heading_path is
stored as a JSON string, and page is stored as an int with -1 meaning null.
"""

from __future__ import annotations

import json
import os
import threading
from typing import Any

import numpy as np

from smartchunk.models import Chunk

_lock = threading.Lock()
_client: Any = None
_client_path: str | None = None
ADD_BATCH = 500


def chroma_path() -> str:
    return os.getenv("CHROMA_PATH", "./chroma_db")


def get_client() -> Any:
    """Persistent client for the current CHROMA_PATH (re-created if the path changes, e.g. in tests)."""
    global _client, _client_path
    path = chroma_path()
    with _lock:
        if _client is None or _client_path != path:
            import chromadb
            from chromadb.config import Settings as ChromaSettings

            os.makedirs(path, exist_ok=True)
            _client = chromadb.PersistentClient(path=path, settings=ChromaSettings(anonymized_telemetry=False))
            _client_path = path
        return _client


def collection_name(kind: str, doc_id: str) -> str:
    return f"{kind}_{doc_id}"


def collection_exists(name: str) -> bool:
    try:
        get_client().get_collection(name=name, embedding_function=None)
        return True
    except Exception:  # noqa: BLE001 - Chroma raises different types across versions
        return False


def _delete(name: str) -> None:
    try:
        get_client().delete_collection(name=name)
    except Exception:  # noqa: BLE001 - missing collection is fine
        pass


def _create(name: str) -> Any:
    _delete(name)
    return get_client().create_collection(
        name=name, metadata={"hnsw:space": "cosine"}, embedding_function=None
    )


def _metadata(chunk: Chunk) -> dict[str, Any]:
    return {
        "source": chunk.source,
        "page": -1 if chunk.page is None else int(chunk.page),
        "heading_path": json.dumps(chunk.heading_path, ensure_ascii=False),
        "type": chunk.type,
        "token_count": int(chunk.token_count),
    }


def _chunk_from(chunk_id: str, document: str, meta: dict[str, Any]) -> Chunk:
    page = int(meta.get("page", -1))
    try:
        heading_path = json.loads(meta.get("heading_path", "[]"))
    except (TypeError, ValueError):
        heading_path = []
    return Chunk(
        chunk_id=chunk_id,
        text=document,
        source=str(meta.get("source", "")),
        page=None if page < 0 else page,
        heading_path=[str(item) for item in heading_path],
        type=meta.get("type", "prose"),
        token_count=int(meta.get("token_count", 0)),
    )


def build_collection(name: str, chunks: list[Chunk], embeddings: np.ndarray) -> None:
    """(Re)creates a collection holding these chunks and their embeddings."""
    if len(chunks) != len(embeddings):
        raise ValueError("chunks and embeddings must have the same length")
    collection = _create(name)
    for start in range(0, len(chunks), ADD_BATCH):
        batch = chunks[start : start + ADD_BATCH]
        collection.add(
            ids=[chunk.chunk_id for chunk in batch],
            documents=[chunk.text for chunk in batch],
            embeddings=[vector.tolist() for vector in embeddings[start : start + ADD_BATCH]],
            metadatas=[_metadata(chunk) for chunk in batch],
        )


def query_collection(name: str, query_embedding: np.ndarray, top_k: int) -> list[tuple[Chunk, float]]:
    """Top-k chunks with cosine scores in [0, 1], best first."""
    collection = get_client().get_collection(name=name, embedding_function=None)
    count = collection.count()
    if count == 0:
        return []
    result = collection.query(
        query_embeddings=[query_embedding.tolist()],
        n_results=min(top_k, count),
        include=["documents", "metadatas", "distances"],
    )
    ids = result.get("ids", [[]])[0]
    documents = result.get("documents", [[]])[0]
    metadatas = result.get("metadatas", [[]])[0]
    distances = result.get("distances", [[]])[0]
    hits = [
        (_chunk_from(chunk_id, document or "", meta or {}), max(0.0, min(1.0, 1.0 - float(distance))))
        for chunk_id, document, meta, distance in zip(ids, documents, metadatas, distances)
    ]
    return sorted(hits, key=lambda item: item[1], reverse=True)


def store_summary(doc_id: str, summary: str, key_topics: list[str], suggested_questions: list[str], embedding: np.ndarray) -> None:
    collection = _create(collection_name("summary", doc_id))
    collection.add(
        ids=[f"{doc_id}_summary"],
        documents=[summary or " "],
        embeddings=[embedding.tolist()],
        metadatas=[
            {
                "key_topics": json.dumps(key_topics, ensure_ascii=False),
                "suggested_questions": json.dumps(suggested_questions, ensure_ascii=False),
            }
        ],
    )


def delete_collections(doc_id: str) -> None:
    for kind in ("smart", "naive", "summary"):
        _delete(collection_name(kind, doc_id))


def reset_for_tests() -> None:
    global _client, _client_path
    with _lock:
        _client = None
        _client_path = None
