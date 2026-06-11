"""Test refresh-tracking API endpoint."""
import sqlite3
from fastapi.testclient import TestClient

from app.main import app
from app.auth import create_access_token

conn = sqlite3.connect("posta.db")
conn.row_factory = sqlite3.Row
user = conn.execute("SELECT id, username FROM users LIMIT 1").fetchone()
if not user:
    print("No user in DB")
    raise SystemExit(1)

token = create_access_token(user["id"], user["username"])
client = TestClient(app)
headers = {"Authorization": f"Bearer {token}"}

leads = conn.execute(
    "SELECT id, order_id FROM leads WHERE batch_id=5 AND order_id IS NOT NULL"
).fetchall()

for lead in leads:
    r = client.post(f"/api/leads/{lead['id']}/refresh-tracking", headers=headers)
    print(lead["id"], lead["order_id"], r.status_code, r.json().get("ok"), r.json().get("error", "")[:40] if not r.json().get("ok") else r.json()["lead"].get("tracking_status", "")[:40])
