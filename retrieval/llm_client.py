"""OpenAI-compatible LLM client (spec B5). Any provider works by changing LLM_BASE_URL/LLM_MODEL."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Any


class LlmNotConfigured(RuntimeError):
    """LLM_API_KEY or LLM_BASE_URL is missing."""


class LlmError(RuntimeError):
    """The provider failed or returned something unusable."""


@dataclass
class Usage:
    prompt: int
    completion: int

    @property
    def total(self) -> int:
        return self.prompt + self.completion


def _config() -> tuple[str, str, str]:
    return (
        os.getenv("LLM_API_KEY", "").strip(),
        os.getenv("LLM_BASE_URL", "").strip(),
        os.getenv("LLM_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini",
    )


def is_configured() -> bool:
    key, base_url, _ = _config()
    return bool(key and base_url)


def get_client() -> Any:
    key, base_url, _ = _config()
    if not (key and base_url):
        raise LlmNotConfigured("The language model is not configured. Set LLM_API_KEY and LLM_BASE_URL.")
    from openai import OpenAI

    timeout = float(os.getenv("LLM_TIMEOUT_SECONDS", "60"))
    return OpenAI(api_key=key, base_url=base_url, timeout=timeout, max_retries=1)


_THINK = re.compile(r"<think>.*?</think>\s*", flags=re.DOTALL | re.IGNORECASE)
# Reasoning models (gpt-oss, qwen3, deepseek-r1...) spend completion tokens "thinking" before they
# answer. Without extra room the visible answer can come back empty.
REASONING_EXTRA_TOKENS = 1024


def _is_reasoning_model(model: str) -> bool:
    name = model.lower()
    return any(tag in name for tag in ("gpt-oss", "qwen3", "deepseek-r1", "o1", "o3", "o4-mini"))


def describe_error(error: Exception, model: str) -> str:
    """A one-line reason a person can act on, plus the provider's own message."""
    status = getattr(error, "status_code", None)
    detail = str(error)
    body = getattr(error, "body", None)
    if isinstance(body, dict):
        inner = body.get("error", body)
        if isinstance(inner, dict) and inner.get("message"):
            detail = str(inner["message"])
    hints = {
        401: "The API key was rejected. Check LLM_API_KEY in .env (no quotes or spaces).",
        403: "This API key is not allowed to use that model.",
        404: f"The model '{model}' is not available for this key. Change LLM_MODEL in .env.",
        413: "The request is larger than the provider allows on this plan. Lower top_k or chunk size.",
        429: "The provider's free rate limit was reached. Wait about a minute and try again.",
    }
    if status in hints:
        return f"{hints[status]} ({detail})"
    if type(error).__name__ in ("APIConnectionError", "APITimeoutError"):
        return f"Could not reach the language model provider at LLM_BASE_URL. Check the internet connection. ({detail})"
    return f"The language model provider failed: {type(error).__name__}: {detail}"


def generate(messages: list[dict[str, str]], temperature: float = 0, max_tokens: int = 512) -> tuple[str, Usage | None]:
    """Returns (text, usage or None when the provider sends no usage)."""
    client = get_client()
    _, _, model = _config()
    options: dict[str, Any] = {"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens}
    if _is_reasoning_model(model):
        options["max_tokens"] = max_tokens + REASONING_EXTRA_TOKENS
        if "gpt-oss" in model.lower():
            options["extra_body"] = {"reasoning_effort": "low"}  # faster answers, fewer hidden tokens
    try:
        response = client.chat.completions.create(**options)
    except LlmNotConfigured:
        raise
    except Exception as error:  # noqa: BLE001 - every provider error becomes LLM_ERROR
        raise LlmError(describe_error(error, model)) from error
    try:
        text = response.choices[0].message.content or ""
    except (AttributeError, IndexError) as error:
        raise LlmError("The language model returned an empty response.") from error
    text = _THINK.sub("", text).strip()  # some models put their reasoning inside <think> tags
    if not text:
        raise LlmError("The language model returned an empty answer. Try again or use another LLM_MODEL.")
    usage = getattr(response, "usage", None)
    if usage is not None and getattr(usage, "prompt_tokens", None) is not None:
        return text, Usage(int(usage.prompt_tokens), int(usage.completion_tokens or 0))
    return text, None
