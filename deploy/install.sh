#!/usr/bin/env bash
# First-time setup on Ubuntu/Debian VPS (Hetzner, DigitalOcean, etc.).
# From project folder: sudo bash deploy/install.sh
set -euo pipefail

REPO_URL="${PAKETO_REPO_URL:-}"

if [[ ! -f /etc/debian_version ]]; then
  echo "This script supports Ubuntu/Debian only. Use Ubuntu 24.04 on your VPS."
  exit 1
fi

echo "==> Installing Docker..."
apt-get update
apt-get install -y ca-certificates curl git python3 ufw
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "${VERSION_CODENAME}") stable" \
  | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

systemctl enable docker
systemctl start docker

if command -v ufw >/dev/null && ufw status | grep -q inactive; then
  ufw allow OpenSSH
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
  echo "==> UFW enabled: SSH, HTTP, HTTPS"
fi

if [[ -f "$(pwd)/docker-compose.yml" ]]; then
  APP_DIR="$(pwd)"
elif [[ -n "$REPO_URL" ]]; then
  APP_DIR="/opt/paketo"
  echo "==> Cloning $REPO_URL ..."
  rm -rf "$APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
else
  APP_DIR="/opt/paketo"
  if [[ ! -f "$APP_DIR/docker-compose.yml" ]]; then
    echo "Clone the repo first, e.g.:"
    echo "  sudo git clone https://github.com/YOUR_USER/paketo.git /opt/paketo"
    echo "  cd /opt/paketo && sudo bash deploy/install.sh"
    exit 1
  fi
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
echo "Paketo is running on port 8000 (Docker restart: unless-stopped)."
echo "Test: http://YOUR_SERVER_IP:8000"
echo "SSH: ssh root@YOUR_SERVER_IP   (Hetzner) or ssh ubuntu@YOUR_SERVER_IP"
echo ""
echo "Production .env checklist:"
echo "  PAKETO_ENV=production"
echo "  PAKETO_ALLOW_REGISTER=0"
echo "  PAKETO_HTTPS=1"
echo "  TELEGRAM_BOT_TOKEN=... (optional, SnapPaketo group)"
echo ""
echo "Updates: cd $APP_DIR && sudo ./deploy/deploy.sh"
