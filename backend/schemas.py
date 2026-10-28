"""Pydantic models mirroring spec A6 field for field. Extra fields are forbidden so a typo in a
response is caught by the contract tests instead of silently reaching the frontend."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

ChunkType = Literal["prose", "code", "table", "list"]
Method = Literal["smart", "naive"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SettingsModel(Strict):
    min_chunk_tokens: int = Field(ge=20, le=200)
    max_chunk_tokens: int = Field(ge=100, le=512)
    similarity_threshold: float = Field(ge=0.0, le=1.0)
    dedup_threshold: float = Field(ge=0.80, le=1.0)
    top_k: int = Field(ge=1, le=10)
    naive_chunk_tokens: int = Field(ge=100, le=1000)
    naive_overlap_tokens: int = Field(ge=0, le=200)
    not_found_threshold: float = Field(ge=0.0, le=1.0)

    @model_validator(mode="after")
    def _relations(self) -> "SettingsModel":
        if self.min_chunk_tokens >= self.max_chunk_tokens:
            raise ValueError("min_chunk_tokens must be lower than max_chunk_tokens")
        if self.naive_overlap_tokens >= self.naive_chunk_tokens:
            raise ValueError("naive_overlap_tokens must be lower than naive_chunk_tokens")
        return self


class ChunkModel(Strict):
    chunk_id: str
    text: str
    source: str
    page: int | None
    heading_path: list[str]
    type: ChunkType
    token_count: int


class UploadResponse(Strict):
    doc_id: str
    filename: str
    pages: int
    size_bytes: int
    warnings: list[str]


class ProcessStartResponse(Strict):
    doc_id: str
    status: Literal["started"]


ProcessStep = Literal[
    "uploaded", "parsing", "cleaning", "semantic_split", "dedup", "embedding", "storing", "summarizing", "done"
]


class ProcessingStatus(Strict):
    doc_id: str
    status: Literal["idle", "running", "done", "error"]
    step: ProcessStep
    progress: int = Field(ge=0, le=100)
    error_message: str | None


class TypeCounts(Strict):
    prose: int
    code: int
    table: int
    list: int


class MethodStats(Strict):
    chunk_count: int
    avg_tokens: float
    type_counts: TypeCounts
    split_code_blocks: int
    split_tables: int
    split_lists: int
    orphan_headings: int
    exact_duplicates_removed: int
    near_duplicates_removed: int
    noise_lines_removed: int
    metadata_fields_present: int


class RemovedItem(Strict):
    kind: Literal["header", "footer", "exact_duplicate", "near_duplicate"]
    text: str
    page: int | None
    reason: str


class RemovedReport(Strict):
    items: list[RemovedItem]


class ProcessResult(Strict):
    doc_id: str
    smart_stats: MethodStats
    naive_stats: MethodStats
    removed_report: RemovedReport
    settings: SettingsModel
    warnings: list[str]


class ChunkPage(Strict):
    items: list[ChunkModel]
    total: int
    page: int
    page_size: int


class ChatTurn(Strict):
    role: Literal["user", "assistant"]
    content: str


class SourceCitation(Strict):
    chunk_id: str
    heading_path: list[str]
    page: int | None


class RetrievedChunk(Strict):
    chunk: ChunkModel
    score: float = Field(ge=0.0, le=1.0)


class TokensUsed(Strict):
    prompt: int
    completion: int
    total: int


class ChatResult(Strict):
    method: Method
    answer: str
    standalone_question: str
    sources: list[SourceCitation]
    retrieved_chunks: list[RetrievedChunk]
    prompt_sent: str
    tokens_used: TokensUsed
    context_window_limit: int
    latency_ms: int
    not_found: bool


class CompareResult(Strict):
    smart: ChatResult
    naive: ChatResult


class DocSummary(Strict):
    doc_id: str
    summary: str
    key_topics: list[str]
    suggested_questions: list[str]


class QAItem(Strict):
    question: str
    smart_answer: str
    naive_answer: str
    winner: Literal["smart", "naive", "tie", "unvoted"]


class SessionSummary(Strict):
    recap: str
    key_findings: list[str]
    qa_rows: list[QAItem]


class PRF(Strict):
    precision: float
    recall: float
    f1: float


class RetrievalMetrics(Strict):
    recall_at_5: float
    mrr: float


class ByType(Strict):
    prose: RetrievalMetrics
    code: RetrievalMetrics
    table: RetrievalMetrics
    list: RetrievalMetrics


class MethodMetrics(Strict):
    recall_at_5: float
    mrr: float
    by_type: ByType


class Methods(Strict):
    smart: MethodMetrics
    naive: MethodMetrics


class DamageCounts(Strict):
    split_code_blocks: int
    split_tables: int
    duplicates: int
    noise_chunks: int


class Damage(Strict):
    smart: DamageCounts
    naive: DamageCounts


class Classifier(Strict):
    threshold: PRF
    trained: PRF
    test_pairs: int


class EvaluationResult(Strict):
    generated_at: str
    documents: list[str]
    questions_count: int
    methods: Methods
    damage: Damage
    classifier: Classifier | None


class DocumentInfo(Strict):
    doc_id: str
    filename: str
    pages: int
    status: Literal["uploaded", "processing", "ready", "error"]
    smart_chunk_count: int | None
    naive_chunk_count: int | None
    created_at: str
    summary_preview: str


class SampleInfo(Strict):
    sample_id: str
    title: str
    description: str
    filename: str


class HealthResponse(Strict):
    status: Literal["ok"]
    embedding_model_loaded: bool
    llm_configured: bool


class DeleteResponse(Strict):
    deleted: Literal[True]
    doc_id: str


class ErrorBody(Strict):
    code: str
    message: str


class ErrorEnvelope(Strict):
    error: ErrorBody


# Request bodies --------------------------------------------------------------------------------


class UploadSampleRequest(Strict):
    sample_id: str = Field(min_length=1)


class ProcessRequest(Strict):
    doc_id: str
    settings: SettingsModel


class ChatRequest(Strict):
    doc_id: str
    method: Method
    question: str = Field(min_length=1, max_length=4000)
    history: list[ChatTurn] = Field(default_factory=list)


class CompareRequest(Strict):
    doc_id: str
    question: str = Field(min_length=1, max_length=4000)
    history: list[ChatTurn] = Field(default_factory=list)


class SessionSummaryRequest(Strict):
    doc_id: str
    qa_items: list[QAItem]


# Accounts ---------------------------------------------------------------------------------------


class Credentials(Strict):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class AuthResponse(Strict):
    username: str
    token: str


class MeResponse(Strict):
    username: str


class LogoutResponse(Strict):
    logged_out: Literal[True]


# Summarised history ------------------------------------------------------------------------------


class HistoryEntry(Strict):
    question: str
    method: Literal["smart", "naive", "compare"]
    answer: str
    naive_answer: str | None
    not_found: bool
    asked_at: str


class HistoryCounts(Strict):
    questions: int
    smart: int
    naive: int
    compare: int
    not_found: int


class DocHistory(Strict):
    doc_id: str
    filename: str
    summary: str
    summarized_questions: int
    counts: HistoryCounts
    recent: list[HistoryEntry]
    updated_at: str | None


class HistoryCleared(Strict):
    cleared: Literal[True]
    doc_id: str
