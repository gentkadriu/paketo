#!/usr/bin/env bash
# Update Paketo on the server after git push.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "Missing .env — copy .env.example to .env and set POSTA_SECRET first."
  exit 1
fi

echo "==> Pulling latest code..."
git pull

echo "==> Rebuilding and restarting..."
docker compose build --pull
docker compose up -d

echo "==> Done. App running on port ${POSTA_PORT:-8000} (see .env)."
