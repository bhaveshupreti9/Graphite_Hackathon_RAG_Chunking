"""The 16 REST endpoints of spec A7. Every response is validated against backend/schemas.py
(response_model), and every failure goes through ApiError so the frontend always gets the A4
error envelope."""

from __future__ import annotations

import json
import logging
import shutil
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, Header, Query, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import ValidationError

from retrieval import embedder, llm_client, rag, store
from smartchunk.config import Settings
from smartchunk.errors import EmptyDocumentError, EncryptedPdfError, ScannedPdfError, UnsupportedFileError
from smartchunk.exporter import read_jsonl
from smartchunk.pdf_loader import ALLOWED_EXTENSIONS, document_page_count, load_document

from . import auth, jobs, memory, paths, registry, summarizer
from .auth import current_user
from .errors import ApiError
from .schemas import (
    AuthResponse,
    Credentials,
    LogoutResponse,
    MeResponse,
    ChatRequest,
    ChatResult,
    ChunkPage,
    CompareRequest,
    CompareResult,
    DeleteResponse,
    DocHistory,
    DocSummary,
    DocumentInfo,
    EvaluationResult,
    HealthResponse,
    HistoryCleared,
    ProcessingStatus,
    ProcessRequest,
    ProcessResult,
    ProcessStartResponse,
    SampleInfo,
    SessionSummary,
    SessionSummaryRequest,
    UploadResponse,
    UploadSampleRequest,
)

router = APIRouter()
logger = logging.getLogger("smartchunk.api")

READ_BLOCK = 1024 * 1024


# Helpers ---------------------------------------------------------------------------------------


def _entry(doc_id: str, user: str) -> dict[str, Any]:
    entry = registry.get(doc_id)
    # Another user's document looks exactly like a missing one, so ids can't be probed.
    if entry is None or entry.get("owner", auth.GUEST) != user:
        raise ApiError("DOC_NOT_FOUND", f"No document with id {doc_id}.")
    return entry


def _ready_entry(doc_id: str, user: str) -> dict[str, Any]:
    """The document must exist, belong to the user, not be processing, and be processed."""
    entry = _entry(doc_id, user)
    if jobs.is_running(doc_id):
        raise ApiError("PROCESSING_IN_PROGRESS", "This document is still being processed. Try again shortly.")
    if entry.get("status") != "ready" or not entry.get("result"):
        raise ApiError("NOT_PROCESSED", "Process this document before using this feature.")
    return entry


def _settings_of(entry: dict[str, Any]) -> Settings:
    raw = entry.get("settings")
    return Settings.from_dict(raw) if raw else Settings()


def _validate_document(path: Path) -> tuple[int, list[str]]:
    """Parses the file once so broken uploads fail now (422) instead of later in processing."""
    try:
        pages, warnings = load_document(path)
    except ScannedPdfError as error:
        raise ApiError("SCANNED_PDF", "This PDF contains only images. OCR is not supported.") from error
    except EncryptedPdfError as error:
        raise ApiError("ENCRYPTED_PDF", "This PDF is password protected. Remove the password and upload again.") from error
    except EmptyDocumentError as error:
        raise ApiError("EMPTY_DOCUMENT", "No extractable text was found in this file.") from error
    except UnsupportedFileError as error:
        raise ApiError("INVALID_FILE_TYPE", str(error)) from error
    except Exception as error:  # noqa: BLE001 - a corrupt file should be a 422, not a 500
        raise ApiError("EMPTY_DOCUMENT", f"The file could not be read: {error}") from error
    if not any(page.text.strip() for page in pages):
        raise ApiError("EMPTY_DOCUMENT", "No extractable text was found in this file.")
    page_count = document_page_count(path)
    return page_count, warnings


def _safe_name(filename: str) -> str:
    name = Path(filename.replace("\\", "/")).name.strip()
    return name or "document"


