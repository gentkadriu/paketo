from app.parser import parse_leads_text_detailed, _phone_from_text, _split_city_postal

phones = [
    "+381 63 131 0443",
    "+381 63 1310 443",
    "063 131 0443",
    "063 1310 443",
    "0631310443",
    "061-367-89-95",
    "TEL0612948670",
    "26212 0631310443",
    "11317",
    "15000",
]
for p in phones:
    ph, rest = _phone_from_text(p)
    _, postal = _split_city_postal(p)
    print(f"{p!r:35} phone={ph or '-':12} postal={postal or '-'}")

print("--- full paste ---")
text = open("_full_paste.txt", encoding="utf-8").read()
start = text.find("ime:David")
text = text[: text.find("it should detect")]
r = parse_leads_text_detailed(text)
print(len(r.leads), "parsed", len(r.skipped), "skipped")
for s in r.skipped:
    print(" SKIP", s["preview"][:60], s["reason"])
