"""ApiError and the handlers that turn every failure into the spec A4 envelope:
{"error": {"code": "...", "message": "..."}}"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("smartchunk.api")

STATUS = {
    "INVALID_FILE_TYPE": 415,
    "FILE_TOO_LARGE": 413,
    "EMPTY_DOCUMENT": 422,
    "SCANNED_PDF": 422,
    "ENCRYPTED_PDF": 422,
    "VALIDATION_ERROR": 422,
    "DOC_NOT_FOUND": 404,
    "SAMPLE_NOT_FOUND": 404,
    "NOT_PROCESSED": 409,
    "PROCESSING_IN_PROGRESS": 409,
    "LLM_NOT_CONFIGURED": 503,
    "LLM_ERROR": 502,
    "EVAL_NOT_AVAILABLE": 404,
    "INTERNAL_ERROR": 500,
    "UNAUTHORIZED": 401,
    "INVALID_CREDENTIALS": 401,
    "USERNAME_TAKEN": 409,
}


class ApiError(Exception):
    def __init__(self, code: str, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status or STATUS.get(code, 500)


def envelope(code: str, message: str, status: int) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


def _validation_message(error: RequestValidationError) -> str:
    parts = []
    for item in error.errors()[:3]:
        location = ".".join(str(piece) for piece in item.get("loc", ()) if piece not in ("body", "query", "path"))
        message = str(item.get("msg", "invalid value")).removeprefix("Value error, ")
        parts.append(f"{location}: {message}" if location else message)
    return "; ".join(parts) or "The request is not valid."


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_request: Request, error: ApiError) -> JSONResponse:
        return envelope(error.code, error.message, error.status)

    @app.exception_handler(RequestValidationError)
    async def _validation(_request: Request, error: RequestValidationError) -> JSONResponse:
        return envelope("VALIDATION_ERROR", _validation_message(error), 422)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_request: Request, error: StarletteHTTPException) -> JSONResponse:
        if error.status_code == 404:
            return envelope("NOT_FOUND", "This API route does not exist.", 404)
        if error.status_code == 405:
            return envelope("VALIDATION_ERROR", "This HTTP method is not allowed here.", 405)
        return envelope("INTERNAL_ERROR", str(error.detail), error.status_code)

    @app.exception_handler(Exception)
    async def _unexpected(_request: Request, error: Exception) -> JSONResponse:
        logger.exception("Unexpected error: %s", error)
        return envelope("INTERNAL_ERROR", "Something went wrong on the server.", 500)
