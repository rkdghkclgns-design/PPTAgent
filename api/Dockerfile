# FastAPI wrapper image.
#
# Build context: repo root (we need the deeppresenter/ + pptagent/ packages)
#   docker build -f api/Dockerfile -t pptagent-api .
#
# Runtime deps:
#   * Playwright/Chromium - deeppresenter's webview uses it to rasterise slides
#   * Node 20             - deeppresenter/html2pptx/ conversion helper
#   * poppler-utils       - PDF rasterisation
#
# We do NOT ship Docker-in-Docker here. The /docker mount is expected to be
# wired at container start time (docker-compose or Railway with DOCKER_HOST).

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=7870 \
    HOST=0.0.0.0 \
    NODE_VERSION=20.x

# System deps for Playwright / PDF / Node
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg git build-essential \
        poppler-utils libmagic1 fonts-noto-cjk \
    && curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION} | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# uv - pinned to a specific release tag so supply-chain changes upstream
# don't silently reshape the image. Bump intentionally; avoid :latest.
COPY --from=ghcr.io/astral-sh/uv:0.8.15 /uv /usr/local/bin/uv

WORKDIR /app

# --- Python deps ---------------------------------------------------------
COPY pyproject.toml uv.lock README.md MANIFEST.in ./
COPY api/requirements.txt api/requirements.txt
COPY deeppresenter ./deeppresenter
COPY pptagent ./pptagent

RUN uv pip install --system -r api/requirements.txt \
    && uv pip install --system -e . \
    && python -m playwright install --with-deps chromium

# --- Node deps for html2pptx ---------------------------------------------
RUN npm install --prefix deeppresenter/html2pptx --omit=dev

# --- App code ------------------------------------------------------------
COPY api ./api

EXPOSE 7870
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "7870"]
