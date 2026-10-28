---
title: SmartChunk API
emoji: 🧩
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
---

SmartChunk backend (FastAPI). Health check: `/api/health`. Interactive docs: `/docs`.

Set these under **Settings → Variables and secrets**:

| Name | Type | Example |
|---|---|---|
| `LLM_API_KEY` | Secret | your Groq or OpenAI key |
| `LLM_BASE_URL` | Variable | `https://api.groq.com/openai/v1` |
| `LLM_MODEL` | Variable | `llama-3.1-8b-instant` |
| `CORS_ORIGINS` | Variable | your frontend URL, or `*` |

Free Spaces have no persistent disk: uploaded documents are lost when the Space restarts or sleeps.
