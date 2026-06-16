"""Serbian postal codes and city names for address parsing."""

from __future__ import annotations

import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

_DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "serbia_postal.json"


def fold_text(value: str) -> str:
    if not value:
        return ""
    text = unicodedata.normalize("NFKD", value)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return text.lower().strip()


def normalize_postal(value: str) -> str:
    if not value:
        return ""
    return re.sub(r"\s", "", str(value).strip())


@lru_cache(maxsize=1)
def _load() -> tuple[dict[str, str], dict[str, str], list[tuple[str, str]]]:
    with open(_DATA_PATH, encoding="utf-8") as fh:
        raw = json.load(fh)

    postal_to_city: dict[str, str] = {}
    city_to_postal: dict[str, str] = {}

    for postal, city in raw.get("postal_to_city", {}).items():
        p = normalize_postal(postal)
        if p and city:
            postal_to_city[p] = city.strip()
            key = fold_text(city)
            city_to_postal.setdefault(key, p)

    for city in raw.get("extra_cities", []):
        name = city.get("name", "").strip()
        postal = normalize_postal(city.get("postal", ""))
        if name and postal:
            postal_to_city.setdefault(postal, name)
            city_to_postal.setdefault(fold_text(name), postal)
        for alias in city.get("aliases", []):
            if name:
                city_to_postal.setdefault(fold_text(alias), postal or city_to_postal.get(fold_text(name), ""))

    names: list[tuple[str, str]] = []
    seen: set[str] = set()
    for city in postal_to_city.values():
        key = fold_text(city)
        if key not in seen:
            seen.add(key)
            names.append((key, city))
    for city in raw.get("extra_cities", []):
        name = city.get("name", "").strip()
        if name:
            key = fold_text(name)
            if key not in seen:
                seen.add(key)
                names.append((key, name))
        for alias in city.get("aliases", []):
            key = fold_text(alias)
            if key not in seen:
                seen.add(key)
                names.append((key, name.title()))

    names.sort(key=lambda item: len(item[0]), reverse=True)
    return postal_to_city, city_to_postal, names


def city_for_postal(postal: str) -> str:
    postal_to_city, _, _ = _load()
    return postal_to_city.get(normalize_postal(postal), "")


def postal_for_city(city: str) -> str:
    _, city_to_postal, _ = _load()
    return city_to_postal.get(fold_text(city), "")


def find_city_in(text: str) -> tuple[str, str]:
    """Return (canonical_city, remainder) if a known city appears in text."""
    if not text or not text.strip():
        return "", text
    _, _, names = _load()
    folded = fold_text(text)
    original = text.strip()

    for key, canonical in names:
        if len(key) < 3:
            continue
        idx = folded.find(key)
        if idx < 0:
            continue
        end = idx + len(key)
        before_ok = idx == 0 or not folded[idx - 1].isalnum()
        after_ok = end >= len(folded) or not folded[end].isalnum()
        if not (before_ok and after_ok):
            continue
        remainder = (original[:idx] + original[end:]).strip(" ,.-")
        return canonical, remainder

    return "", text


def resolve_address(street: str, city: str, postal: str) -> tuple[str, str, str]:
    """Fill missing city/postal and peel city out of street when possible."""
    street = (street or "").strip()
    city = (city or "").strip()
    postal = normalize_postal(postal or "")
    if postal and len(postal) != 5:
        postal = ""

    if postal and not city:
        city = city_for_postal(postal)

    if city and not postal:
        postal = postal_for_city(city)

    if not city:
        found, rest = find_city_in(street)
        if found:
            city = found
            street = rest.strip(" ,.-")
            if not postal:
                postal = postal_for_city(city)

    canonical = city_for_postal(postal) if postal else ""
    if canonical:
        old_city = city
        city = canonical
        if old_city and fold_text(old_city) != fold_text(canonical):
            folded_old = fold_text(old_city)
            folded_canon = fold_text(canonical)
            if folded_canon not in folded_old:
                extra = old_city.strip()
                if extra and fold_text(extra) not in fold_text(street):
                    street = f"{street}, {extra}".strip(" ,.-") if street else extra
            elif " " in old_city:
                for part in old_city.split():
                    if fold_text(part) not in (folded_canon, fold_text(street)):
                        if fold_text(part) not in fold_text(street):
                            street = f"{street}, {part}".strip(" ,.-") if street else part

    if city and not postal:
        postal = postal_for_city(city)

    if not city and postal:
        city = city_for_postal(postal)

    return street, city, postal
