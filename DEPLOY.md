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
```

Restart after changes:

```bash
cd /opt/paketo && docker compose up -d --build
```

### First admin user

With `PAKETO_ALLOW_REGISTER=0`, public signup is off. For a **fresh server**:

1. Temporarily set `PAKETO_ALLOW_REGISTER=1`, restart, register once, then set back to `0`, **or**
2. Copy your existing `data/posta.db` to the server volume (migration from local).

Promote your account to admin in the DB, or use username `auloni` (auto-admin on bootstrap). Then create other users in **Admin**.

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