def _register_file(source: Path | None, filename: str, owner: str, data: bytes | None = None) -> dict[str, Any]:
    extension = Path(filename).suffix.lower()
    doc_id = registry.new_doc_id()
    folder = paths.uploads_dir()
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / f"{doc_id}{extension}"
    if data is not None:
        target.write_bytes(data)
    elif source is not None:
        shutil.copyfile(source, target)
    try:
        page_count, warnings = _validate_document(target)
    except ApiError:
        target.unlink(missing_ok=True)
        raise
    size = target.stat().st_size
    registry.create(doc_id, filename, target, page_count, size, warnings, owner)
    return {"doc_id": doc_id, "filename": filename, "pages": page_count, "size_bytes": size, "warnings": warnings}


def _samples() -> dict[str, dict[str, str]]:
    folder = paths.samples_dir()
    meta_file = folder / "samples_meta.json"
    try:
        meta = json.loads(meta_file.read_text(encoding="utf-8")) if meta_file.exists() else {}
    except ValueError:
        meta = {}
    samples: dict[str, dict[str, str]] = {}
    if not folder.exists():
        return samples
    for file in sorted(folder.iterdir()):
        if not file.is_file() or file.suffix.lower() not in ALLOWED_EXTENSIONS:
            continue
        sample_id = file.stem
        info = meta.get(sample_id, {}) if isinstance(meta, dict) else {}
        samples[sample_id] = {
            "sample_id": sample_id,
            "title": str(info.get("title") or sample_id.replace("_", " ").title()),
            "description": str(info.get("description") or ""),
            "filename": file.name,
        }
    return samples


def _llm_call(function, *args):  # noqa: ANN001, ANN202 - thin wrapper that maps LLM failures
    try:
        return function(*args)
    except llm_client.LlmNotConfigured as error:
        raise ApiError(
            "LLM_NOT_CONFIGURED", "No language model is configured. Set LLM_API_KEY and LLM_BASE_URL in .env."
        ) from error
    except llm_client.LlmError as error:
        logger.warning("LLM request failed: %s", error)
        raise ApiError("LLM_ERROR", str(error)) from error


def _require_chunks(doc_id: str, method: str) -> None:
    if not store.collection_exists(store.collection_name(method, doc_id)):
        raise ApiError("NOT_PROCESSED", "The chunks for this document are missing. Process it again.")


def _answer(
    doc_id: str,
    method: str,
    question: str,
    history: list[dict[str, str]],
    settings: Settings,
    memory_summary: str = "",
    standalone: str | None = None,
) -> dict[str, Any]:
    _require_chunks(doc_id, method)
    return _llm_call(
        lambda: rag.answer_question(
            doc_id,
            method,
            question.strip(),
            history,
            settings,
            memory_summary=memory_summary,
            standalone=standalone,
        )
    )


def _remember(user: str, entry: dict[str, Any], question: str, method: str, answer: dict[str, Any],
              naive: dict[str, Any] | None = None) -> None:
    """Saves the exchange to the summarised history. Never lets a history problem break chat."""
    try:
        memory.record(
            user,
            entry["doc_id"],
            entry["filename"],
            question.strip(),
            method,
            answer["answer"],
            naive["answer"] if naive is not None else None,
            bool(answer["not_found"] and (naive is None or naive["not_found"])),
        )
    except Exception:  # noqa: BLE001
        logger.exception("Could not save chat history for %s.", entry.get("doc_id"))


# 1. Health -------------------------------------------------------------------------------------


@router.get("/health", response_model=HealthResponse)
def health() -> dict[str, Any]:
    return {"status": "ok", "embedding_model_loaded": embedder.is_loaded(), "llm_configured": llm_client.is_configured()}


# 2-4. Samples and uploads ----------------------------------------------------------------------


@router.get("/samples", response_model=list[SampleInfo])
def list_samples() -> list[dict[str, str]]:
    return list(_samples().values())


@router.post("/upload-sample", response_model=UploadResponse)
def upload_sample(body: UploadSampleRequest, user: str = Depends(current_user)) -> dict[str, Any]:
    sample = _samples().get(body.sample_id)
    if sample is None:
        raise ApiError("SAMPLE_NOT_FOUND", f"No sample called {body.sample_id}.")
    return _register_file(paths.samples_dir() / sample["filename"], sample["filename"], user)


