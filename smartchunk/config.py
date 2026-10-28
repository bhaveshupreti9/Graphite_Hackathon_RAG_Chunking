"""Chunking settings (spec A5). Field names match the API contract exactly."""

from __future__ import annotations

from dataclasses import asdict, dataclass, fields
from typing import Any


@dataclass(frozen=True)
class Settings:
    min_chunk_tokens: int = 80
    max_chunk_tokens: int = 300
    similarity_threshold: float = 0.45
    dedup_threshold: float = 0.95
    top_k: int = 5
    naive_chunk_tokens: int = 500
    naive_overlap_tokens: int = 50
    not_found_threshold: float = 0.15

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Settings":
        names = {field.name for field in fields(cls)}
        unknown = set(data) - names
        if unknown:
            raise SettingsError(f"Unknown settings: {', '.join(sorted(unknown))}.")
        missing = names - set(data)
        if missing:
            raise SettingsError(f"Missing settings: {', '.join(sorted(missing))}.")
        settings = cls(**data)
        settings.validate()
        return settings

    def validate(self) -> None:
        """Raises SettingsError with a readable message when a value is out of range (spec A5)."""
        rules: list[tuple[str, float, float, bool]] = [
            ("min_chunk_tokens", 20, 200, True),
            ("max_chunk_tokens", 100, 512, True),
            ("similarity_threshold", 0.0, 1.0, False),
            ("dedup_threshold", 0.80, 1.0, False),
            ("top_k", 1, 10, True),
            ("naive_chunk_tokens", 100, 1000, True),
            ("naive_overlap_tokens", 0, 200, True),
            ("not_found_threshold", 0.0, 1.0, False),
        ]
        for name, low, high, integer in rules:
            value = getattr(self, name)
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise SettingsError(f"{name} must be a number.")
            if integer and int(value) != value:
                raise SettingsError(f"{name} must be a whole number.")
            if not low <= value <= high:
                raise SettingsError(f"{name} must be between {low} and {high} (got {value}).")
        if self.min_chunk_tokens >= self.max_chunk_tokens:
            raise SettingsError("min_chunk_tokens must be lower than max_chunk_tokens.")
        if self.naive_overlap_tokens >= self.naive_chunk_tokens:
            raise SettingsError("naive_overlap_tokens must be lower than naive_chunk_tokens.")


class SettingsError(ValueError):
    """A settings value is missing or outside the range allowed by spec A5."""


DEFAULT_SETTINGS = Settings()
