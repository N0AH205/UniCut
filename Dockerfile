FROM python:3.13-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/home/unicut/.cache/huggingface \
    NUMBA_CACHE_DIR=/home/unicut/.cache/numba

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN python -m pip install -r requirements.txt

RUN useradd --create-home --uid 10001 unicut \
    && mkdir -p /home/unicut/.cache/huggingface /home/unicut/.cache/numba \
    && chown -R unicut:unicut /home/unicut/.cache

COPY server.py ./
COPY core/ ./core/
COPY static/ ./static/
COPY LICENSE THIRD_PARTY_NOTICES.md ./
COPY licenses/ ./licenses/

LABEL org.opencontainers.image.title="UniCut" \
      org.opencontainers.image.source="https://github.com/N0AH205/UniCut" \
      org.opencontainers.image.licenses="MIT"

USER unicut
EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=5s --start-period=300s --retries=10 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:7860/api/health', timeout=3).close()"

CMD ["python", "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "7860", "--workers", "1"]
