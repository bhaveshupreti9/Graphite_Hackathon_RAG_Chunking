"""Builds eval/results.json in the EvaluationResult shape (spec A6) for GET /api/evaluation.

    python -m eval.run_eval                # default settings, writes eval/results.json
    python -m eval.run_eval --out other.json --no-classifier

Retrieval is done in memory with the same embedder as the API, so no server or Chroma is needed.
Numbers depend on the embedding backend: run it with the real model (EMBEDDING_BACKEND unset), not
the offline "hash" test embedder, before showing results to anyone.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from dotenv import load_dotenv

from backend import paths
from backend.schemas import EvaluationResult
from baseline.naive import naive_chunk_pages
from retrieval.embedder import backend_name, embed_texts
from smartchunk.chunker import chunk_pages
from smartchunk.cleaner import _strip_markup, detect_repeated_lines, normalize_line
from smartchunk.config import Settings
from smartchunk.damage import count_structural_damage
from smartchunk.models import Block, Chunk
from smartchunk.pdf_loader import load_document, load_plain

from .metrics import first_hit_rank, mrr, recall_at_k

HERE = Path(__file__).resolve().parent
TYPES = ("prose", "code", "table", "list")
K = 5


def _gold_block(blocks: list[Block], heading: str, kind: str) -> Block | None:
    for block in blocks:
        if block.kind == kind and block.heading_path and block.heading_path[-1].strip().lower() == heading.lower():
            return block
    return None


def _duplicates(chunks: list[Chunk], vectors: np.ndarray, threshold: float) -> int:
    """Chunks that are an exact or near (cosine >= threshold) copy of an earlier chunk."""
    count = 0
    for i in range(1, len(chunks)):
        if float(np.max(vectors[:i] @ vectors[i])) >= threshold:
            count += 1
    return count


def _noise_chunks(chunks: list[Chunk], noise_lines: set[str]) -> int:
    if not noise_lines:
        return 0
    return sum(
        1
        for chunk in chunks
        if any(normalize_line(_strip_markup(line)) in noise_lines for line in chunk.text.split("\n") if line.strip())
    )


def prepare_document(path: Path, index: int, settings: Settings) -> dict[str, Any]:
    """Chunks one document both ways and measures its structural damage."""
    doc_id = f"doc_eval{index:04d}"
    pages, warnings = load_document(path)
    result = chunk_pages(pages, settings, doc_id, path.name, warnings=warnings)
    naive = naive_chunk_pages(load_plain(path), settings, doc_id, path.name)
    noise_lines = set(detect_repeated_lines(pages))
    chunk_sets = {"smart": result.chunks, "naive": naive}
    vectors = {method: embed_texts([c.text for c in chunks]) for method, chunks in chunk_sets.items()}

    damage = {}
    smart_damage = count_structural_damage(result.raw_blocks, result.chunks, result.oversized_blocks)
    naive_damage = count_structural_damage(result.raw_blocks, naive)
    for method, counts in (("smart", smart_damage), ("naive", naive_damage)):
        damage[method] = {
            "split_code_blocks": counts["split_code_blocks"],
            "split_tables": counts["split_tables"],
            "duplicates": _duplicates(chunk_sets[method], vectors[method], settings.dedup_threshold),
            "noise_chunks": _noise_chunks(chunk_sets[method], noise_lines),
        }
    return {"blocks": result.raw_blocks, "chunks": chunk_sets, "vectors": vectors, "damage": damage}


def _method_metrics(ranks: list[int | None], types: list[str]) -> dict[str, Any]:
    by_type = {}
    for kind in TYPES:
        subset = [rank for rank, t in zip(ranks, types) if t == kind]
        by_type[kind] = {"recall_at_5": recall_at_k(subset, K), "mrr": mrr(subset)}
    return {"recall_at_5": recall_at_k(ranks, K), "mrr": mrr(ranks), "by_type": by_type}


def run(settings: Settings, questions_file: Path, with_classifier: bool = True) -> dict[str, Any]:
    """All documents share ONE index per method (like a small knowledge base). Scoring each tiny
    document on its own would be meaningless: with 500-token windows a short file is 1-6 naive
    chunks, so "top 5" would simply be the whole file."""
    spec = json.loads(questions_file.read_text(encoding="utf-8"))["documents"]
    folder = paths.samples_dir()
    damage = {m: {"split_code_blocks": 0, "split_tables": 0, "duplicates": 0, "noise_chunks": 0} for m in ("smart", "naive")}
    documents: list[str] = []
    pool: dict[str, list[Chunk]] = {"smart": [], "naive": []}
    pool_vectors: dict[str, list[np.ndarray]] = {"smart": [], "naive": []}
    golds: list[tuple[str, str, str]] = []  # (question, type, gold text)

    for index, (filename, questions) in enumerate(spec.items()):
        path = folder / filename
        if not path.exists():
            print(f"skip {filename}: not found in {folder}", file=sys.stderr)
            continue
        doc = prepare_document(path, index, settings)
        documents.append(filename)
        for method in ("smart", "naive"):
            pool[method].extend(doc["chunks"][method])
            pool_vectors[method].append(doc["vectors"][method])
            for key, value in doc["damage"][method].items():
                damage[method][key] += value
        for item in questions:
            gold = _gold_block(doc["blocks"], item["heading"], item["type"])
            if gold is None:
                print(f"skip question (answer passage not found) in {filename}: {item['question']}", file=sys.stderr)
                continue
            golds.append((item["question"], item["type"], gold.text))

    ranks: dict[str, list[int | None]] = {"smart": [], "naive": []}
    if golds:
        queries = embed_texts([question for question, _, _ in golds])
        for method in ("smart", "naive"):
            matrix = np.vstack(pool_vectors[method])
            for query, (_, _, gold_text) in zip(queries, golds):
                order = np.argsort(-(matrix @ query))[:K]
                ranks[method].append(first_hit_rank([pool[method][i].text for i in order], gold_text))
    types = [kind for _, kind, _ in golds]

    classifier = None
    if with_classifier:
        from classifier.boundary import evaluate as evaluate_classifier

        files = [folder / name for name in documents if (folder / name).suffix.lower() != ".pdf"]
        classifier = evaluate_classifier(files, settings)

    result = {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "documents": documents,
        "questions_count": len(types),
        "methods": {m: _method_metrics(ranks[m], types) for m in ("smart", "naive")},
        "damage": damage,
        "classifier": classifier,
    }
    return EvaluationResult.model_validate(result).model_dump()


def main() -> None:
    load_dotenv()
    parser = argparse.ArgumentParser(description="Evaluate SmartChunk against the naive baseline.")
    parser.add_argument("--questions", type=Path, default=HERE / "questions.json")
    parser.add_argument("--out", type=Path, default=None, help="default: EVAL_RESULTS or eval/results.json")
    parser.add_argument("--no-classifier", action="store_true")
    args = parser.parse_args()

    if backend_name() == "hash":
        print("warning: EMBEDDING_BACKEND=hash. These numbers are for testing only.", file=sys.stderr)
    result = run(Settings(), args.questions, with_classifier=not args.no_classifier)
    out = args.out or paths.eval_results_file()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2), encoding="utf-8")
    smart, naive = result["methods"]["smart"], result["methods"]["naive"]
    print(f"{result['questions_count']} questions over {len(result['documents'])} documents -> {out}")
    print(f"recall@5  smart {smart['recall_at_5']:.2f}  naive {naive['recall_at_5']:.2f}")
    print(f"MRR       smart {smart['mrr']:.2f}  naive {naive['mrr']:.2f}")


if __name__ == "__main__":
    main()
