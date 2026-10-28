"""FastAPI app. Run from the project root with ONE worker (job status is kept in memory):

    uvicorn backend.main:app --port 8000
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

# Always the .env next to requirements.txt, whatever folder uvicorn is started from, and it wins
# over stale values set in the terminal or in Windows.
if os.getenv("SMARTCHUNK_SKIP_DOTENV") != "1":  # the test suite sets this
    load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)

from retrieval import embedder  # noqa: E402 - .env must be loaded before modules read env vars

from .errors import register_error_handlers  # noqa: E402
from .routes import router  # noqa: E402

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("smartchunk")


def _warm_embedder() -> None:
    try:
        embedder.get_embedder()
        logger.info("Embedding backend ready: %s", embedder.backend_name())
    except Exception as error:  # noqa: BLE001 - health reports embedding_model_loaded=false instead
        logger.error("Embedding model failed to load: %s", error)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    if os.getenv("SKIP_WARMUP") != "1":
        await run_in_threadpool(_warm_embedder)
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="SmartChunk API", version="1.0.0", lifespan=lifespan)
    origins = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if origin.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )
    register_error_handlers(app)
    app.include_router(router, prefix="/api")
    return app


app = create_app()
