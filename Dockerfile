# CaptionLive - small, non-root production image (~150 MB)
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

# ffmpeg lets the same image run `captionlive ingest` against SRT/RTMP/sound-card feeds
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md LICENSE ./
COPY captionlive ./captionlive
RUN pip install . && useradd --create-home --uid 10001 captionlive
COPY examples ./examples

USER captionlive
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s CMD python -c "import urllib.request,os;urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8000\")}/api/health')"
# Cloud Run / Heroku style $PORT is honoured
CMD ["sh", "-c", "exec captionlive serve --port ${PORT:-8000}"]
