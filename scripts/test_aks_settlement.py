"""Test AKS settlement parser on sample file."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.aks_settlement import parse_settlement_file, settlement_product_rsd

SAMPLE = Path(r"c:\Users\gentk\Downloads\S0000445054_10-12-2025_SHKUMBIM_AHMETI_gentkadriu66@gmail.com.xls")


def main() -> None:
    content = SAMPLE.read_bytes()
    parsed = parse_settlement_file(SAMPLE.name, content)
    assert parsed.settlement_ref == "0000445054"
    assert len(parsed.lines) == 16
    assert parsed.lines[0].order_id == "91789000348218"
    assert parsed.lines[0].aks_amount_rsd == 1650.0
    assert settlement_product_rsd(1650.0, bundle_count=0) == 1000.0
    assert settlement_product_rsd(1650.0, bundle_count=2) == 2000.0
    print("OK:", len(parsed.lines), "lines,", parsed.settlement_ref)


if __name__ == "__main__":
    main()
