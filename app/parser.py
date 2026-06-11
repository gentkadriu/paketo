import re
from dataclasses import dataclass, field


@dataclass
class ParsedLead:
    first_name: str
    last_name: str
    street: str
    city: str
    postal_code: str
    phone: str


@dataclass
class ParseResult:
    leads: list[ParsedLead] = field(default_factory=list)
    skipped: list[dict] = field(default_factory=list)


def _split_name(full_name: str) -> tuple[str, str]:
    parts = full_name.strip().split()
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])


def _normalize_phone(phone: str) -> str:
    return re.sub(r"[^\d+]", "", phone.strip())


def _is_phone_line(line: str) -> bool:
    digits = re.sub(r"\D", "", line)
    return len(digits) >= 9


def _extract_postal(line: str) -> tuple[str, str]:
    line = line.strip()
    match = re.search(r"\b(\d{5,6})\b", line)
    if match:
        postal = match.group(1)
        city = line.replace(postal, "").strip(" ,")
        return city or line, postal
    return line, ""


def _looks_like_street(line: str) -> bool:
    lower = line.lower()
    if re.search(r"\b\d{1,4}\b", line):
        return True
    markers = ("ul.", "ulica", "bb", "br.", "broj", "steet", "str.")
    return any(m in lower for m in markers)


def _assign_street_city(line_a: str, line_b: str) -> tuple[str, str, str]:
    """Return street, city, postal_code from two address lines (any order)."""
    a_postal = bool(re.search(r"\b\d{5,6}\b", line_a))
    b_postal = bool(re.search(r"\b\d{5,6}\b", line_b))

    if a_postal and not b_postal:
        city, postal = _extract_postal(line_a)
        return line_b.strip(), city, postal
    if b_postal and not a_postal:
        city, postal = _extract_postal(line_b)
        return line_a.strip(), city, postal

    if _looks_like_street(line_a) and not _looks_like_street(line_b):
        city, postal = _extract_postal(line_b)
        return line_a.strip(), city, postal
    if _looks_like_street(line_b) and not _looks_like_street(line_a):
        city, postal = _extract_postal(line_a)
        return line_b.strip(), city, postal

    city, postal = _extract_postal(line_b)
    return line_a.strip(), city, postal


def _parse_single_line_address(line: str) -> tuple[str, str, str]:
    line = line.strip()
    if "," in line:
        left, right = [p.strip() for p in line.split(",", 1)]
        city, postal = _extract_postal(right)
        if postal:
            return left, city, postal
    city, postal = _extract_postal(line)
    if postal and not _looks_like_street(line):
        return "", city, postal
    return line, city or line, postal


def parse_lead_block(lines: list[str]) -> tuple[ParsedLead | None, str | None]:
    if len(lines) < 3:
        return None, "Need name, address, and phone (min 3 lines)"

    if not _is_phone_line(lines[-1]):
        return None, "Last line must be a phone number"

    phone = _normalize_phone(lines[-1])
    first_name, last_name = _split_name(lines[0])
    address_lines = [ln.strip() for ln in lines[1:-1] if ln.strip()]

    if len(address_lines) == 1:
        street, city, postal = _parse_single_line_address(address_lines[0])
    elif len(address_lines) == 2:
        street, city, postal = _assign_street_city(address_lines[0], address_lines[1])
    elif len(address_lines) >= 3:
        street = address_lines[0]
        city, postal = _extract_postal(address_lines[-1])
        if not city:
            city = address_lines[-1]
    else:
        return None, "Missing address lines"

    if not first_name:
        return None, "Missing customer name"

    return ParsedLead(
        first_name=first_name,
        last_name=last_name,
        street=street or "",
        city=city or "",
        postal_code=postal or "",
        phone=phone,
    ), None


def parse_leads_text(text: str) -> list[ParsedLead]:
    return parse_leads_text_detailed(text).leads


def parse_leads_text_detailed(text: str) -> ParseResult:
    blocks = re.split(r"\n\s*\n", text.strip())
    result = ParseResult()

    for index, block in enumerate(blocks, start=1):
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if not lines:
            continue
        lead, error = parse_lead_block(lines)
        if lead:
            result.leads.append(lead)
        else:
            preview = " · ".join(lines[:3])
            if len(lines) > 3:
                preview += "…"
            result.skipped.append({"block": index, "preview": preview, "reason": error or "Unrecognized format"})

    return result


def lead_fingerprint(lead: ParsedLead) -> str:
    phone = re.sub(r"\D", "", lead.phone)
    name = f"{lead.first_name} {lead.last_name}".strip().lower()
    return f"{phone}|{name}"
