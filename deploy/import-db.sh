#!/usr/bin/env bash
# Import an uploaded SQLite database into the Docker volume.
# Usage (on server): sudo bash deploy/import-db.sh /path/to/posta.db
set -euo pipefail

SRC="${1:-}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VOLUME_NAME="${PAKETO_VOLUME:-paketo_paketo-data}"

if [[ -z "$SRC" || ! -f "$SRC" ]]; then
  echo "Usage: sudo bash deploy/import-db.sh /path/to/posta.db"
  exit 1
fi

cd "$APP_DIR"

echo "==> Stopping Paketo..."
docker compose down

echo "==> Copying database into volume $VOLUME_NAME ..."
docker volume create "$VOLUME_NAME" >/dev/null 2>&1 || true
docker run --rm \
  -v "${VOLUME_NAME}:/data" \
  -v "$(realpath "$SRC"):/backup.db:ro" \
  alpine sh -c "cp /backup.db /data/posta.db && chmod 644 /data/posta.db"

echo "==> Starting Paketo..."
docker compose up -d

echo "==> Done. Log in with your existing username and password."
echo "    (If POSTA_SECRET changed, you only need to sign in again — passwords are in the DB.)"
