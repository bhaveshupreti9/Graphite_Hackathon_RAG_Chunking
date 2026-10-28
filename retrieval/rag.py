"""Retrieval-augmented answering (spec B5). Identical for both methods except the collection used."""

from __future__ import annotations

import os
import time
from typing import Any

from smartchunk.config import Settings
from smartchunk.models import Chunk
from smartchunk.tokenizer import count_tokens

from . import llm_client
from .embedder import embed_texts
from .store import collection_name, query_collection

NOT_FOUND_ANSWER = "Not found in the document."
COMPLETION_BUDGET = 512
MAX_HISTORY = 6

PROMPT_HEADER = (
    "You are a helpful assistant answering questions about the user's document.\n"
    "Use the context below as your main source, and cite it as [heading path, page] when available.\n"
    "- If the context answers the question, answer from it. Keep code and tables exactly as given.\n"
    "- If the context only partly answers it, answer what the context supports, then add reasonable "
    "inferences or general knowledge in a final section that starts with the line 'Beyond the document:'.\n"
    "- If the context does not cover the question, say so in one sentence, then give a short, helpful "
    "answer in a final section that starts with the line 'Beyond the document:'.\n"
    "- Never present general knowledge as if it came from the document.\n"
    "- When the answer lists several items with properties, compares things, or reports figures, "
    "format it as a Markdown table.\n"
    "- For spreadsheet data, use the 'Column overview' table for totals, averages, minimums and maximums "
    "over the whole sheet, and say which rows you used for anything you compute yourself."
)

REWRITE_INSTRUCTIONS = (
    "Rewrite the user's last question so it can be understood without the conversation. "
    "Keep it short, keep the user's wording where possible, and reply with the question only."
)


def context_window_limit() -> int:
    try:
        return int(os.getenv("CONTEXT_WINDOW_LIMIT", "8192"))
    except ValueError:
        return 8192


def _source_line(chunk: Chunk) -> str:
    parts = []
    if chunk.heading_path:
        parts.append(" > ".join(chunk.heading_path))
    if chunk.page is not None:
        parts.append(f"page {chunk.page}")
    parts.append(chunk.type)
    return f"[Source: {' | '.join(parts)}]"


def build_prompt(chunks: list[Chunk], question: str) -> str:
    context = "\n\n".join(f"[{i + 1}] {_source_line(chunk)}\n{chunk.text}" for i, chunk in enumerate(chunks))
    return f"{PROMPT_HEADER}\n\nContext:\n{context}\n\nQuestion: {question}"


def rewrite_question(question: str, history: list[dict[str, str]], memory_summary: str = "") -> str:
    """Standalone version of a follow-up question (temperature 0). Same for both methods.

    `memory_summary` is the rolling summary of older questions in this document's history, so a
    follow-up can refer to something asked long ago without sending the whole conversation."""
    if not history:
        return question
    transcript = "\n".join(f"{turn['role']}: {turn['content']}" for turn in history[-MAX_HISTORY:])
    earlier = f"Summary of earlier questions:\n{memory_summary.strip()}\n\n" if memory_summary.strip() else ""
    text, _ = llm_client.generate(
        [
            {"role": "system", "content": REWRITE_INSTRUCTIONS},
            {"role": "user", "content": f"{earlier}Conversation:\n{transcript}\n\nLast question: {question}"},
        ],
        temperature=0,
        max_tokens=120,
    )
    rewritten = text.strip().strip('"').strip()
    return rewritten or question


def answer_question(
    doc_id: str,
    method: str,
    question: str,
    history: list[dict[str, str]],
    settings: Settings,
    *,
    memory_summary: str = "",
    standalone: str | None = None,
) -> dict[str, Any]:
    """Returns a dict shaped exactly like ChatResult (spec A6).

    Pass `standalone` when the question was already rewritten (Compare asks both methods the same
    question, so it rewrites once instead of twice)."""
    started = time.perf_counter()
    history = history[-MAX_HISTORY:]
    if standalone is None:
        standalone = rewrite_question(question, history, memory_summary)

    query = embed_texts([standalone])[0]
    hits = query_collection(collection_name(method, doc_id), query, settings.top_k)
    retrieved = [{"chunk": chunk.to_dict(), "score": round(score, 4)} for chunk, score in hits]
    limit = context_window_limit()

    best = hits[0][1] if hits else 0.0
    if not hits or best < settings.not_found_threshold:
        return {
            "method": method,
            "answer": NOT_FOUND_ANSWER,
            "standalone_question": standalone,
            "sources": [],
            "retrieved_chunks": retrieved,
            "prompt_sent": "",
            "tokens_used": {"prompt": 0, "completion": 0, "total": 0},
            "context_window_limit": limit,
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "not_found": True,
        }

    used = [chunk for chunk, _ in hits]
    prompt = build_prompt(used, standalone)
    while len(used) > 1 and count_tokens(prompt) + COMPLETION_BUDGET > limit:
        used = used[:-1]  # hits are sorted best first, so this drops the lowest score
        prompt = build_prompt(used, standalone)

    answer, usage = llm_client.generate(
        [{"role": "user", "content": prompt}], temperature=0, max_tokens=COMPLETION_BUDGET
    )
    prompt_tokens = usage.prompt if usage else count_tokens(prompt)
    completion_tokens = usage.completion if usage else count_tokens(answer)

    return {
        "method": method,
        "answer": answer.strip(),
        "standalone_question": standalone,
        "sources": [
            {"chunk_id": chunk.chunk_id, "heading_path": list(chunk.heading_path), "page": chunk.page}
            for chunk in used
        ],
        "retrieved_chunks": retrieved,
        "prompt_sent": prompt,
        "tokens_used": {"prompt": prompt_tokens, "completion": completion_tokens, "total": prompt_tokens + completion_tokens},
        "context_window_limit": limit,
        "latency_ms": int((time.perf_counter() - started) * 1000),
        "not_found": False,
    }
