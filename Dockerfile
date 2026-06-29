# syntax=docker/dockerfile:1

# --- Stage 1: build the SPA ---
FROM node:24-alpine AS frontend
# Version shown in the footer; set from the image tag in CI, "dev" otherwise.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- Stage 2: runtime ---
FROM python:3.14-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    STATIC_DIR=/app/static
WORKDIR /app

COPY backend/ ./backend/
RUN pip install ./backend

COPY --from=frontend /frontend/dist ./static/

RUN groupadd --gid 10001 app \
    && useradd --create-home --uid 10001 --gid 10001 app
# Numeric so Kubernetes' runAsNonRoot check passes without a passwd lookup.
USER 10001:10001

WORKDIR /app/backend
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health').status==200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
