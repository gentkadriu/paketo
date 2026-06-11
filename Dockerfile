FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY run.py .
COPY --from=frontend /app/frontend/dist ./frontend/dist

ENV POSTA_DB_PATH=/data/posta.db
ENV POSTA_HOST=0.0.0.0
ENV POSTA_PORT=8000
ENV PYTHONUNBUFFERED=1

EXPOSE 8000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://127.0.0.1:8000/api/health || exit 1

CMD ["python", "run.py"]
