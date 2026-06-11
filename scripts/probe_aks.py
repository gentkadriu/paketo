import httpx
import re

r = httpx.get("https://akskurir.com/Tracking/index", follow_redirects=True, timeout=30)
print("status", r.status_code)
print("cookies", dict(r.cookies))
html = r.text
for pat in ["BotDetectCaptcha", "GetTrackData", "TrackingNumber", "ExampleCaptcha"]:
    matches = re.findall(r".{0,50}" + pat + r".{0,80}", html, re.I)
    print(f"\n=== {pat} ({len(matches)}) ===")
    for x in matches[:5]:
        print(x.replace("\n", " ")[:150])

# captcha image url
imgs = re.findall(r'(BotDetectCaptcha\.ashx[^"\']+)', html)
print("\n=== captcha urls ===")
for u in imgs[:5]:
    print(u)
