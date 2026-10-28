"""End-to-end API tests: every response is checked against the spec A6 schemas, and the shared
contracts/*.json examples must validate too, so the frontend and backend cannot drift apart."""

from __future__ import annotations

import io
import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import schemas
from retrieval import llm_client
from smartchunk.config import Settings

CONTRACTS = Path(__file__).resolve().parents[1] / "contracts"

CONTRACT_SCHEMAS = {
    "upload.json": schemas.UploadResponse,
    "process_start.json": schemas.ProcessStartResponse,
    "status_running.json": schemas.ProcessingStatus,
    "status_done.json": schemas.ProcessingStatus,
    "process_result.json": schemas.ProcessResult,
    "chunks_page.json": schemas.ChunkPage,
    "chat_result_smart.json": schemas.ChatResult,
    "chat_result_not_found.json": schemas.ChatResult,
    "compare.json": schemas.CompareResult,
    "summary.json": schemas.DocSummary,
    "session_summary.json": schemas.SessionSummary,
    "evaluation.json": schemas.EvaluationResult,
    "error.json": schemas.ErrorEnvelope,
}


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    monkeypatch.setenv("SKIP_WARMUP", "1")
    monkeypatch.setenv("EVAL_RESULTS", str(tmp_path / "results.json"))
    from backend.main import create_app

    with TestClient(create_app()) as test_client:
        login = test_client.post("/api/auth/register", json={"username": "tester", "password": "secret123"})
        assert login.status_code == 200, login.text
        test_client.headers["Authorization"] = f"Bearer {login.json()['token']}"
        yield test_client


