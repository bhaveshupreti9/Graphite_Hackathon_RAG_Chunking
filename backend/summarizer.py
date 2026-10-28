"""Document summary, key topics and suggested questions (spec B5 "Summaries").

Long documents are summarised per top-level section first, then the section summaries are
summarised, so no request exceeds the context window. If the LLM is not configured (or fails),
empty values are returned with a warning instead of failing the whole processing job.
"""

from __future__ import annotations

import json
import re
from typing import Any

from retrieval import llm_client
from smartchunk.models import Chunk
from smartchunk.tokenizer import count_tokens, decode, encode

SINGLE_PASS_TOKENS = 5000
SECTION_TOKENS = 3000

FINAL_INSTRUCTIONS = (
    "You summarise documents for a reader who has not seen them. Reply with JSON only, no code fences, "
    'in this exact shape: {"summary": "2-3 plain sentences", "key_topics": ["3 to 8 short topics"], '
    '"suggested_questions": ["4 questions this document can answer"]}.'
)
SECTION_INSTRUCTIONS = "Summarise this part of a document in 3 sentences. Plain text only."
NOT_CONFIGURED_WARNING = (
    "The language model is not configured, so the summary, key topics and suggested questions were skipped."
)


def _clip(text: str, tokens: int) -> str:
    ids = encode(text)
    return text if len(ids) <= tokens else decode(ids[:tokens])


def parse_json_reply(text: str) -> dict[str, Any]:
    """Parses a JSON object out of an LLM reply, tolerating code fences and surrounding prose."""
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.IGNORECASE)
    try:
        value = json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
        if not match:
            raise
        value = json.loads(match.group(0))
    if not isinstance(value, dict):
        raise ValueError("Expected a JSON object.")
    return value


def _strings(value: Any, limit: int) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()][:limit]


def summarize(chunks: list[Chunk]) -> tuple[str, list[str], list[str], list[str]]:
    """Returns (summary, key_topics, suggested_questions, warnings)."""
    if not chunks:
        return "", [], [], []
    if not llm_client.is_configured():
        return "", [], [], [NOT_CONFIGURED_WARNING]
    try:
        full_text = "\n\n".join(chunk.text for chunk in chunks)
        if count_tokens(full_text) <= SINGLE_PASS_TOKENS:
            material = full_text
        else:
            sections: dict[str, list[str]] = {}
            for chunk in chunks:
                key = chunk.heading_path[0] if chunk.heading_path else "Document"
                sections.setdefault(key, []).append(chunk.text)
            summaries = []
            for name, texts in sections.items():
                text, _ = llm_client.generate(
                    [
                        {"role": "system", "content": SECTION_INSTRUCTIONS},
                        {"role": "user", "content": _clip("\n\n".join(texts), SECTION_TOKENS)},
                    ],
                    temperature=0,
                    max_tokens=200,
                )
                summaries.append(f"{name}: {text.strip()}")
            material = _clip("\n\n".join(summaries), SINGLE_PASS_TOKENS)
        reply, _ = llm_client.generate(
            [{"role": "system", "content": FINAL_INSTRUCTIONS}, {"role": "user", "content": material}],
            temperature=0,
            max_tokens=500,
        )
        data = parse_json_reply(reply)
        return (
            str(data.get("summary", "")).strip(),
            _strings(data.get("key_topics"), 8),
            _strings(data.get("suggested_questions"), 6),
            [],
        )
    except (llm_client.LlmError, llm_client.LlmNotConfigured, ValueError) as error:
        return "", [], [], [f"The summary could not be generated: {error}"]
