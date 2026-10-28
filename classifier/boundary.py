"""Optional topic-boundary classifier (spec B5, optional part).

Question: given two adjacent sentences, does a new topic start between them? Ground truth comes
from the documents' own headings: consecutive prose sentences under different headings form a
boundary pair (label 1), sentences in the same section a non-boundary pair (label 0).

Two predictors are compared on the same held-out pairs:
  * threshold: boundary when cosine similarity < similarity_threshold (what SmartChunk uses)
  * trained:   logistic regression on [similarity, both sentence lengths, length ratio,
               word overlap, whether sentence 2 starts with a connective word]

Run:  python -m classifier.boundary   (prints metrics and saves classifier/model.joblib)
"""

from __future__ import annotations

import re
from pathlib import Path

import numpy as np

from smartchunk.config import Settings
from smartchunk.parser import parse_pages
from smartchunk.pdf_loader import load_document
from smartchunk.semantic import embed, split_sentences

from eval.metrics import prf, words

MODEL_FILE = Path(__file__).resolve().parent / "model.joblib"
CONNECTIVES = {"this", "these", "it", "they", "that", "also", "however", "so", "then", "because", "but", "and"}


def build_pairs(paths: list[Path]) -> tuple[list[tuple[str, str]], list[int]]:
    pairs: list[tuple[str, str]] = []
    labels: list[int] = []
    for path in paths:
        pages, _ = load_document(path)
        blocks = parse_pages([(page.page, page.text) for page in pages])
        previous: tuple[str, tuple[str, ...]] | None = None
        for block in blocks:
            if block.kind == "heading":
                continue
            if block.kind != "prose":
                previous = None  # only pairs of directly adjacent prose sentences
                continue
            section = tuple(block.heading_path)
            for sentence in split_sentences(block.text):
                if previous is not None:
                    pairs.append((previous[0], sentence))
                    labels.append(int(previous[1] != section))
                previous = (sentence, section)
    return pairs, labels


def features(pairs: list[tuple[str, str]]) -> tuple[np.ndarray, np.ndarray]:
    """Returns (feature matrix, similarities)."""
    if not pairs:
        return np.zeros((0, 6)), np.zeros(0)
    first = embed([a for a, _ in pairs])
    second = embed([b for _, b in pairs])
    sims = np.sum(first * second, axis=1)  # embeddings are L2-normalised, so this is cosine
    rows = []
    for (a, b), sim in zip(pairs, sims):
        wa, wb = words(a), words(b)
        overlap = len(wa & wb) / max(1, len(wa | wb))
        first_word = re.findall(r"[a-z]+", b.lower())[:1]
        rows.append([
            float(sim),
            len(a.split()) / 40,
            len(b.split()) / 40,
            min(len(a), len(b)) / max(1, max(len(a), len(b))),
            overlap,
            float(bool(first_word) and first_word[0] in CONNECTIVES),
        ])
    return np.array(rows), sims


def evaluate(paths: list[Path], settings: Settings | None = None, seed: int = 7) -> dict | None:
    """Trains on 70% of pairs and reports both predictors on the other 30%. None if too little data."""
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import train_test_split

    settings = settings or Settings()
    pairs, labels = build_pairs(paths)
    if len(pairs) < 20 or len(set(labels)) < 2:
        return None
    x, sims = features(pairs)
    y = np.array(labels)
    indexes = np.arange(len(y))
    stratify = y if min(np.bincount(y)) >= 2 else None
    train_idx, test_idx = train_test_split(indexes, test_size=0.3, random_state=seed, stratify=stratify)

    model = LogisticRegression(class_weight="balanced", max_iter=1000)
    model.fit(x[train_idx], y[train_idx])
    trained = model.predict(x[test_idx]).tolist()
    threshold = [int(sim < settings.similarity_threshold) for sim in sims[test_idx]]
    truth = y[test_idx].tolist()

    try:
        import joblib

        joblib.dump(model, MODEL_FILE)
    except OSError:
        pass
    return {"threshold": prf(truth, threshold), "trained": prf(truth, trained), "test_pairs": len(test_idx)}


if __name__ == "__main__":
    from backend.paths import samples_dir

    folder = samples_dir()
    files = [p for p in sorted(folder.iterdir()) if p.suffix.lower() in {".md", ".txt"}]
    print(evaluate(files))
