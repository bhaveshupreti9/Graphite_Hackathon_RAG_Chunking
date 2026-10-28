"""Accounts and sessions: each user only sees the documents they uploaded.

Passwords are stored as salted PBKDF2-SHA256 hashes, never in plain text. A login returns a random
token; the server keeps only its SHA-256 hash, with an expiry. Files: data/users.json and
data/sessions.json (atomic writes, guarded by a lock).

Set AUTH_REQUIRED=false to switch accounts off: every request then acts as the user "guest".
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import Header

from . import paths
from .errors import ApiError

GUEST = "guest"
SESSION_SECONDS = 7 * 24 * 3600
PBKDF2_ROUNDS = 200_000
USERNAME = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")
MIN_PASSWORD = 6

_lock = threading.RLock()


def auth_required() -> bool:
    return os.getenv("AUTH_REQUIRED", "true").strip().lower() not in ("0", "false", "no", "off")


def _users_file() -> Path:
    return paths.data_dir() / "users.json"


def _sessions_file() -> Path:
    return paths.data_dir() / "sessions.json"


def _load(file: Path) -> dict[str, Any]:
    if not file.exists():
        return {}
    try:
        data = json.loads(file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _save(file: Path, data: dict[str, Any]) -> None:
    file.parent.mkdir(parents=True, exist_ok=True)
    tmp = file.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp.replace(file)


def _hash_password(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ROUNDS).hex()


def _token_key(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _new_session(username: str) -> str:
    token = secrets.token_urlsafe(32)
    now = time.time()
    with _lock:
        sessions = {key: value for key, value in _load(_sessions_file()).items() if value.get("expires", 0) > now}
        sessions[_token_key(token)] = {"username": username, "expires": now + SESSION_SECONDS}
        _save(_sessions_file(), sessions)
    return token


def register(username: str, password: str) -> dict[str, str]:
    username = username.strip()
    if not USERNAME.match(username):
        raise ApiError(
            "VALIDATION_ERROR", "Usernames are 3 to 32 characters: letters, numbers, dot, dash or underscore.", 422
        )
    if len(password) < MIN_PASSWORD:
        raise ApiError("VALIDATION_ERROR", f"Passwords need at least {MIN_PASSWORD} characters.", 422)
    if username.lower() == GUEST:
        raise ApiError("USERNAME_TAKEN", "That username is reserved. Pick another one.", 409)
    salt = secrets.token_bytes(16)
    with _lock:
        users = _load(_users_file())
        if username.lower() in users:
            raise ApiError("USERNAME_TAKEN", "That username is already taken. Log in or pick another one.", 409)
        users[username.lower()] = {
            "username": username,
            "salt": salt.hex(),
            "hash": _hash_password(password, salt),
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        _save(_users_file(), users)
    return {"username": username, "token": _new_session(username)}


def login(username: str, password: str) -> dict[str, str]:
    with _lock:
        user = _load(_users_file()).get(username.strip().lower())
    if user is None:
        _hash_password(password, b"0" * 16)  # same work either way, so timing doesn't reveal usernames
        raise ApiError("INVALID_CREDENTIALS", "Wrong username or password.", 401)
    expected = user["hash"]
    actual = _hash_password(password, bytes.fromhex(user["salt"]))
    if not hmac.compare_digest(expected, actual):
        raise ApiError("INVALID_CREDENTIALS", "Wrong username or password.", 401)
    return {"username": user["username"], "token": _new_session(user["username"])}


def logout(token: str) -> None:
    with _lock:
        sessions = _load(_sessions_file())
        if sessions.pop(_token_key(token), None) is not None:
            _save(_sessions_file(), sessions)


def user_for_token(token: str) -> str | None:
    with _lock:
        session = _load(_sessions_file()).get(_token_key(token))
    if not session or session.get("expires", 0) <= time.time():
        return None
    return str(session["username"])


def bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, value = authorization.partition(" ")
    return value.strip() if scheme.lower() == "bearer" and value.strip() else None


def current_user(authorization: str | None = Header(default=None)) -> str:
    """FastAPI dependency: the logged-in username, or 401 UNAUTHORIZED."""
    if not auth_required():
        return GUEST
    token = bearer_token(authorization)
    username = user_for_token(token) if token else None
    if username is None:
        raise ApiError("UNAUTHORIZED", "Please log in to continue.", 401)
    return username
