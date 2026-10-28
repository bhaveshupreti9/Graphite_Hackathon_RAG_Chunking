from __future__ import annotations

from pathlib import Path

import pytest

from retrieval import llm_client, rag, store
from retrieval.embedder import embed_texts
from smartchunk.chunker import chunk_document
from smartchunk.config import Settings


@pytest.fixture
def built(samples_dir: Path):
    store.reset_for_tests()
    result = chunk_document(samples_dir / "python_tutorial.md", Settings(), "doc_12345678")
    store.build_collection("smart_doc_12345678", result.chunks, embed_texts([c.text for c in result.chunks]))
    return result


def test_roundtrip_metadata_and_scores(built) -> None:
    query = embed_texts(["binary search code"])[0]
    hits = store.query_collection("smart_doc_12345678", query, 5)
    assert 1 <= len(hits) <= 5
    scores = [score for _, score in hits]
    assert scores == sorted(scores, reverse=True)
    assert all(0.0 <= score <= 1.0 for score in scores)
    chunk = hits[0][0]
    assert isinstance(chunk.heading_path, list)
    assert chunk.page is None  # stored as -1, read back as null
    assert store.collection_exists("smart_doc_12345678")
    store.delete_collections("doc_12345678")
    assert not store.collection_exists("smart_doc_12345678")


def test_not_found_does_not_call_llm(built, monkeypatch: pytest.MonkeyPatch) -> None:
    called = []
    monkeypatch.setattr(llm_client, "generate", lambda *a, **k: called.append(1) or ("x", None))
    settings = Settings(not_found_threshold=0.99)
    result = rag.answer_question("doc_12345678", "smart", "weather in Paris", [], settings)
    assert result["not_found"] is True
    assert result["sources"] == []
    assert result["tokens_used"] == {"prompt": 0, "completion": 0, "total": 0}
    assert result["retrieved_chunks"]
    assert called == []


def test_answer_with_fake_llm_and_follow_up(built, monkeypatch: pytest.MonkeyPatch) -> None:
    prompts: list[list[dict[str, str]]] = []

    def fake_generate(messages, temperature=0, max_tokens=512):
        prompts.append(messages)
        if "Rewrite" in messages[0]["content"]:
            return "What is the time complexity of binary search?", None
        return "O(log n) [Algorithms > Search > Binary Search]", llm_client.Usage(100, 12)

    monkeypatch.setattr(llm_client, "generate", fake_generate)
    settings = Settings(not_found_threshold=0.0)
    history = [{"role": "user", "content": "Tell me about binary search"}, {"role": "assistant", "content": "It halves the range."}]
    result = rag.answer_question("doc_12345678", "smart", "what is its complexity?", history, settings)
    assert result["not_found"] is False
    assert result["standalone_question"] == "What is the time complexity of binary search?"
    assert result["tokens_used"] == {"prompt": 100, "completion": 12, "total": 112}
    assert result["prompt_sent"].startswith("You are a helpful assistant")
    assert result["sources"]
    assert result["context_window_limit"] == 8192
    assert all(prompt[-1]["role"] == "user" for prompt in prompts)


def test_llm_not_configured(built) -> None:
    with pytest.raises(llm_client.LlmNotConfigured):
        rag.answer_question("doc_12345678", "smart", "binary search", [], Settings(not_found_threshold=0.0))
