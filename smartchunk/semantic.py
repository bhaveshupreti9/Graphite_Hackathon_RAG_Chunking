"""Semantic splitting of prose (spec B4 "Chunk building", step 3).

Sentences are embedded, adjacent-sentence cosine similarity is computed with scikit-learn, and a
topic boundary is placed wherever similarity drops below `similarity_threshold`. Size constraints
then merge tiny pieces (min_chunk_tokens) and force splits at sentence ends (max_chunk_tokens).
"""

from __future__ import annotations

import re

import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

from .tokenizer import count_tokens, decode, encode

_SENTENCE_END = re.compile(r"(?<=[.!?])[\"')\]]*\s+(?=[A-Z0-9\"'(\[])")


def split_sentences(text: str) -> list[str]:
    """Splits prose into sentences; paragraph breaks always end a sentence."""
    sentences: list[str] = []
    for paragraph in re.split(r"\n\s*\n", text):
        flat = re.sub(r"\s*\n\s*", " ", paragraph).strip()
        if not flat:
            continue
        sentences.extend(part.strip() for part in _SENTENCE_END.split(flat) if part.strip())
    return sentences


def embed(texts: list[str]) -> np.ndarray:
    from retrieval.embedder import embed_texts

    return embed_texts(texts)


def find_boundaries(sentences: list[str], threshold: float, embeddings: np.ndarray | None = None) -> set[int]:
    """Indexes i where a boundary falls between sentence i and i+1."""
    if len(sentences) < 2:
        return set()
    vectors = embeddings if embeddings is not None else embed(sentences)
    sims = cosine_similarity(vectors[:-1], vectors[1:]).diagonal()
    return {i for i, sim in enumerate(sims) if float(sim) < threshold}


def _split_long_sentence(sentence: str, max_tokens: int) -> list[str]:
    tokens = encode(sentence)
    return [decode(tokens[i : i + max_tokens]).strip() for i in range(0, len(tokens), max_tokens)]


def apply_size_constraints(
    sentences: list[str], boundaries: set[int], min_tokens: int, max_tokens: int
) -> list[str]:
    """Groups sentences into pieces of roughly [min_tokens, max_tokens] tokens."""
    units: list[tuple[str, int, bool]] = []  # (text, tokens, boundary after)
    for i, sentence in enumerate(sentences):
        boundary_after = i in boundaries
        tokens = count_tokens(sentence)
        if tokens > max_tokens:
            parts = _split_long_sentence(sentence, max_tokens)
            for j, part in enumerate(parts):
                units.append((part, count_tokens(part), boundary_after if j == len(parts) - 1 else False))
        else:
            units.append((sentence, tokens, boundary_after))

    pieces: list[tuple[list[str], int]] = []
    current: list[str] = []
    current_tokens = 0
    for text, tokens, boundary_after in units:
        if current and current_tokens + tokens > max_tokens:
            pieces.append((current, current_tokens))
            current, current_tokens = [], 0
        current.append(text)
        current_tokens += tokens
        if boundary_after and current_tokens >= min_tokens:
            pieces.append((current, current_tokens))
            current, current_tokens = [], 0
    if current:
        pieces.append((current, current_tokens))

    # Merge pieces that are still too small into a neighbour when that keeps them under the max.
    merged: list[tuple[list[str], int]] = []
    for sentences_in_piece, tokens in pieces:
        if merged and (tokens < min_tokens or merged[-1][1] < min_tokens) and merged[-1][1] + tokens <= max_tokens:
            previous, previous_tokens = merged[-1]
            merged[-1] = (previous + sentences_in_piece, previous_tokens + tokens)
        else:
            merged.append((sentences_in_piece, tokens))
    return [" ".join(group) for group, _ in merged]


def semantic_split(text: str, threshold: float, min_tokens: int, max_tokens: int) -> list[str]:
    sentences = split_sentences(text)
    if not sentences:
        return []
    if count_tokens(text) <= max_tokens and len(sentences) <= 2:
        return [" ".join(sentences)]
    boundaries = find_boundaries(sentences, threshold)
    return apply_size_constraints(sentences, boundaries, min_tokens, max_tokens)