@router.post("/upload", response_model=UploadResponse)
async def upload(file: UploadFile = File(...), user: str = Depends(current_user)) -> dict[str, Any]:
    filename = _safe_name(file.filename or "")
    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise ApiError(
            "INVALID_FILE_TYPE",
            "Supported files: PDF, Markdown (.md), text (.txt), CSV, TSV and Excel (.xlsx, .xlsm).",
        )
    limit = paths.max_upload_bytes()
    data = bytearray()
    while True:
        block = await file.read(READ_BLOCK)
        if not block:
            break
        data.extend(block)
        if len(data) > limit:
            raise ApiError("FILE_TOO_LARGE", f"The file is larger than {limit // (1024 * 1024)} MB.")
    if not data.strip():
        raise ApiError("EMPTY_DOCUMENT", "The file is empty.")
    return await run_in_threadpool(_register_file, None, filename, user, bytes(data))


# 5-7. Processing -------------------------------------------------------------------------------


@router.post("/process", response_model=ProcessStartResponse, status_code=status.HTTP_202_ACCEPTED)
def process(body: ProcessRequest, user: str = Depends(current_user)) -> dict[str, str]:
    _entry(body.doc_id, user)
    settings = Settings.from_dict(body.settings.model_dump())
    if not jobs.start(body.doc_id, settings):
        raise ApiError("PROCESSING_IN_PROGRESS", "This document is already being processed.")
    return {"doc_id": body.doc_id, "status": "started"}


@router.get("/processing-status/{doc_id}", response_model=ProcessingStatus)
def processing_status(doc_id: str, user: str = Depends(current_user)) -> dict[str, Any]:
    entry = _entry(doc_id, user)
    state = jobs.get_state(doc_id)
    if state is not None:
        return state.as_dict()
    # No job in memory (never processed, or the server restarted): derive it from the registry.
    saved = entry.get("status")
    if saved == "ready":
        return {"doc_id": doc_id, "status": "done", "step": "done", "progress": 100, "error_message": None}
    if saved == "error":
        return {"doc_id": doc_id, "status": "error", "step": "uploaded", "progress": 0,
                "error_message": entry.get("error_message") or "Processing failed."}
    if saved == "processing":
        message = "Processing was interrupted because the server restarted. Process the document again."
        registry.update(doc_id, status="error", error_message=message)
        return {"doc_id": doc_id, "status": "error", "step": "uploaded", "progress": 0, "error_message": message}
    return {"doc_id": doc_id, "status": "idle", "step": "uploaded", "progress": 0, "error_message": None}


@router.get("/process-result/{doc_id}", response_model=ProcessResult)
def process_result(doc_id: str, user: str = Depends(current_user)) -> dict[str, Any]:
    return _ready_entry(doc_id, user)["result"]


# 8-10. Chunks, export, summary -----------------------------------------------------------------


@router.get("/chunks", response_model=ChunkPage)
def chunks(
    doc_id: str,
    method: Literal["smart", "naive"],
    type: Literal["prose", "code", "table", "list"] | None = None,  # noqa: A002 - contract name
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    user: str = Depends(current_user),
) -> dict[str, Any]:
    _ready_entry(doc_id, user)
    file = paths.jsonl_path(doc_id, method)
    if not file.exists():
        raise ApiError("NOT_PROCESSED", "The chunks for this document are missing. Process it again.")
    items = [chunk for chunk in read_jsonl(file) if type is None or chunk.type == type]
    start = (page - 1) * page_size
    return {
        "items": [chunk.to_dict() for chunk in items[start : start + page_size]],
        "total": len(items),
        "page": page,
        "page_size": page_size,
    }


@router.get("/chunks/export")
def export_chunks(
    doc_id: str, method: Literal["smart", "naive"], user: str = Depends(current_user)
) -> FileResponse:
    _ready_entry(doc_id, user)
    file = paths.jsonl_path(doc_id, method)
    if not file.exists():
        raise ApiError("NOT_PROCESSED", "The chunks for this document are missing. Process it again.")
    return FileResponse(file, media_type="application/x-ndjson", filename=f"{doc_id}_{method}_chunks.jsonl")


