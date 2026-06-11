import httpx
import re
import json

BASE = "https://akskurir.com"
ORDER_ID = "91766000346509"

client = httpx.Client(base_url=BASE, follow_redirects=True, timeout=30)
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}

r = client.get("/Tracking/index", headers=headers)
html = r.text
print("session cookies ok")

# extract captcha token from image src
m = re.search(r"get=image&amp;c=ExampleCaptcha&amp;t=([a-f0-9]+)", html)
if not m:
    m = re.search(r"get=image&c=ExampleCaptcha&t=([a-f0-9]+)", html)
token = m.group(1) if m else None
print("captcha token", token)

# try GetTrackData without captcha
r2 = client.post(
    "/Tracking/GetTrackData",
    headers={
        **headers,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": f"{BASE}/Tracking/index",
        "Origin": BASE,
    },
    content=json.dumps(ORDER_ID),
)
print("GetTrackData no captcha:", r2.status_code, r2.text[:500])

# download captcha image
if token:
    img = client.get(
        f"/Tracking/BotDetectCaptcha.ashx?get=image&c=ExampleCaptcha&t={token}",
        headers={**headers, "Referer": f"{BASE}/Tracking/index"},
    )
    print("captcha image", img.status_code, len(img.content), img.headers.get("content-type"))
    with open("scripts/captcha_sample.png", "wb") as f:
        f.write(img.content)

# try validation with dummy code
if token:
    for code in ["TEST", "tbpr"]:
        v = client.get(
            f"/Tracking/BotDetectCaptcha.ashx?get=validation-result&c=ExampleCaptcha&t={token}&i={code}",
            headers={**headers, "Referer": f"{BASE}/Tracking/index"},
        )
        print(f"validate '{code}':", v.text.strip())

# search for js tracking logic
for script in re.findall(r'src="(/[^"]+\.js[^"]*)"', html):
    if "track" in script.lower() or "custom" in script.lower():
        print("js", script)