@pytest.fixture
def fake_llm(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(llm_client, "is_configured", lambda: True)

    def generate(messages, temperature=0, max_tokens=512):
        text = messages[-1]["content"]
        if "Reply with JSON only" in messages[0]["content"] and "summary" in messages[0]["content"]:
            return json.dumps({"summary": "A Python tutorial.", "key_topics": ["functions"],
                               "suggested_questions": ["How do I define a function?"]}), None
        if "recap" in messages[0]["content"]:
            return json.dumps({"recap": "SmartChunk did better.", "key_findings": ["Code stayed whole."]}), None
        return "Use def. [Functions]", llm_client.Usage(len(text) // 4, 5)

    monkeypatch.setattr(llm_client, "generate", generate)


def _error(response, status: int, code: str) -> None:
    assert response.status_code == status, response.text
    body = schemas.ErrorEnvelope.model_validate(response.json())
    assert body.error.code == code


def _wait_done(client: TestClient, doc_id: str) -> dict:
    for _ in range(300):
        status = client.get(f"/api/processing-status/{doc_id}").json()
        schemas.ProcessingStatus.model_validate(status)
        if status["status"] in ("done", "error"):
            return status
        time.sleep(0.05)
    raise AssertionError("processing did not finish")


def _processed(client: TestClient, sample_id: str = "python_tutorial", **overrides) -> str:
    upload = client.post("/api/upload-sample", json={"sample_id": sample_id})
    assert upload.status_code == 200, upload.text
    doc_id = upload.json()["doc_id"]
    started = client.post("/api/process", json={"doc_id": doc_id, "settings": Settings().to_dict() | overrides})
    assert started.status_code == 202, started.text
    schemas.ProcessStartResponse.model_validate(started.json())
    final = _wait_done(client, doc_id)
    assert final["status"] == "done", final
    assert final["progress"] == 100
    return doc_id


@pytest.mark.parametrize("name", sorted(CONTRACT_SCHEMAS))
def test_contract_examples_validate(name: str) -> None:
    CONTRACT_SCHEMAS[name].model_validate(json.loads((CONTRACTS / name).read_text(encoding="utf-8")))


def test_list_contracts_validate() -> None:
    for item in json.loads((CONTRACTS / "documents.json").read_text(encoding="utf-8")):
        schemas.DocumentInfo.model_validate(item)
    for item in json.loads((CONTRACTS / "samples.json").read_text(encoding="utf-8")):
        schemas.SampleInfo.model_validate(item)


def test_health_and_samples(client: TestClient) -> None:
    health = schemas.HealthResponse.model_validate(client.get("/api/health").json())
    assert health.llm_configured is False
    samples = [schemas.SampleInfo.model_validate(s) for s in client.get("/api/samples").json()]
    assert {s.sample_id for s in samples} >= {"python_tutorial", "api_reference", "company_handbook"}


def test_full_flow_without_llm(client: TestClient) -> None:
    # Threshold 0 so retrieval always "finds" something and the LLM is needed (the offline hash
    # embedder gives low similarity scores).
    doc_id = _processed(client, not_found_threshold=0.0)

    result = schemas.ProcessResult.model_validate(client.get(f"/api/process-result/{doc_id}").json())
    assert result.smart_stats.chunk_count > 0
    assert result.smart_stats.split_code_blocks == 0
    assert result.smart_stats.metadata_fields_present == 7
    assert result.naive_stats.metadata_fields_present == 2
    assert any("not configured" in warning for warning in result.warnings)

    page = schemas.ChunkPage.model_validate(
        client.get("/api/chunks", params={"doc_id": doc_id, "method": "smart", "page": 1, "page_size": 5}).json()
    )
    assert len(page.items) <= 5 and page.total == result.smart_stats.chunk_count
    assert page.items[0].chunk_id == f"{doc_id}_smart_0000"
    code = client.get("/api/chunks", params={"doc_id": doc_id, "method": "smart", "type": "code"}).json()
    assert all(item["type"] == "code" for item in code["items"])

    export = client.get("/api/chunks/export", params={"doc_id": doc_id, "method": "naive"})
    assert export.status_code == 200
    assert export.headers["content-type"].startswith("application/x-ndjson")
    assert "attachment" in export.headers["content-disposition"]
    assert len(export.text.strip().splitlines()) == result.naive_stats.chunk_count

    schemas.DocSummary.model_validate(client.get(f"/api/summary/{doc_id}").json())

    _error(client.post("/api/chat", json={"doc_id": doc_id, "method": "smart", "question": "How do I define a function?"}),
           503, "LLM_NOT_CONFIGURED")

    summary = client.post("/api/session-summary", json={"doc_id": doc_id, "qa_items": [
        {"question": "q", "smart_answer": "a", "naive_answer": "b", "winner": "smart"}]})
    assert summary.status_code == 200
    schemas.SessionSummary.model_validate(summary.json())

    docs = [schemas.DocumentInfo.model_validate(d) for d in client.get("/api/documents").json()]
    assert docs[0].doc_id == doc_id and docs[0].status == "ready"

    deleted = client.delete(f"/api/documents/{doc_id}")
    schemas.DeleteResponse.model_validate(deleted.json())
    _error(client.get(f"/api/process-result/{doc_id}"), 404, "DOC_NOT_FOUND")


def test_chat_and_compare_with_fake_llm(client: TestClient, fake_llm) -> None:
    doc_id = _processed(client, not_found_threshold=0.0)
    summary = schemas.DocSummary.model_validate(client.get(f"/api/summary/{doc_id}").json())
    assert summary.summary == "A Python tutorial."

    chat = schemas.ChatResult.model_validate(client.post("/api/chat", json={
        "doc_id": doc_id, "method": "smart", "question": "How do I define a function?",
        "history": [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}],
    }).json())
    assert chat.method == "smart" and chat.not_found is False
    assert chat.answer == "Use def. [Functions]" and chat.sources
    assert chat.tokens_used.total == chat.tokens_used.prompt + chat.tokens_used.completion

    compare = schemas.CompareResult.model_validate(
        client.post("/api/compare", json={"doc_id": doc_id, "question": "binary search"}).json()
    )
    assert compare.smart.method == "smart" and compare.naive.method == "naive"

    session = schemas.SessionSummary.model_validate(client.post("/api/session-summary", json={
        "doc_id": doc_id, "qa_items": [{"question": "q", "smart_answer": "a", "naive_answer": "b", "winner": "tie"}],
    }).json())
    assert session.recap == "SmartChunk did better."


def test_upload_errors(client: TestClient, make_pdf) -> None:
    _error(client.post("/api/upload", files={"file": ("x.docx", b"hello", "application/octet-stream")}),
           415, "INVALID_FILE_TYPE")
    _error(client.post("/api/upload", files={"file": ("empty.md", b"   \n", "text/markdown")}), 422, "EMPTY_DOCUMENT")
    _error(client.post("/api/upload-sample", json={"sample_id": "nope"}), 404, "SAMPLE_NOT_FOUND")

    scanned = make_pdf([[]], name="blank.pdf")
    _error(client.post("/api/upload", files={"file": ("blank.pdf", scanned.read_bytes(), "application/pdf")}),
           422, "SCANNED_PDF")
    locked = make_pdf([[("Secret text here for testing", 12, "helv")]], name="locked.pdf", password="pw")
    _error(client.post("/api/upload", files={"file": ("locked.pdf", locked.read_bytes(), "application/pdf")}),
           422, "ENCRYPTED_PDF")

    good = client.post("/api/upload", files={"file": ("../../notes.md", io.BytesIO(b"# Title\n\nSome text."), "text/markdown")})
    upload = schemas.UploadResponse.model_validate(good.json())
    assert upload.filename == "notes.md" and upload.pages == 1


def test_file_too_large(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MAX_UPLOAD_MB", "0.001")
    _error(client.post("/api/upload", files={"file": ("big.md", b"a" * 5000, "text/markdown")}), 413, "FILE_TOO_LARGE")


def test_state_and_validation_errors(client: TestClient) -> None:
    _error(client.get("/api/processing-status/doc_00000000"), 404, "DOC_NOT_FOUND")
    doc_id = client.post("/api/upload-sample", json={"sample_id": "company_handbook"}).json()["doc_id"]
    idle = schemas.ProcessingStatus.model_validate(client.get(f"/api/processing-status/{doc_id}").json())
    assert idle.status == "idle"
    _error(client.get(f"/api/process-result/{doc_id}"), 409, "NOT_PROCESSED")
    _error(client.get("/api/chunks", params={"doc_id": doc_id, "method": "smart"}), 409, "NOT_PROCESSED")
    _error(client.post("/api/chat", json={"doc_id": doc_id, "method": "smart", "question": "x"}), 409, "NOT_PROCESSED")

    bad = Settings().to_dict() | {"min_chunk_tokens": 400}
    _error(client.post("/api/process", json={"doc_id": doc_id, "settings": bad}), 422, "VALIDATION_ERROR")
    extra = Settings().to_dict() | {"surprise": 1}
    _error(client.post("/api/process", json={"doc_id": doc_id, "settings": extra}), 422, "VALIDATION_ERROR")
    _error(client.get("/api/chunks", params={"doc_id": doc_id, "method": "fancy"}), 422, "VALIDATION_ERROR")
    _error(client.get("/api/evaluation"), 404, "EVAL_NOT_AVAILABLE")


def test_evaluation_served_when_present(client: TestClient, tmp_path: Path) -> None:
    (tmp_path / "results.json").write_text((CONTRACTS / "evaluation.json").read_text(encoding="utf-8"), encoding="utf-8")
    schemas.EvaluationResult.model_validate(client.get("/api/evaluation").json())


def test_pdf_sample_processes(client: TestClient) -> None:
    doc_id = _processed(client, "python_tutorial_print")
    result = client.get(f"/api/process-result/{doc_id}").json()
    assert result["smart_stats"]["noise_lines_removed"] > 0
    assert any(item["kind"] in ("header", "footer") for item in result["removed_report"]["items"])


def test_auth_flow_and_isolation(client: TestClient) -> None:
    doc_id = client.post("/api/upload-sample", json={"sample_id": "company_handbook"}).json()["doc_id"]
    assert schemas.MeResponse.model_validate(client.get("/api/auth/me").json()).username == "tester"

    anonymous = {"Authorization": ""}
    _error(client.get("/api/documents", headers=anonymous), 401, "UNAUTHORIZED")
    _error(client.get("/api/documents", headers={"Authorization": "Bearer nope"}), 401, "UNAUTHORIZED")
    assert client.get("/api/health", headers=anonymous).status_code == 200
    assert client.get("/api/samples", headers=anonymous).status_code == 200

    _error(client.post("/api/auth/register", json={"username": "Tester", "password": "another1"}), 409, "USERNAME_TAKEN")
    _error(client.post("/api/auth/register", json={"username": "x", "password": "another1"}), 422, "VALIDATION_ERROR")
    _error(client.post("/api/auth/register", json={"username": "short", "password": "123"}), 422, "VALIDATION_ERROR")
    _error(client.post("/api/auth/login", json={"username": "tester", "password": "wrong"}), 401, "INVALID_CREDENTIALS")
    _error(client.post("/api/auth/login", json={"username": "ghost", "password": "wrong"}), 401, "INVALID_CREDENTIALS")

    other = schemas.AuthResponse.model_validate(
        client.post("/api/auth/register", json={"username": "other", "password": "secret456"}).json()
    )
    as_other = {"Authorization": f"Bearer {other.token}"}
    assert client.get("/api/documents", headers=as_other).json() == []
    _error(client.get(f"/api/processing-status/{doc_id}", headers=as_other), 404, "DOC_NOT_FOUND")
    _error(client.delete(f"/api/documents/{doc_id}", headers=as_other), 404, "DOC_NOT_FOUND")
    assert [d["doc_id"] for d in client.get("/api/documents").json()] == [doc_id]

    again = client.post("/api/auth/login", json={"username": "TESTER", "password": "secret123"})
    assert again.status_code == 200 and again.json()["username"] == "tester"

    assert client.post("/api/auth/logout", headers=as_other).json() == {"logged_out": True}
    _error(client.get("/api/auth/me", headers=as_other), 401, "UNAUTHORIZED")


def test_auth_can_be_switched_off(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("SKIP_WARMUP", "1")
    monkeypatch.setenv("AUTH_REQUIRED", "false")
    from backend.main import create_app

    with TestClient(create_app()) as anonymous:
        assert anonymous.get("/api/auth/me").json() == {"username": "guest"}
        assert anonymous.post("/api/upload-sample", json={"sample_id": "company_handbook"}).status_code == 200
        assert len(anonymous.get("/api/documents").json()) == 1
