"""Token counting with tiktoken (cl100k_base).

tiktoken downloads its encoding file the first time it is used. If that download is impossible
(offline machine, blocked network), this module falls back to a regex tokenizer that splits text
into words, punctuation and whitespace. The fallback keeps every character, so encode/decode is
lossless, and its counts are close to cl100k_base for English text (within roughly 15%).
"""

from __future__ import annotations

import logging
import re
from functools import lru_cache
from typing import Any

logger = logging.getLogger(__name__)

_FALLBACK_PATTERN = re.compile(r"\s+|\w+|[^\w\s]", re.UNICODE)


@lru_cache(maxsize=1)
def _encoding() -> Any | None:
    try:
        import tiktoken

        return tiktoken.get_encoding("cl100k_base")
    except Exception as error:  # noqa: BLE001 - any failure means "use the fallback"
        logger.warning("tiktoken cl100k_base unavailable (%s); using the regex tokenizer.", error)
        return None


def using_tiktoken() -> bool:
    return _encoding() is not None


def encode(text: str) -> list[Any]:
    """Token list. With tiktoken these are ints; with the fallback they are the text pieces."""
    encoding = _encoding()
    if encoding is not None:
        return list(encoding.encode(text, disallowed_special=()))
    return _fallback(text)


def _fallback(text: str) -> list[str]:
    # Whitespace runs are attached to the following token so decode() restores the text exactly
    # and whitespace does not count as a token of its own.
    tokens: list[str] = []
    pending = ""
    for piece in _FALLBACK_PATTERN.findall(text):
        if piece.isspace():
            pending += piece
        else:
            tokens.append(pending + piece)
            pending = ""
    if pending:
        if tokens:
            tokens[-1] += pending
        else:
            tokens.append(pending)
    return tokens


def decode(tokens: list[Any]) -> str:
    encoding = _encoding()
    if encoding is not None:
        return encoding.decode(tokens)
    return "".join(tokens)


def count_tokens(text: str) -> int:
    if not text:
        return 0
    return len(encode(text))
