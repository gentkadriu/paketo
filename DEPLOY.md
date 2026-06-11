# Deploy Paketo (Oracle Cloud / any Linux VM)

## What's in this repo

| File | Purpose |
|------|---------|
| `Dockerfile` | Builds frontend + runs Python app |
| `docker-compose.yml` | Runs 24/7 with persistent DB volume |
| `.env.example` | Copy to `.env` and set secrets |
| `deploy/install-oracle.sh` | First-time VM setup |
| `deploy/deploy.sh` | Update after `git push` |
| `deploy/nginx-paketo.conf` | Optional reverse proxy on port 80 |
| `scripts/reset_db.py` | Wipe DB and start fresh |

Database file: `data/posta.db` locally, `/data/posta.db` in Docker volume.

---

## 1. Oracle Cloud — create Always Free VM

1. Sign up at [cloud.oracle.com](https://cloud.oracle.com) (card hold ~$1, not a charge).
2. **Create VM:**
   - Shape: **Ampere** → **VM.Standard.A1.Flex**
   - **Always Free-eligible**: 1 OCPU, 6 GB RAM (enough for Paketo)
   - OS: **Ubuntu 22.04** or 24.04
   - Add SSH key (download private key)
3. **Networking:**
   - Note the **public IP**
   - Security list / NSG: allow inbound **TCP 22** (SSH), **8000** (app), later **80/443** if using nginx
4. SSH in:
   ```bash
   ssh ubuntu@YOUR_PUBLIC_IP
   ```

---

## 2. First deploy on the VM

### Option A — Git (recommended)

On your PC, push this project to a **private GitHub repo**.

On the VM:

```bash
sudo bash -c 'PAKETO_REPO_URL=https://github.com/YOU/paketo.git bash -s' < deploy/install-oracle.sh
```

Or manually:

```bash
sudo apt update && sudo apt install -y git
sudo git clone https://github.com/YOU/paketo.git /opt/paketo
cd /opt/paketo
cp .env.example .env
# Edit .env: set POSTA_SECRET (see below)
sudo bash deploy/install-oracle.sh
```

Generate secret:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

Put it in `.env` as `POSTA_SECRET=...`

### Option B — Copy folder from PC

```powershell
scp -r C:\Users\gentk\Desktop\POSTA ubuntu@YOUR_IP:/opt/paketo
```

Then SSH and run `deploy/install-oracle.sh` from `/opt/paketo`.

---

## 3. Open the app

- **http://YOUR_PUBLIC_IP:8000**
- Register a new account (DB is empty)

---

## 4. Push updates later

On the VM:

```bash
cd /opt/paketo
./deploy/deploy.sh
```

From your PC after coding:

```bash
git push
ssh ubuntu@YOUR_IP "cd /opt/paketo && ./deploy/deploy.sh"
```

---

## 5. Free domain / URL options

**There is no `vercel.app` for your own VM** — that only works on Vercel's platform.

| Option | Cost | HTTPS | Notes |
|--------|------|-------|-------|
| **Public IP only** | Free | No | `http://IP:8000` — works immediately |
| **[DuckDNS](https://www.duckdns.org)** | Free | No* | `yourname.duckdns.org` → your VM IP. Easy signup. |
| **[No-IP](https://www.noip.com)** | Free | No* | Free subdomain, confirm every 30 days |
| **nip.io / sslip.io** | Free | No | `http://YOUR.IP.nip.io:8000` — no signup, for testing |
| **Cloudflare Tunnel** | Free | Yes | Stable HTTPS URL; needs free Cloudflare account |
| **Domain + Cloudflare** | ~$8–10/year | Yes | Best long-term: buy `.com`, point DNS to VM, free SSL |

\* Add **nginx + Let's Encrypt** (certbot) on the VM for HTTPS with DuckDNS/No-IP.

### Quick DuckDNS setup

1. Create account at duckdns.org → subdomain e.g. `paketo.duckdns.org`
2. Point it to your Oracle VM public IP
3. Open app at `http://paketo.duckdns.org:8000`
4. Optional: install nginx (`deploy/nginx-paketo.conf`) on port 80 so you can drop `:8000`

### Cloudflare Tunnel (free HTTPS, no open ports)

```bash
# On VM — see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb -o cf.deb
sudo dpkg -i cf.deb
cloudflared tunnel --url http://localhost:8000
```

Gives a temporary `*.trycloudflare.com` URL. For a fixed name, use a Cloudflare account + tunnel config.

---

## 6. Fresh database

Local:

```bash
python scripts/reset_db.py
```

On server (keeps Docker volume):

```bash
docker compose down
docker volume rm paketo_paketo-data   # or: docker compose down -v
docker compose up -d --build
```

---

## 7. Stay on Oracle Always Free

- Use **Ampere A1 Flex** marked Always Free only
- Do **not** create extra paid disks or load balancers
- **Always Free** keeps running after the 30-day $300 trial ends
- Back up DB occasionally: `docker compose exec paketo cat /data/posta.db > backup.db` or copy from volume

---

## 8. Optional: nginx on port 80

```bash
sudo apt install -y nginx
sudo cp deploy/nginx-paketo.conf /etc/nginx/sites-available/paketo
sudo ln -s /etc/nginx/sites-available/paketo /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Open TCP **80** in Oracle firewall. App at `http://YOUR_IP` or `http://yourname.duckdns.org`.

HTTPS with DuckDNS: `sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx -d yourname.duckdns.org`
