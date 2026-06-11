import httpx
import json

BASE = "https://akskurir.com"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}

def track(order_id):
    c = httpx.Client(base_url=BASE, follow_redirects=True, timeout=30)
    c.get("/Tracking/index", headers=HEADERS)
    r = c.post(
        "/Tracking/GetTrackData",
        headers={
            **HEADERS,
            "Content-Type": "application/json; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": f"{BASE}/Tracking/index",
            "Origin": BASE,
        },
        content=json.dumps(order_id),
    )
    return r.status_code, r.json()

for oid in ["91766000346509", "91700000000000", "invalid"]:
    print(oid, track(oid))

# second order same session
c = httpx.Client(base_url=BASE, follow_redirects=True, timeout=30)
c.get("/Tracking/index", headers=HEADERS)
for oid in ["91766000346509", "91766000346509"]:
    r = c.post("/Tracking/GetTrackData", headers={**HEADERS, "Content-Type": "application/json; charset=UTF-8", "X-Requested-With": "XMLHttpRequest", "Referer": f"{BASE}/Tracking/index", "Origin": BASE}, content=json.dumps(oid))
    d = r.json()
    print("batch", oid, d.get("Res"), len(d.get("lstData") or []))
