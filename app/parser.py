"""Flexible lead parser — structure: name, address, phone (last)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.places_rs import city_for_postal, find_city_in, fold_text, postal_for_city, resolve_address


@dataclass
class ParsedLead:
    first_name: str
    last_name: str
    street: str
    city: str
    postal_code: str
    phone: str
    notes: str = ""
    bundle_count: int = 1
    stock_units: int = 0
    sale_product_rsd: int = 0


@dataclass
class ParseResult:
    leads: list[ParsedLead] = field(default_factory=list)
    skipped: list[dict] = field(default_factory=list)


_OFFER_UNIT_RSD = 1000
_DEFAULT_DELIVERY_RSD = 490
_NOTE_LINE = re.compile(r"^\s*napomena\s*[:\-]?\s*", re.I)
_PARENS_ONLY = re.compile(r"^\s*\(([^)]+)\)\s*$")
_PARENS_IN_TEXT = re.compile(r"\(([^)]+)\)")
_PIECE_WORDS = re.compile(
    r"(\d+)\s*(?:copa|kom(?:ada|ade|adi)?|pcs|pieces|komad)\b",
    re.I,
)
_PRICE_NUM = re.compile(r"\b(\d{3,5})\b")
_POSTAL = re.compile(r"(?<!\d)(\d{2}\s?\d{3})(?!\d)")
_POSTAL_GLUE = re.compile(r"([A-Za-zÀ-žĀ-ž]+)(\d{5})\b", re.UNICODE)
_POSTAL_ONLY = re.compile(r"^\s*(\d{2}\s?\d{3})\s*$")

# Serbian mobile: 06X XXX XXXX (10 digits) | 06X XXXX XXX | +381 variants | occasional 9-digit paste
_PHONE = re.compile(
    r"(?<!\d)"
    r"(?:"
    r"\+381[\s\-./]*"
    r")?"
    r"0?"
    r"6[0-9]"
    r"(?:"
    r"[\s\-./]*"
    r"\d"
    r"){6,7}"
    r"(?!\d)",
    re.IGNORECASE,
)
_LABEL = re.compile(
    r"^(?:ime|prezime|ime\s*i\s*prezime|ulica|ul\.?|adresa|mesto|grad|"
    r"broj(?:\s*telefona)?|tel\.?|telefon|postanski\s*(?:broj|br\.?)|"
    r"poštanski\s*(?:broj|br\.?))\s*[:\.]?\s*",
    re.I,
)
_STREET_MARKERS = re.compile(
    r"\b(ul\.?|ulica|bb|br\.?|broj|steet|str\.|selo|ul\s)\b",
    re.I,
)
_INLINE_PRICE_TAIL = re.compile(
    r"\b(\d{3,5})\s*(?:din(?:ara)?|rsd|mkd)?\s*$",
    re.I,
)
_STANDALONE_PRICE = re.compile(r"^\s*(\d{3,5})\s*(?:din(?:ara)?|rsd)?\s*$", re.I)
_STANDALONE_PIECES = re.compile(
    r"^\s*(\d+)\s*(?:copa|kom(?:ada|ade|adi)?|pcs|pieces|komad)\s*$",
    re.I,
)
_UL_PREFIX = re.compile(r"^ul\.?\s+", re.I)
_NOISE = re.compile(
    r"^(?:evo\s+moje\s+adrese|moja\s+adresa|adresa\s+za\s+dostavu)\s*",
    re.I,
)


def _bundle_from_product(product_rsd: int) -> int:
    if product_rsd <= 0:
        return 1
    for snap in (5000, 4000, 3000, 2000, 1000):
        if abs(product_rsd - snap) <= 120:
            return max(1, round(snap / _OFFER_UNIT_RSD))
    return max(1, round(product_rsd / _OFFER_UNIT_RSD))


def _product_from_total(total_rsd: int) -> int:
    without_delivery = total_rsd - _DEFAULT_DELIVERY_RSD
    for snap in (5000, 4000, 3000, 2000, 1000):
        if abs(without_delivery - snap) <= 120:
            return snap
    if without_delivery >= _OFFER_UNIT_RSD:
        bundles = max(1, round(without_delivery / _OFFER_UNIT_RSD))
        return bundles * _OFFER_UNIT_RSD
    return max(_OFFER_UNIT_RSD, without_delivery)


def _is_note_only_line(line: str) -> bool:
    line = line.strip()
    if not line:
        return False
    if _NOTE_LINE.match(line):
        return True
    return bool(_PARENS_ONLY.match(line))


def _extract_note_content(line: str) -> str:
    line = line.strip()
    m = _PARENS_ONLY.match(line)
    if m:
        return m.group(1).strip()
    return _NOTE_LINE.sub("", line).strip()


def _looks_like_order_mark(inner: str) -> bool:
    inner = inner.strip()
    if _PIECE_WORDS.search(inner):
        return True
    prices = [int(x) for x in _PRICE_NUM.findall(inner)]
    return any(_is_product_price(p) for p in prices)


def _merge_order_meta(
    bundle_count: int,
    stock_units: int,
    sale_product_rsd: int,
    bc: int,
    su: int,
    spr: int,
) -> tuple[int, int, int]:
    bundle_count = max(bundle_count, bc or 1)
    if su > 0:
        stock_units = max(stock_units, su)
    if spr > 0:
        sale_product_rsd = max(sale_product_rsd, spr)
    return bundle_count, stock_units, sale_product_rsd


def _is_product_price(value: int) -> bool:
    if value < 2000:
        return False
    for snap in (5000, 4000, 3000, 2500, 2000):
        if abs(value - snap) <= 120:
            return True
        if abs(value - _DEFAULT_DELIVERY_RSD - snap) <= 120:
            return True
    return False


def _price_to_product(price: int) -> tuple[int, int, int]:
    """Return (bundle_count, stock_units, sale_product_rsd) from a price token."""
    if not _is_product_price(price):
        return 1, 0, 0
    if price >= 2500:
        product = _product_from_total(price)
    else:
        product = price
    bundle = _bundle_from_product(product)
    return bundle, bundle * 2, product


def _parse_order_mark(text: str) -> tuple[str, str, int, int, int]:
    bundle_count = 1
    stock_units = 0
    sale_product_rsd = 0
    note_bits: list[str] = []
    cleaned = text

    for match in list(_PARENS_IN_TEXT.finditer(text)):
        inner = match.group(1).strip()
        if _looks_like_order_mark(inner):
            piece_m = _PIECE_WORDS.search(inner)
            prices = [int(x) for x in _PRICE_NUM.findall(inner)]
            pieces = int(piece_m.group(1)) if piece_m else 0
            if prices:
                price = max(prices)
                bc, su, spr = _price_to_product(price)
                bundle_count, stock_units, sale_product_rsd = _merge_order_meta(
                    bundle_count, stock_units, sale_product_rsd, bc, su, spr,
                )
                if pieces:
                    stock_units = max(stock_units, pieces)
            elif pieces:
                stock_units = max(stock_units, pieces)
                bundle_count = max(bundle_count, max(1, pieces // 2) if pieces > 2 else 1)
            cleaned = cleaned.replace(match.group(0), " ").strip()
        else:
            note_bits.append(inner)
            cleaned = cleaned.replace(match.group(0), " ").strip()

    piece_inline = _PIECE_WORDS.search(cleaned)
    if piece_inline:
        pieces = int(piece_inline.group(1))
        stock_units = max(stock_units, pieces)
        bundle_count = max(bundle_count, max(1, pieces // 2) if pieces > 2 else 1)
        cleaned = (cleaned[: piece_inline.start()] + cleaned[piece_inline.end() :]).strip()

    tail_m = _INLINE_PRICE_TAIL.search(cleaned)
    if tail_m:
        price = int(tail_m.group(1))
        if _is_product_price(price) or tail_m.group(0).lower().strip().endswith(("din", "rsd")):
            bc, su, spr = _price_to_product(price)
            bundle_count, stock_units, sale_product_rsd = _merge_order_meta(
                bundle_count, stock_units, sale_product_rsd, bc, su, spr,
            )
            cleaned = cleaned[: tail_m.start()].strip(" ,.-")

    cleaned = re.sub(r"\s+", " ", cleaned).strip(" ,.")
    return cleaned, "; ".join(note_bits), bundle_count, stock_units, sale_product_rsd


def _is_napomena_line(line: str) -> bool:
    line = line.strip()
    if not line:
        return False
    if _NOTE_LINE.match(line):
        return True
    lower = fold_text(line)
    return lower.startswith("napomena") or lower.startswith("beleska") or lower.startswith("note:")


def _prepare_block_lines(lines: list[str]) -> tuple[list[str], str, int, int, int]:
    """Extract notes and order meta from any line; return cleaned address lines."""
    notes: list[str] = []
    clean_lines: list[str] = []
    bundle_count = 1
    stock_units = 0
    sale_product_rsd = 0

    for raw in lines:
        line = raw.strip()
        if not line:
            continue

        if _is_napomena_line(line):
            notes.append(_extract_note_content(line))
            continue

        standalone_price = _STANDALONE_PRICE.match(line)
        if standalone_price:
            bc, su, spr = _price_to_product(int(standalone_price.group(1)))
            bundle_count, stock_units, sale_product_rsd = _merge_order_meta(
                bundle_count, stock_units, sale_product_rsd, bc, su, spr,
            )
            continue

        standalone_pieces = _STANDALONE_PIECES.match(line)
        if standalone_pieces:
            pieces = int(standalone_pieces.group(1))
            stock_units = max(stock_units, pieces)
            bundle_count = max(bundle_count, max(1, pieces // 2) if pieces > 2 else 1)
            continue

        if _PARENS_ONLY.match(line):
            inner = _extract_note_content(line)
            if _looks_like_order_mark(inner):
                piece_m = _PIECE_WORDS.search(inner)
                prices = [int(x) for x in _PRICE_NUM.findall(inner)]
                if prices:
                    bc, su, spr = _price_to_product(max(prices))
                    bundle_count, stock_units, sale_product_rsd = _merge_order_meta(
                        bundle_count, stock_units, sale_product_rsd, bc, su, spr,
                    )
                elif piece_m:
                    pieces = int(piece_m.group(1))
                    stock_units = max(stock_units, pieces)
                    bundle_count = max(bundle_count, max(1, pieces // 2))
                continue
            notes.append(inner)
            continue

        line = _UL_PREFIX.sub("ul. ", line)
        cleaned, pnotes, bc, su, spr = _parse_order_mark(line)
        if pnotes:
            notes.append(pnotes)
        bundle_count, stock_units, sale_product_rsd = _merge_order_meta(
            bundle_count, stock_units, sale_product_rsd, bc, su, spr,
        )
        if cleaned:
            clean_lines.append(cleaned)

    return clean_lines, "; ".join(n for n in notes if n), bundle_count, stock_units, sale_product_rsd


def _separate_notes_from_block(lines: list[str]) -> tuple[list[str], str, int, int, int]:
    return _prepare_block_lines(lines)


def _merge_meta_tail_blocks(blocks: list[list[str]]) -> list[list[str]]:
    """Attach standalone price/piece/note lines to the previous lead block."""
    merged: list[list[str]] = []
    for lines in blocks:
        if merged and len(lines) == 1:
            line = lines[0].strip()
            attach = False
            if _STANDALONE_PRICE.match(line) or _STANDALONE_PIECES.match(line):
                attach = True
            elif _PARENS_ONLY.match(line):
                inner = _extract_note_content(line)
                attach = _looks_like_order_mark(inner)
            elif _is_napomena_line(line):
                attach = True
            if attach:
                merged[-1].extend(lines)
                continue
        merged.append(lines)
    return merged


def _merge_note_blocks(blocks: list[list[str]]) -> list[list[str]]:
    merged: list[list[str]] = []
    for lines in blocks:
        if len(lines) == 1 and _is_note_only_line(lines[0]):
            if merged:
                merged[-1].append(lines[0])
            continue
        merged.append(lines)
    return merged


def _apply_lead_meta(lead: ParsedLead, notes: str, bundle_count: int, stock_units: int, sale_product_rsd: int) -> ParsedLead:
    merged_notes = "; ".join(p for p in (lead.notes, notes) if p)
    return ParsedLead(
        first_name=lead.first_name,
        last_name=lead.last_name,
        street=lead.street,
        city=lead.city,
        postal_code=lead.postal_code,
        phone=lead.phone,
        notes=merged_notes,
        bundle_count=max(1, bundle_count or lead.bundle_count or 1),
        stock_units=stock_units or lead.stock_units,
        sale_product_rsd=sale_product_rsd or lead.sale_product_rsd,
    )

_FIELD_LABELS = (
    re.compile(r"^ime\s*[:\.]?\s*", re.I),
    re.compile(r"^prezime\s*[:\.]?\s*", re.I),
    re.compile(r"^(?:ulica|ul\.?|adresa)\s*[:\.]?\s*", re.I),
    re.compile(r"^(?:mesto|grad)\s*[:\.]?\s*", re.I),
    re.compile(r"^broj(?:\s*telefona)?\s*[:\.]?\s*", re.I),
)

# Phone/postal tokens only — never touch letters inside words (Modran, Požarevac, …).
_NUMERIC_TOKEN = re.compile(
    r"(?<![A-Za-zÀ-žĀ-ž])"
    r"(?:"
    r"\+381[\s\-./]*"
    r")?"
    r"[0-9oO]"
    r"[0-9oO\s\-./]*"
    r"(?<![A-Za-zÀ-žĀ-ž])",
)


def _fix_letter_o_as_zero(text: str) -> str:
    """People often type O/o instead of 0 in phones and postals."""

    def swap(match: re.Match[str]) -> str:
        return match.group(0).replace("O", "0").replace("o", "0")

    return _NUMERIC_TOKEN.sub(swap, text)


def _phone_digits(raw: str) -> str:
    raw = raw.replace("O", "0").replace("o", "0")
    return re.sub(r"\D", "", raw)


def _is_postal_code(text: str) -> bool:
    cleaned = re.sub(r"\s", "", _fix_letter_o_as_zero(text.strip()))
    return bool(re.fullmatch(r"\d{5}", cleaned))


def _normalize_phone(raw: str) -> str:
    digits = _phone_digits(raw)
    if digits.startswith("381") and len(digits) >= 11:
        digits = "0" + digits[3:]
    if len(digits) == 9 and digits.startswith("6"):
        digits = "0" + digits
    return digits


def _valid_phone(digits: str) -> bool:
    if len(digits) == 10 and digits.startswith("06"):
        return True
    # Incomplete paste (missing last digit) — still clearly a mobile
    if len(digits) == 9 and digits.startswith("06"):
        return True
    return False


def _phone_from_text(text: str) -> tuple[str, str]:
    """Extract the last valid Serbian mobile; return (phone, text_without_phone)."""
    text = _fix_letter_o_as_zero(text.strip())
    text = re.sub(
        r"^(?:tel\.?|telefon|t\.|broj(?:\s*telefona)?)\s*[:\.]?\s*",
        "",
        text,
        flags=re.I,
    )
    matches = list(_PHONE.finditer(text))
    for m in reversed(matches):
        raw = m.group(0)
        if len(_phone_digits(raw)) == 5:
            continue
        phone = _normalize_phone(raw)
        if _valid_phone(phone):
            rest = (text[: m.start()] + text[m.end() :]).strip(" ,.;")
            return phone, rest
    return "", text


def _phone_from_block(lines: list[str]) -> tuple[str, list[str]]:
    """Find phone in block (prefer last line, then search upward, then merged lines)."""
    lines = [ln.strip() for ln in lines if ln.strip()]
    if not lines:
        return "", []

    for i in range(len(lines) - 1, -1, -1):
        phone, rest = _phone_from_text(lines[i])
        if phone:
            remaining = lines[:i]
            if rest.strip():
                remaining.append(rest.strip())
            return phone, remaining

    if len(lines) >= 2:
        joined = f"{lines[-2]} {lines[-1]}"
        phone, rest = _phone_from_text(joined)
        if phone:
            remaining = lines[:-2]
            if rest.strip():
                remaining.append(rest.strip())
            return phone, remaining

    phone, rest = _phone_from_text(" ".join(lines))
    if phone:
        return phone, [rest.strip()] if rest.strip() else []

    return "", lines


def _mask_phones(text: str) -> str:
    return _PHONE.sub(lambda m: " " * len(m.group(0)), text)


def _split_city_postal(text: str) -> tuple[str, str]:
    text = _fix_letter_o_as_zero(_POSTAL_GLUE.sub(r"\1 \2", text.strip()))
    if _is_postal_code(text):
        return "", re.sub(r"\s", "", text)
    masked = _mask_phones(text)
    m = _POSTAL.search(masked)
    if not m:
        return text.strip(" ,."), ""
    postal = re.sub(r"\s", "", m.group(1))
    city = (text[: m.start()] + text[m.end() :]).strip(" ,.")
    return city, postal


def _split_street_city(text: str) -> tuple[str, str]:
    text = text.strip(" ,.")
    m = re.match(r"^(.+?\d+\S*)\s+([A-Za-zÀ-žĀ-ž][A-Za-zÀ-žĀ-ž\s\-()]+)$", text)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return text, ""


_SURNAME_ENDING = re.compile(
    r"(?:ovi[ćc]|evi[ćc]|i[ćc]|vi[ćc]|ski|cki|čki|nik|ak|uk|ac|ec|ija|ović|anu|ski)$",
    re.I | re.UNICODE,
)
_COMMON_FIRST_NAMES = frozenset({
    "aleksa", "aleksandar", "andrija", "bojan", "boris", "branislav", "darko", "david",
    "dejan", "dragan", "dragana", "dušan", "dusan", "elvis", "emran", "gabrijel", "igor",
    "ivan", "jovan", "jovana", "lazar", "marko", "milan", "milica", "milivoje", "milos",
    "miroslav", "mustafa", "nemanja", "nikola", "petar", "ranko", "sasa", "slavko", "slave",
    "srećko", "srecko", "stanoje", "stefan", "stojan", "tamás", "tomas", "tomislav",
    "verica", "zarko", "zoran", "žikica", "zikica", "zivadin", "zlatko",
})


def _title_word(word: str) -> str:
    if not word:
        return ""
    if word.isupper() and len(word) > 2:
        return word.title()
    if word.islower():
        return word.title()
    return word


def _looks_like_surname(word: str) -> bool:
    if not word:
        return False
    if _SURNAME_ENDING.search(fold_text(word)):
        return True
    letters = re.sub(r"[^A-Za-zÀ-ž]", "", word)
    return bool(letters and letters.isupper() and len(letters) >= 4)


def _looks_like_first_name(word: str) -> bool:
    return fold_text(word) in _COMMON_FIRST_NAMES


def _order_name_pair(first: str, second: str) -> tuple[str, str]:
    """Return (first_name, last_name) whether paste is Name Surname or Surname Name."""
    if _looks_like_first_name(first) and _looks_like_surname(second):
        return _title_word(first), _title_word(second)
    if _looks_like_first_name(second) and _looks_like_surname(first):
        return _title_word(second), _title_word(first)
    if _looks_like_first_name(second) and not _looks_like_first_name(first):
        return _title_word(second), _title_word(first)
    if _looks_like_surname(first) and not _looks_like_surname(second):
        return _title_word(second), _title_word(first)
    if second.islower() and first[:1].isupper() and _looks_like_surname(first):
        return _title_word(second), _title_word(first)
    return _title_word(first), _title_word(second)


def _normalize_input_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[\u00a0\u2007\u202f]", " ", text)
    text = _fix_letter_o_as_zero(text)
    # Separate glued postal (5 digits) from phone
    text = re.sub(r"(\d{5})(\+381[\s\-./]*)?(0?6\d{8,9})(?!\d)", r"\1 \2\3", text)
    text = re.sub(r"(\d{5})(0?6\d{8,9})(?!\d)", r"\1 \2", text)
    text = _POSTAL_GLUE.sub(r"\1 \2", text)
    return text


def _line_ends_with_phone(line: str) -> bool:
    line = line.strip()
    phone, rest = _phone_from_text(line)
    if not (phone and _valid_phone(phone)):
        return False
    if len(rest.strip(" ,.;")) <= 25:
        return True
    phone_digits = re.sub(r"\D", "", phone)
    line_digits = re.sub(r"\D", "", line)
    return line_digits.endswith(phone_digits)


def _split_chunk_by_phone_lines(chunk: str) -> list[str]:
    lines = [ln.strip() for ln in chunk.splitlines() if ln.strip()]
    if not lines:
        return []
    blocks: list[str] = []
    current: list[str] = []
    for line in lines:
        current.append(line)
        if _line_ends_with_phone(line):
            blocks.append("\n".join(current))
            current = []
    if current:
        blocks.append("\n".join(current))
    return blocks if blocks else [chunk]


def _split_lead_blocks(text: str) -> list[list[str]]:
    text = _normalize_input_text(text.strip())
    chunks = [c.strip() for c in re.split(r"\n\s*\n+", text) if c.strip()]

    raw_blocks: list[str] = []
    for chunk in chunks:
        raw_blocks.extend(_split_chunk_by_phone_lines(chunk))

    if len(raw_blocks) <= 1 and text.count("\n") >= 3:
        raw_blocks = _split_chunk_by_phone_lines(text)

    return [[ln.strip() for ln in block.splitlines() if ln.strip()] for block in raw_blocks if block.strip()]


def _split_name(full_name: str) -> tuple[str, str]:
    full_name = re.sub(r"\s+", " ", full_name.strip(" ,."))
    if not full_name:
        return "", ""
    parts = full_name.split()
    if len(parts) == 1:
        return _title_word(parts[0]), ""
    if len(parts) == 2:
        return _order_name_pair(parts[0], parts[1])
    first, last = parts[0], " ".join(parts[1:])
    if _looks_like_surname(first) and _looks_like_first_name(last.split()[0]):
        swapped_first, swapped_last = _order_name_pair(first, last.split()[0])
        rest = " ".join(last.split()[1:])
        if rest:
            swapped_last = f"{swapped_last} {rest}"
        return swapped_first, swapped_last
    return _title_word(first), _title_word(last)


def _looks_like_street(text: str) -> bool:
    if not text:
        return False
    if _STREET_MARKERS.search(text):
        return True
    return bool(re.search(r"\b\d{1,4}[a-zA-Z]?\b", text))


def _has_labels(lines: list[str]) -> bool:
    return any(_LABEL.match(ln) for ln in lines)


def clean_field_value(value: str) -> str:
    if not value:
        return ""
    text = value.strip()
    for pat in _FIELD_LABELS:
        text = pat.sub("", text).strip()
    return text


def normalize_parsed_lead(lead: ParsedLead) -> ParsedLead:
    street = clean_field_value(lead.street)
    city = clean_field_value(lead.city)
    postal = (lead.postal_code or "").strip()
    street, city, postal = resolve_address(street, city, postal)
    bc = max(1, int(lead.bundle_count or 1))
    su = max(0, int(lead.stock_units or 0))
    if su <= 0 and bc > 1:
        su = bc * 2
    return ParsedLead(
        first_name=clean_field_value(lead.first_name),
        last_name=clean_field_value(lead.last_name),
        street=street,
        city=city,
        postal_code=postal,
        phone=lead.phone,
        notes=(lead.notes or "").strip(),
        bundle_count=bc,
        stock_units=su,
        sale_product_rsd=max(0, int(lead.sale_product_rsd or 0)),
    )


def _parse_inline_labeled_line(line: str) -> dict[str, str]:
    """Parse one line like: Ime Name adresa:Street grad City postanski broj 12345"""
    fields: dict[str, str] = {}
    text = line.strip()
    if not re.match(r"^ime\s", text, re.I):
        return fields

    text = re.sub(r"^ime\s+", "", text, flags=re.I).strip()
    parts = re.split(r"\badresa\s*:\s*", text, maxsplit=1, flags=re.I)
    if len(parts) != 2:
        return fields

    fn, ln = _split_name(parts[0].strip(" ,."))
    if fn:
        fields["first_name"] = fn
    if ln:
        fields["last_name"] = ln

    rest = parts[1].strip()
    grad_split = re.split(r"\bgrad\s+", rest, maxsplit=1, flags=re.I)
    if len(grad_split) == 2:
        fields["street"] = grad_split[0].strip(" ,.")
        city_postal = grad_split[1].strip()
        post_split = re.split(
            r"\bpostanski\s*(?:broj|br\.?)\s*|\bpoštanski\s*(?:broj|br\.?)\s*",
            city_postal,
            maxsplit=1,
            flags=re.I,
        )
        if len(post_split) == 2:
            fields["city"] = post_split[0].strip(" ,.")
            postal_raw = post_split[1].strip(" ,.")
            _, postal = _split_city_postal(postal_raw)
            fields["postal_code"] = postal or postal_raw
        else:
            city, postal = _split_city_postal(city_postal)
            fields["city"] = city
            if postal:
                fields["postal_code"] = postal
    else:
        fields["street"] = rest.strip(" ,.")

    return fields


def _parse_labeled_lines(lines: list[str]) -> ParsedLead | None:
    fields: dict[str, str] = {}

    for line in lines:
        line = line.strip()
        if not line:
            continue
        lower = line.lower()

        if re.match(r"^ime\s", lower) and re.search(r"adresa\s*:", lower):
            for key, val in _parse_inline_labeled_line(line).items():
                if val:
                    fields[key] = val
            continue

        if re.match(r"^ime\s*[:\.]", lower):
            fields["first_name"] = re.sub(r"^ime\s*[:\.]?\s*", "", line, flags=re.I).strip()
            continue
        if re.match(r"^prezime\s*[:\.]", lower):
            fields["last_name"] = re.sub(r"^prezime\s*[:\.]?\s*", "", line, flags=re.I).strip()
            continue
        if re.match(r"^(?:ulica|adresa)\s*[:\.]", lower):
            fields["street"] = re.sub(r"^(?:ulica|adresa)\s*[:\.]?\s*", "", line, flags=re.I).strip()
            continue
        if re.match(r"^ul\.?\s+\S", lower):
            fields["street"] = re.sub(r"^ul\.?\s*", "", line, flags=re.I).strip()
            continue
        if re.match(r"^(?:mesto|grad)\s*[:\.]", lower):
            fields["city"] = re.sub(r"^(?:mesto|grad)\s*[:\.]?\s*", "", line, flags=re.I).strip()
            continue
        if re.search(r"postanski|poštanski", lower):
            val = re.sub(r"^postanski\s*(?:broj|br\.?)\s*", "", line, flags=re.I).strip()
            _, postal = _split_city_postal(val)
            if postal:
                fields["postal_code"] = postal
            continue
        if re.search(r"broj\s*telefona|telefon|^tel\.?|^broj\s", lower):
            phone, _ = _phone_from_text(line)
            if phone:
                fields["phone"] = phone
            continue
        if re.search(r"adresa\s*:", lower):
            parts = re.split(r"adresa\s*:\s*", line, flags=re.I, maxsplit=1)
            if len(parts) == 2:
                name_part = re.sub(r"^ime\s*", "", parts[0], flags=re.I).strip()
                if name_part:
                    fn, ln = _split_name(name_part)
                    fields.setdefault("first_name", fn)
                    fields.setdefault("last_name", ln)
                rest = parts[1].strip(" .")
                city, postal = _split_city_postal(rest)
                if city and not _looks_like_street(city):
                    fields["city"] = city
                    fields["postal_code"] = postal
                else:
                    fields["street"] = rest

    if not fields.get("phone"):
        phone, _ = _phone_from_text("\n".join(lines))
        if phone:
            fields["phone"] = phone

    if fields.get("phone") and (fields.get("first_name") or fields.get("last_name")):
        fn = fields.get("first_name", "")
        ln = fields.get("last_name", "")
        if fn and not ln and " " in fn:
            fn, ln = _split_name(fn)
        return ParsedLead(
            first_name=fn,
            last_name=ln,
            street=fields.get("street", ""),
            city=fields.get("city", ""),
            postal_code=fields.get("postal_code", ""),
            phone=fields["phone"],
        )
    return None


def _parse_address_lines(lines: list[str]) -> tuple[str, str, str]:
    lines = [_POSTAL_GLUE.sub(r"\1 \2", ln.strip()) for ln in lines if ln.strip()]
    if not lines:
        return "", "", ""

    if len(lines) == 1:
        line = lines[0]
        city, postal = _split_city_postal(line)
        if postal and city:
            if _looks_like_street(city):
                street, city_part = _split_street_city(city)
                return street or city, city_part, postal
            return city, "", postal
        if postal and not city:
            looked_up = city_for_postal(postal)
            if _looks_like_street(line):
                street, city_part = _split_street_city(line)
                return street or line, city_part or looked_up, postal
            return line, looked_up, postal
        if _looks_like_street(line):
            street, city = _split_street_city(line)
            return street, city, ""
        return line, "", ""

    if len(lines) == 2:
        a, b = lines[0], lines[1]
        b_city, b_postal = _split_city_postal(b)
        if b_postal and not b_city:
            street, city = _split_street_city(a)
            if not city:
                found, rest = find_city_in(a)
                if found:
                    street, city = (rest or a), found
            return street or a, city, b_postal
        if b_postal:
            return a, b_city, b_postal
        found_a, _ = find_city_in(a)
        if found_a and not _looks_like_street(a):
            return b, found_a, postal_for_city(found_a)
        found_b, _ = find_city_in(b)
        if found_b and not _looks_like_street(b):
            return a, found_b, postal_for_city(found_b)
        found, rest = find_city_in(b)
        if found:
            return a, found, postal_for_city(found) if not b_postal else b_postal
        found, rest = find_city_in(a)
        if found:
            return rest or b, found, postal_for_city(found)
        return a, b, ""

    street = lines[0]
    mid = " ".join(lines[1:-1])
    if mid:
        street = f"{street}, {mid}"
    last_city, last_postal = _split_city_postal(lines[-1])
    if last_postal and not last_city:
        prev_street, city = _split_street_city(lines[-2])
        if prev_street != lines[-2]:
            street = f"{lines[0]}, {prev_street}" if mid else prev_street
            return street, city, last_postal
        return street, city or lines[-2], last_postal
    return street, last_city, last_postal


def _parse_single_line_blob(line: str) -> ParsedLead | None:
    line = _NOISE.sub("", line.strip())
    line = re.sub(r"\.{2,}", " ", line)
    phone, rest = _phone_from_text(line)
    if not _valid_phone(phone):
        return None

    rest = re.sub(r"\s+", " ", rest).strip(" ,.")
    if not rest:
        return None

    if "," in rest:
        parts = [p.strip(" .") for p in rest.split(",") if p.strip(" .")]
        fn, ln = _split_name(parts[0])
        if len(parts) >= 3:
            street = parts[1]
            city, postal = _split_city_postal(", ".join(parts[2:]))
            return ParsedLead(fn, ln, street, city, postal, phone)
        if len(parts) == 2:
            city, postal = _split_city_postal(parts[1])
            if _looks_like_street(parts[1]):
                return ParsedLead(fn, ln, parts[1], "", "", phone)
            return ParsedLead(fn, ln, "", city, postal, phone)

    tokens = rest.split()
    fn, ln = _split_name(" ".join(tokens[:2]))
    addr = " ".join(tokens[2:])
    city, postal = _split_city_postal(addr)
    if postal:
        addr_clean, _ = _split_city_postal(addr)
        if _looks_like_street(addr_clean):
            street, city_part = _split_street_city(addr_clean)
            return ParsedLead(fn, ln, street, city_part or city, postal, phone)
        return ParsedLead(fn, ln, addr_clean, city, postal, phone)
    if _looks_like_street(addr):
        street, city = _split_street_city(addr)
        return ParsedLead(fn, ln, street, city, "", phone)
    return ParsedLead(fn, ln, addr, "", "", phone)


def _parse_lead_block_lines(lines: list[str]) -> tuple[ParsedLead | None, str | None]:
    lines, notes, bundle_count, stock_units, sale_product_rsd = _separate_notes_from_block(lines)
    lines = [_normalize_input_text(ln.strip()) for ln in lines if ln.strip()]
    if not lines:
        return None, "Empty block"

    if _has_labels(lines):
        lead = _parse_labeled_lines(lines)
        if lead:
            return _apply_lead_meta(lead, notes, bundle_count, stock_units, sale_product_rsd), None

    if len(lines) == 1:
        lead = _parse_single_line_blob(lines[0])
        if lead:
            return _apply_lead_meta(lead, notes, bundle_count, stock_units, sale_product_rsd), None
        return None, "Could not detect name, address, and phone"

    phone, lines = _phone_from_block(lines)
    if not phone:
        return None, "Could not find phone number on last line"

    if not lines:
        return None, "Missing name and address"

    first = _NOISE.sub("", lines[0].strip())
    fn, ln = _split_name(first)
    if not fn:
        return None, "Could not detect name"

    addr_lines = lines[1:]
    if not addr_lines and "," in first:
        parts = first.split(",", 1)
        fn, ln = _split_name(parts[0])
        addr_lines = [parts[1].strip()]

    street, city, postal = _parse_address_lines(addr_lines)
    lead = ParsedLead(fn, ln, street, city, postal, phone)
    return _apply_lead_meta(lead, notes, bundle_count, stock_units, sale_product_rsd), None


def parse_lead_block(lines: list[str]) -> tuple[ParsedLead | None, str | None]:
    lead, error = _parse_lead_block_lines(lines)
    if lead:
        return lead, None

    if len(lines) > 1:
        sep_lines, notes, bc, su, spr = _separate_notes_from_block(lines)
        blob = _normalize_input_text(" ".join(ln.strip() for ln in sep_lines if ln.strip()))
        lead = _parse_single_line_blob(blob)
        if lead:
            return _apply_lead_meta(lead, notes, bc, su, spr), None

    return None, error or "Unrecognized format"


def parse_leads_text(text: str) -> list[ParsedLead]:
    return parse_leads_text_detailed(text).leads


def parse_leads_text_detailed(text: str) -> ParseResult:
    text = _normalize_input_text(text.strip())
    block_lines = _merge_note_blocks(_merge_meta_tail_blocks(_split_lead_blocks(text)))
    result = ParseResult()

    for index, lines in enumerate(block_lines, start=1):
        if not lines:
            continue
        lead, error = parse_lead_block(lines)
        if lead:
            result.leads.append(normalize_parsed_lead(lead))
        else:
            preview = " · ".join(lines[:3])
            if len(lines) > 3:
                preview += "…"
            result.skipped.append({
                "block": index,
                "preview": preview,
                "reason": error or "Unrecognized format",
            })

    return result


def name_fingerprint(first_name: str, last_name: str) -> str:
    parts = sorted(p.lower() for p in (first_name, last_name) if p)
    return " ".join(parts)


def lead_fingerprint(lead: ParsedLead) -> str:
    phone = re.sub(r"\D", "", lead.phone)
    return f"{phone}|{name_fingerprint(lead.first_name, lead.last_name)}"