@router.get("/summary/{doc_id}", response_model=DocSummary)
def summary(doc_id: str, user: str = Depends(current_user)) -> dict[str, Any]:
    entry = _ready_entry(doc_id, user)
    saved = entry.get("summary") or {}
    return {
        "doc_id": doc_id,
        "summary": saved.get("summary", ""),
        "key_topics": saved.get("key_topics", []),
        "suggested_questions": saved.get("suggested_questions", []),
    }


# 11-13. Chat -----------------------------------------------------------------------------------


@router.post("/chat", response_model=ChatResult)
def chat(body: ChatRequest, user: str = Depends(current_user)) -> dict[str, Any]:
    entry = _ready_entry(body.doc_id, user)
    history = [turn.model_dump() for turn in body.history]
    summary = memory.summary_for(user, body.doc_id)
    result = _answer(body.doc_id, body.method, body.question, history, _settings_of(entry), summary)
    _remember(user, entry, body.question, body.method, result)
    return result


@router.post("/compare", response_model=CompareResult)
def compare(body: CompareRequest, user: str = Depends(current_user)) -> dict[str, Any]:
    entry = _ready_entry(body.doc_id, user)
    settings = _settings_of(entry)
    history = [turn.model_dump() for turn in body.history]
    summary = memory.summary_for(user, body.doc_id)
    _require_chunks(body.doc_id, "smart")
    _require_chunks(body.doc_id, "naive")
    # Rewrite a follow-up once and give both methods the same standalone question: fairer, faster,
    # and one fewer language model call.
    standalone = _llm_call(lambda: rag.rewrite_question(body.question.strip(), history[-rag.MAX_HISTORY :], summary))
    smart = _answer(body.doc_id, "smart", body.question, history, settings, summary, standalone)
    naive = _answer(body.doc_id, "naive", body.question, history, settings, summary, standalone)
    _remember(user, entry, body.question, "compare", smart, naive)
    return {"smart": smart, "naive": naive}


