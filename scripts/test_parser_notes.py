"""Quick parser test for notes and bundle marks."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.parser import parse_leads_text_detailed

SAMPLE = """
Marko  Ristic
Ljubomira Stevanovica 5a Bolec 
Postanski broj 11307
0604590002
Napomena auto servis miki f4 bolec

Mballa Ewolo Thelesphore (6 copa 3490) 
Lipovacka 50
Belgrade
0616543086

Boban Jovanović 
Milutina Milankovića bb 
novi Beograd auto perionica kristal
0621041819
(qikjo duhet tpremten me mrri)
"""

if __name__ == "__main__":
    r = parse_leads_text_detailed(SAMPLE)
    print(f"leads={len(r.leads)} skipped={len(r.skipped)}")
    for s in r.skipped:
        print("SKIP:", s["preview"], s["reason"])
    for l in r.leads:
        name = f"{l.first_name} {l.last_name}".strip()
        print(
            f"- {name} | notes={l.notes!r} | bundle={l.bundle_count} "
            f"pcs={l.stock_units} rsd={l.sale_product_rsd}"
        )
