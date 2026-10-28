# SmartChunk API for a Hugging Face Docker Space (free CPU: 2 vCPU, 16 GB RAM).
# The embedding model, the tokenizer file and the evaluation results are baked in at build time,
# so the server starts fast and never needs to download anything while running.
FROM python:3.11-slim

RUN useradd -m -u 1000 user
ENV HOME=/home/user \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/home/user/.cache/huggingface \
    TIKTOKEN_CACHE_DIR=/home/user/.cache/tiktoken \
    EMBEDDING_BACKEND=sentence-transformers \
    DATA_DIR=/home/user/app/runtime/data \
    OUTPUTS_DIR=/home/user/app/runtime/outputs \
    CHROMA_PATH=/home/user/app/runtime/chroma
WORKDIR /home/user/app

# CPU-only PyTorch first (about 200 MB instead of 2 GB with CUDA), then everything else.
COPY --chown=user requirements.txt .
RUN pip install torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install -r requirements.txt

COPY --chown=user . .
USER user

# Download the model and tokenizer now, and fail the build loudly if either is missing.
RUN python -c "from retrieval.embedder import get_embedder, backend_name; get_embedder(); print('embedder:', backend_name())" \
 && python -c "from smartchunk.tokenizer import using_tiktoken; assert using_tiktoken(), 'tiktoken file missing'; print('tiktoken ok')"

# Real evaluation numbers for the /evaluation page (skipped without failing the build if it errors).
RUN python -m eval.run_eval || echo "evaluation skipped"

EXPOSE 7860
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "7860"]
