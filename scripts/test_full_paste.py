from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.parser import parse_leads_text_detailed

text = Path(__file__).with_name("user_paste_sample.txt").read_text(encoding="utf-8")
r = parse_leads_text_detailed(text)
print("leads", len(r.leads), "skipped", len(r.skipped))
for s in r.skipped[:5]:
    print("SKIP", s["preview"][:60], s["reason"])
multi = [l for l in r.leads if l.bundle_count > 1 or l.notes]
print("with notes or bundle:", len(multi))
