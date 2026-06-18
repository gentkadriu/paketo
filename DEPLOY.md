# Deploy Paketo (Linux VPS — Hetzner recommended)

## What's in this repo

| File | Purpose |
|------|---------|
| `Dockerfile` | Builds frontend + runs Python app |
| `docker-compose.yml` | Runs 24/7 with `restart: unless-stopped` |
| `.env.example` | Copy to `.env` and set secrets |
| `deploy/install.sh` | First-time VPS setup (Ubuntu) |
| `deploy/deploy.sh` | Update after `git push` |
| `deploy/nginx-paketo.conf` | Reverse proxy on port 80 |
| `scripts/reset_db.py` | Wipe DB and start fresh |

Database: `data/posta.db` locally, `/data/posta.db` in Docker volume `paketo-data`.

---

## 1. Create a VPS (Hetzner)

1. Sign up at [hetzner.com/cloud](https://www.hetzner.com/cloud).
2. **Create server:**
   - **CX22** (2 vCPU, 4 GB RAM) — enough for 15–20 users
   - Location: Falkenstein or Helsinki
   - OS: **Ubuntu 24.04**
   - Add your SSH key
3. Note the **public IPv4** from the Hetzner console.
4. SSH in:
   ```bash
   ssh root@YOUR_SERVER_IP
   ```
   (DigitalOcean and similar: user is often `ubuntu`.)

**Alternatives:** DigitalOcean droplet ($6/mo), any Ubuntu 24.04 VPS.

---

## 2. First deploy

### Option A — Git (recommended)

Push this project to a **private GitHub repo**, then on the server:

```bash
git clone https://github.com/YOUR_USER/paketo.git /opt/paketo
cd /opt/paketo
bash deploy/install.sh
```

The script installs Docker, creates `.env` with a random `POSTA_SECRET`, and starts the app.

### Option B — Copy from your PC

```powershell
scp -r C:\Users\gentk\Desktop\POSTA root@YOUR_SERVER_IP:/opt/paketo
```

Then SSH and run:

```bash
cd /opt/paketo
bash deploy/install.sh
```

### Production `.env`

Edit `/opt/paketo/.env`:

```env
PAKETO_ENV=production
PAKETO_ALLOW_REGISTER=0
PAKETO_HTTPS=1
POSTA_SECRET=<already set by install script — keep it secret>
POSTA_DB_PATH=/data/posta.db

# Optional — Telegram group notifications (auloni only)
TELEGRAM_BOT_TOKEN=<from @BotFather>
TELEGRAM_CHAT_ID=-5010901587
TELEGRAM_GROUP_NAME=SnapPaketo
TELEGRAM_USER=auloni
PAKETO_PUBLIC_URL=https://paketo.online
```

Restart after changes:

```bash
cd /opt/paketo && docker compose up -d --build
```

### First admin user

With `PAKETO_ALLOW_REGISTER=0`, public signup is off. For a **fresh server**:

1. Temporarily set `PAKETO_ALLOW_REGISTER=1`, restart, register once, then set back to `0`, **or**
2. **Copy your local database** (recommended — keeps all batches, leads, finance, products):

---

## 2b. Move your local data to the server (e.g. user `auloni`)

Everything you added locally is in **one file**:

```
data/posta.db   (on your PC)
```

That file includes your **auloni** account (admin), all batches, orders, finance, and products.

### Step 1 — Upload from Windows

Stop Paketo on your PC first (optional but safer), then:

```powershell
scp C:\Users\gentk\Desktop\POSTA\data\posta.db root@YOUR_SERVER_IP:/opt/paketo/posta.db.upload
```

Use your Hetzner IP and SSH user (`root` on Hetzner).

### Step 2 — Import on the server

SSH into the server:

```bash
cd /opt/paketo
sudo bash deploy/import-db.sh posta.db.upload
rm posta.db.upload
```

This replaces the empty online database with your local one and restarts the app.

### Step 3 — Log in online

Open `http://YOUR_SERVER_IP:8000` and log in as **auloni** with the **same password** as locally.

Notes:

- **`.env` secret** on the server can differ from your PC — that only logs everyone out; **passwords still work** (they live in the DB).
- Do this **before** other users are created on the server, or you will overwrite their data.
- Keep a backup: `cp data/posta.db data/posta.db.backup` on your PC first.

---

### First admin user (without DB copy)

If you start with an empty DB instead:

---

## 3. Open the app

- Quick test: **http://YOUR_SERVER_IP:8000**
- Production: use a domain + HTTPS (section 5).

---

## 4. Push updates later

On the server:

```bash
cd /opt/paketo
./deploy/deploy.sh
```

From your PC:

```bash
git push
ssh root@YOUR_SERVER_IP "cd /opt/paketo && ./deploy/deploy.sh"
```

---

## 5. Domain and HTTPS (recommended for users)

| Option | Cost | HTTPS | Notes |
|--------|------|-------|-------|
| **Domain + Cloudflare DNS** | ~$10/year | Yes (Let's Encrypt) | Best for production |
| **DuckDNS** | Free | Yes* | Quick subdomain for testing |
| **Cloudflare Tunnel** | Free | Yes | No open ports; good for trials |
| **IP only** | Free | No | Testing only — not for real users |

### nginx + Let's Encrypt (Ubuntu)

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo cp /opt/paketo/deploy/nginx-paketo.conf /etc/nginx/sites-available/paketo
sudo ln -sf /etc/nginx/sites-available/paketo /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
# Edit server_name in the config to your domain, then:
sudo nginx -t && sudo systemctl enable --now nginx
sudo certbot --nginx -d app.yourdomain.com
```

Set `PAKETO_HTTPS=1` in `.env` and restart Docker.

Point your domain **A record** to the server IP in Cloudflare (or your registrar).

---

## 6. Backups

Weekly (cron on the server):

```bash
docker compose -f /opt/paketo/docker-compose.yml exec -T paketo cat /data/posta.db > /root/paketo-backup-$(date +%F).db
```

Copy backups off the server (your PC, S3, etc.).

---

## 7. Fresh database

Local:

```bash
python scripts/reset_db.py
```

On server (destroys all data in the volume):

```bash
cd /opt/paketo
docker compose down
docker volume rm paketo_paketo-data
docker compose up -d --build
```

---

## 8. 24/7 operation

- Docker `restart: unless-stopped` in `docker-compose.yml` — app restarts after crashes or reboots.
- Optional systemd unit: `deploy/paketo-docker.service` (copy to `/etc/systemd/system/` if you want compose managed by systemd).
- Do **not** run production on your home PC — use the VPS so users can reach it anytime.

---

## Quick checklist

- [ ] Ubuntu VPS (Hetzner CX22 or similar)
- [ ] `deploy/install.sh` completed
- [ ] `PAKETO_ENV=production`, strong `POSTA_SECRET`, `PAKETO_ALLOW_REGISTER=0`
- [ ] Admin account created
- [ ] Domain + HTTPS
- [ ] Firewall: SSH + 80 + 443 (install script enables UFW)
- [ ] DB backup scheduled
