"""Summarised conversation history, per user and per document.

Each document keeps its RECENT_LIMIT most recent questions word for word. When there are more,
the oldest COMPRESS_BATCH are folded into a short running summary (by the language model when one
is configured, otherwise by a simple built-in summariser), so storage stays small however long a
session runs, and follow-up questions can still refer to things asked long ago.

Files: data/history/<user>/<doc_id>.json, written atomically under a lock. Folding runs in a
background thread so it never slows down an answer.
"""

from __future__ import annotations

import json
import logging
import re
import threading
from pathlib import Path
from typing import Any

from retrieval import llm_client

from . import paths, registry

logger = logging.getLogger("smartchunk.memory")

RECENT_LIMIT = 12
COMPRESS_BATCH = 6
ANSWER_CHARS = 1200
SUMMARY_CHARS = 2400
BACKGROUND = True  # tests switch this off to fold synchronously

SUMMARY_INSTRUCTIONS = (
    "You keep a compact running summary of a question-and-answer session about one document. "
    "Merge the new exchanges into the existing summary. Keep the facts, figures and names the answers "
    "found, and note questions the document could not answer. At most 120 words, plain text, no preamble."
)

_lock = threading.RLock()
_folding: set[tuple[str, str]] = set()
_SAFE = re.compile(r"[^a-z0-9_.-]")


def _file(user: str, doc_id: str) -> Path:
    folder = _SAFE.sub("_", user.lower()) or "guest"
    return paths.data_dir() / "history" / folder / f"{_SAFE.sub('_', doc_id)}.json"


def _empty(doc_id: str, filename: str) -> dict[str, Any]:
    return {
        "doc_id": doc_id,
        "filename": filename,
        "summary": "",
        "summarized_questions": 0,
        "counts": {"questions": 0, "smart": 0, "naive": 0, "compare": 0, "not_found": 0},
        "recent": [],
        "updated_at": None,
    }


def _load(user: str, doc_id: str, filename: str = "") -> dict[str, Any]:
    file = _file(user, doc_id)
    if file.exists():
        try:
            data = json.loads(file.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("recent"), list):
                base = _empty(doc_id, filename)
                base.update(data)
                base["counts"] = {**_empty(doc_id, filename)["counts"], **data.get("counts", {})}
                return base
        except (OSError, ValueError):
            logger.warning("History file %s is unreadable; starting a new one.", file)
    return _empty(doc_id, filename)


def _save(user: str, doc_id: str, data: dict[str, Any]) -> None:
    file = _file(user, doc_id)
    file.parent.mkdir(parents=True, exist_ok=True)
    tmp = file.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(file)


def _clip(text: str, limit: int) -> str:
    text = text.strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def get(user: str, doc_id: str, filename: str = "") -> dict[str, Any]:
    with _lock:
        data = _load(user, doc_id, filename)
    if filename:
        data["filename"] = filename
    return data


def summary_for(user: str, doc_id: str) -> str:
    with _lock:
        return str(_load(user, doc_id).get("summary", ""))


def record(
    user: str,
    doc_id: str,
    filename: str,
    question: str,
    method: str,
    answer: str,
    naive_answer: str | None,
    not_found: bool,
) -> None:
    """Adds one asked question. `method` is "smart", "naive" or "compare"."""
    entry = {
        "question": _clip(question, 500),
        "method": method,
        "answer": _clip(answer, ANSWER_CHARS),
        "naive_answer": _clip(naive_answer, ANSWER_CHARS) if naive_answer is not None else None,
        "not_found": bool(not_found),
        "asked_at": registry.now_iso(),
    }
    with _lock:
        data = _load(user, doc_id, filename)
        data["filename"] = filename or data.get("filename", "")
        data["recent"].append(entry)
        counts = data["counts"]
        counts["questions"] += 1
        counts[method] = counts.get(method, 0) + 1
        counts["not_found"] += 1 if not_found else 0
        data["updated_at"] = entry["asked_at"]
        _save(user, doc_id, data)
        needs_fold = len(data["recent"]) > RECENT_LIMIT and (user, doc_id) not in _folding
        if needs_fold:
            _folding.add((user, doc_id))
    if needs_fold:
        if BACKGROUND:
            threading.Thread(target=_fold, args=(user, doc_id), name=f"history-{doc_id}", daemon=True).start()
        else:
            _fold(user, doc_id)


def _fallback_summary(previous: str, batch: list[dict[str, Any]]) -> str:
    lines = [previous.strip()] if previous.strip() else []
    for item in batch:
        first = re.split(r"(?<=[.!?])\s", item["answer"].strip().replace("\n", " "), maxsplit=1)[0]
        status = "not found in the document" if item["not_found"] else _clip(first, 160)
        lines.append(f"- {item['question']} → {status}")
    text = "\n".join(lines)
    if len(text) > SUMMARY_CHARS:  # keep the newest lines
        text = text[-SUMMARY_CHARS:]
        text = text[text.find("\n") + 1 :] if "\n" in text else text
    return text


def _summarise(previous: str, batch: list[dict[str, Any]]) -> str:
    if not llm_client.is_configured():
        return _fallback_summary(previous, batch)
    exchanges = "\n\n".join(
        f"Q: {item['question']}\nA: {_clip(item['answer'], 600)}"
        + (f"\nTraditional chunker's answer: {_clip(item['naive_answer'], 300)}" if item.get("naive_answer") else "")
        for item in batch
    )
    try:
        text, _ = llm_client.generate(
            [
                {"role": "system", "content": SUMMARY_INSTRUCTIONS},
                {"role": "user", "content": f"Current summary:\n{previous or '(none yet)'}\n\nNew exchanges:\n{exchanges}"},
            ],
            temperature=0,
            max_tokens=300,
        )
        return _clip(text, SUMMARY_CHARS) or _fallback_summary(previous, batch)
    except (llm_client.LlmError, llm_client.LlmNotConfigured) as error:
        logger.warning("History summary fell back to the built-in summariser: %s", error)
        return _fallback_summary(previous, batch)


def _fold(user: str, doc_id: str) -> None:
    """Folds the oldest questions into the summary until RECENT_LIMIT or fewer remain."""
    try:
        while True:
            with _lock:
                data = _load(user, doc_id)
                if len(data["recent"]) <= RECENT_LIMIT:
                    return
                batch = data["recent"][:COMPRESS_BATCH]
                previous = data["summary"]
            summary = _summarise(previous, batch)  # slow part, outside the lock
            with _lock:
                data = _load(user, doc_id)
                if data["recent"][: len(batch)] != batch:
                    continue  # history was cleared or changed meanwhile; look again
                data["summary"] = summary
                data["summarized_questions"] += len(batch)
                data["recent"] = data["recent"][len(batch) :]
                _save(user, doc_id, data)
    except Exception:  # noqa: BLE001 - history must never break chat
        logger.exception("Folding history for %s failed.", doc_id)
    finally:
        with _lock:
            _folding.discard((user, doc_id))


def list_for(user: str, doc_ids: dict[str, str]) -> list[dict[str, Any]]:
    """Histories with at least one question, newest first. `doc_ids` maps doc_id -> filename."""
    out = []
    with _lock:
        for doc_id, filename in doc_ids.items():
            if _file(user, doc_id).exists():
                data = _load(user, doc_id, filename)
                data["filename"] = filename
                if data["counts"]["questions"] > 0:
                    out.append(data)
    return sorted(out, key=lambda item: item.get("updated_at") or "", reverse=True)


def clear(user: str, doc_id: str) -> None:
    with _lock:
        _file(user, doc_id).unlink(missing_ok=True)
