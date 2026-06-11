#!/usr/bin/env bash
# First-time setup on Ubuntu (Oracle Always Free VM).
# Run as root: bash deploy/install-oracle.sh
set -euo pipefail

APP_DIR="/opt/paketo"
REPO_URL="${PAKETO_REPO_URL:-}"

echo "==> Installing Docker..."
apt-get update
apt-get install -y ca-certificates curl git
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "${VERSION_CODENAME}") stable" \
  | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

if [[ -n "$REPO_URL" ]]; then
  echo "==> Cloning $REPO_URL ..."
  git clone "$REPO_URL" "$APP_DIR"
else
  echo "==> Copy project to $APP_DIR (git clone or scp), then re-run from that folder."
  mkdir -p "$APP_DIR"
fi

cd "$APP_DIR"

if [[ ! -f .env ]]; then
  cp .env.example .env
  SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(48))")
  sed -i "s|change-me-to-a-long-random-string|$SECRET|" .env
  sed -i 's|POSTA_DB_PATH=./data/posta.db|POSTA_DB_PATH=/data/posta.db|' .env
  echo "==> Created .env with random POSTA_SECRET"
fi

chmod +x deploy/deploy.sh
docker compose up -d --build

echo ""
echo "Paketo is running on port 8000."
echo "Open firewall: allow TCP 8000 (or 80 after nginx)."
echo "Public URL: http://YOUR_VM_PUBLIC_IP:8000"
echo ""
echo "Updates later: cd $APP_DIR && ./deploy/deploy.sh"