def _fallback_session_summary(filename: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    votes = {key: sum(1 for row in rows if row["winner"] == key) for key in ("smart", "naive", "tie", "unvoted")}
    voted = len(rows) - votes["unvoted"]
    recap = (
        f"You asked {len(rows)} question{'s' if len(rows) != 1 else ''} about {filename}. "
        f"Of the {voted} you voted on, SmartChunk won {votes['smart']}, the traditional chunker won "
        f"{votes['naive']} and {votes['tie']} were ties."
    )
    findings = []
    if votes["smart"] > votes["naive"]:
        findings.append("SmartChunk gave the better answer more often in this session.")
    elif votes["naive"] > votes["smart"]:
        findings.append("The traditional chunker gave the better answer more often in this session.")
    elif voted:
        findings.append("Both methods performed about the same in this session.")
    if votes["unvoted"]:
        findings.append(f"{votes['unvoted']} answer pair(s) were not voted on.")
    findings.append("Add a language model key to get a written analysis of the differences.")
    return {"recap": recap, "key_findings": findings, "qa_rows": rows}


@router.post("/session-summary", response_model=SessionSummary)
def session_summary(body: SessionSummaryRequest, user: str = Depends(current_user)) -> dict[str, Any]:
    entry = _entry(body.doc_id, user)
    rows = [item.model_dump() for item in body.qa_items]
    if not rows:
        return {"recap": "No questions were asked in this session.", "key_findings": [], "qa_rows": []}
    if not llm_client.is_configured():
        return _fallback_session_summary(entry["filename"], rows)
    material = "\n\n".join(
        f"Q: {row['question']}\nSmartChunk: {row['smart_answer']}\nTraditional: {row['naive_answer']}\nVote: {row['winner']}"
        for row in rows
    )
    instructions = (
        "You compare two retrieval methods (SmartChunk and a traditional fixed-size chunker) from a Q&A session. "
        'Reply with JSON only: {"recap": "3 plain sentences", "key_findings": ["2 to 5 short findings"]}.'
    )
    try:
        reply, _ = llm_client.generate(
            [{"role": "system", "content": instructions}, {"role": "user", "content": material[:20000]}],
            temperature=0,
            max_tokens=500,
        )
        data = summarizer.parse_json_reply(reply)
        recap = str(data.get("recap", "")).strip()
        findings = [str(item).strip() for item in data.get("key_findings", []) if str(item).strip()][:6]
        if not recap:
            raise ValueError("empty recap")
        return {"recap": recap, "key_findings": findings, "qa_rows": rows}
    except (llm_client.LlmError, ValueError):
        return _fallback_session_summary(entry["filename"], rows)


# 14. Evaluation --------------------------------------------------------------------------------


@router.get("/evaluation", response_model=EvaluationResult)
def evaluation() -> dict[str, Any]:
    file = paths.eval_results_file()
    if not file.exists():
        raise ApiError("EVAL_NOT_AVAILABLE", "No evaluation results yet. Run: python -m eval.run_eval")
    try:
        data = json.loads(file.read_text(encoding="utf-8"))
        return EvaluationResult.model_validate(data).model_dump()
    except (ValueError, ValidationError) as error:
        raise ApiError("EVAL_NOT_AVAILABLE", f"eval/results.json is not valid: {error}") from error


# 15-16. Documents ------------------------------------------------------------------------------


@router.get("/documents", response_model=list[DocumentInfo])
def documents(user: str = Depends(current_user)) -> list[dict[str, Any]]:
    out = []
    for entry in registry.list_all():
        if entry.get("owner", auth.GUEST) != user:
            continue
        state = entry.get("status", "uploaded")
        if jobs.is_running(entry["doc_id"]):
            state = "processing"
        out.append(
            {
                "doc_id": entry["doc_id"],
                "filename": entry["filename"],
                "pages": entry.get("pages", 1),
                "status": state,
                "smart_chunk_count": entry.get("smart_chunk_count"),
                "naive_chunk_count": entry.get("naive_chunk_count"),
                "created_at": entry["created_at"],
                "summary_preview": entry.get("summary_preview", ""),
            }
        )
    return out


@router.delete("/documents/{doc_id}", response_model=DeleteResponse)
def delete_document(doc_id: str, user: str = Depends(current_user)) -> dict[str, Any]:
    entry = _entry(doc_id, user)
    if jobs.is_running(doc_id):
        raise ApiError("PROCESSING_IN_PROGRESS", "Wait for processing to finish before deleting this document.")
    store.delete_collections(doc_id)
    for method in ("smart", "naive"):
        paths.jsonl_path(doc_id, method).unlink(missing_ok=True)
    Path(entry["path"]).unlink(missing_ok=True)
    memory.clear(user, doc_id)
    registry.delete(doc_id)
    jobs.forget(doc_id)
    return {"deleted": True, "doc_id": doc_id}


# Accounts ---------------------------------------------------------------------------------------


@router.post("/auth/register", response_model=AuthResponse)
def register(body: Credentials) -> dict[str, str]:
    return auth.register(body.username, body.password)


@router.post("/auth/login", response_model=AuthResponse)
def login(body: Credentials) -> dict[str, str]:
    return auth.login(body.username, body.password)


@router.get("/auth/me", response_model=MeResponse)
def me(user: str = Depends(current_user)) -> dict[str, str]:
    return {"username": user}


@router.post("/auth/logout", response_model=LogoutResponse)
def logout(authorization: str | None = Header(default=None)) -> dict[str, bool]:
    token = auth.bearer_token(authorization)
    if token:
        auth.logout(token)
    return {"logged_out": True}


# Summarised history ------------------------------------------------------------------------------


def _owned_documents(user: str) -> dict[str, str]:
    return {e["doc_id"]: e["filename"] for e in registry.list_all() if e.get("owner", auth.GUEST) == user}


@router.get("/history", response_model=list[DocHistory])
def history_list(user: str = Depends(current_user)) -> list[dict[str, Any]]:
    return memory.list_for(user, _owned_documents(user))


@router.get("/history/{doc_id}", response_model=DocHistory)
def history_get(doc_id: str, user: str = Depends(current_user)) -> dict[str, Any]:
    entry = _entry(doc_id, user)
    return memory.get(user, doc_id, entry["filename"])


@router.delete("/history/{doc_id}", response_model=HistoryCleared)
def history_clear(doc_id: str, user: str = Depends(current_user)) -> dict[str, Any]:
    _entry(doc_id, user)
    memory.clear(user, doc_id)
    return {"cleared": True, "doc_id": doc_id}
