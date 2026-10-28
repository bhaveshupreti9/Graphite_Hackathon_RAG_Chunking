"""Background processing jobs with in-memory status (spec A8, B6).

Job status lives in this process's memory, so run uvicorn with ONE worker. Progress follows the A8
table and never goes down. Every exception inside a job is caught and recorded as status "error"
with a readable message, so the status never gets stuck.
"""

from __future__ import annotations

import logging
import threading
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from baseline.naive import naive_chunk_document
from retrieval import store
from retrieval.embedder import embed_texts
from smartchunk.chunker import chunk_document
from smartchunk.config import Settings
from smartchunk.damage import count_structural_damage
from smartchunk.errors import EmptyDocumentError, EncryptedPdfError, ScannedPdfError, UnsupportedFileError
from smartchunk.exporter import to_jsonl
from smartchunk.stats import method_stats

from . import paths, registry, summarizer

logger = logging.getLogger("smartchunk.jobs")

STEP_PROGRESS = {
    "uploaded": 0,
    "parsing": 10,
    "cleaning": 25,
    "semantic_split": 40,
    "dedup": 60,
    "embedding": 70,
    "storing": 85,
    "summarizing": 92,
    "done": 100,
}


@dataclass
class JobState:
    doc_id: str
    status: str = "running"
    step: str = "uploaded"
    progress: int = 0
    error_message: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "doc_id": self.doc_id,
            "status": self.status,
            "step": self.step,
            "progress": self.progress,
            "error_message": self.error_message,
        }


_jobs: dict[str, JobState] = {}
_lock = threading.Lock()


def get_state(doc_id: str) -> JobState | None:
    with _lock:
        return _jobs.get(doc_id)


def is_running(doc_id: str) -> bool:
    state = get_state(doc_id)
    return state is not None and state.status == "running"


def forget(doc_id: str) -> None:
    with _lock:
        _jobs.pop(doc_id, None)


def _set_step(state: JobState, step: str) -> None:
    with _lock:
        state.step = step
        state.progress = max(state.progress, STEP_PROGRESS[step])


def start(doc_id: str, settings: Settings) -> bool:
    """Starts a job; returns False if one is already running for this document."""
    with _lock:
        current = _jobs.get(doc_id)
        if current is not None and current.status == "running":
            return False
        state = JobState(doc_id=doc_id)
        _jobs[doc_id] = state
    registry.update(doc_id, status="processing", error_message=None, settings=settings.to_dict())
    thread = threading.Thread(target=_run, args=(state, settings), name=f"process-{doc_id}", daemon=True)
    thread.start()
    return True


def friendly_error(error: Exception) -> str:
    if isinstance(error, ScannedPdfError):
        return "This PDF contains only images. OCR is not supported."
    if isinstance(error, EncryptedPdfError):
        return "This PDF is password protected."
    if isinstance(error, EmptyDocumentError):
        return "No extractable text was found in the document."
    if isinstance(error, UnsupportedFileError):
        return str(error)
    return f"Processing failed: {type(error).__name__}: {error}"


def _run(state: JobState, settings: Settings) -> None:
    doc_id = state.doc_id
    try:
        entry = registry.get(doc_id)
        if entry is None:
            raise RuntimeError("The document was deleted while processing.")
        path = Path(entry["path"])
        source = entry["filename"]

        # A re-run replaces everything from the previous run.
        store.delete_collections(doc_id)

        _set_step(state, "parsing")
        naive = naive_chunk_document(path, settings, doc_id, source)
        result = chunk_document(path, settings, doc_id, source, on_step=lambda step: _set_step(state, step))

        _set_step(state, "embedding")
        smart_vectors = embed_texts([chunk.text for chunk in result.chunks])
        naive_vectors = embed_texts([chunk.text for chunk in naive])

        _set_step(state, "storing")
        store.build_collection(store.collection_name("smart", doc_id), result.chunks, smart_vectors)
        store.build_collection(store.collection_name("naive", doc_id), naive, naive_vectors)
        to_jsonl(result.chunks, paths.jsonl_path(doc_id, "smart"))
        to_jsonl(naive, paths.jsonl_path(doc_id, "naive"))

        _set_step(state, "summarizing")
        summary, topics, questions, summary_warnings = summarizer.summarize(result.chunks)
        store.store_summary(doc_id, summary, topics, questions, embed_texts([summary or source])[0])

        smart_damage = count_structural_damage(result.raw_blocks, result.chunks, result.oversized_blocks)
        naive_damage = count_structural_damage(result.raw_blocks, naive)
        process_result = {
            "doc_id": doc_id,
            "smart_stats": method_stats(
                result.chunks,
                smart_damage,
                smart=True,
                exact_removed=result.exact_duplicates_removed,
                near_removed=result.near_duplicates_removed,
                noise_removed=result.noise_lines_removed,
            ),
            "naive_stats": method_stats(naive, naive_damage, smart=False),
            "removed_report": {"items": [item.to_dict() for item in result.removed]},
            "settings": settings.to_dict(),
            "warnings": [*entry.get("upload_warnings", []), *result.warnings, *summary_warnings],
        }
        registry.update(
            doc_id,
            status="ready",
            pages=result.pages,
            smart_chunk_count=len(result.chunks),
            naive_chunk_count=len(naive),
            summary_preview=summary[:160],
            result=process_result,
            summary={"summary": summary, "key_topics": topics, "suggested_questions": questions},
            error_message=None,
        )
        with _lock:
            state.step = "done"
            state.progress = 100
            state.status = "done"
    except Exception as error:  # noqa: BLE001 - a job must always end in a known state
        logger.error("Processing %s failed: %s\n%s", doc_id, error, traceback.format_exc())
        message = friendly_error(error)
        with _lock:
            state.status = "error"
            state.error_message = message
        registry.update(doc_id, status="error", error_message=message)
