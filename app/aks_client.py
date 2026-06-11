"""
AKS Express Kurir tracking via their GetTrackData API.

Flow (no CAPTCHA needed):
  1. GET  /Tracking/index          → session cookies
  2. POST /Tracking/GetTrackData   → JSON body: "91766000346509"
  3. Response: { "Res": 1000, "lstData": [...] }

Res codes:
  1000 = found
  101  = not found / invalid ID
"""

from __future__ import annotations

import json
import logging
import threading
import time
from typing import Any

import httpx

logger = logging.getLogger("posta.aks")

BASE_URL = "https://akskurir.com"
DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

_lock = threading.Lock()
_client: httpx.Client | None = None
_session_ready = False
_request_delay = 0.35


class AksTrackingError(Exception):
    pass


class AksNotFoundError(AksTrackingError):
    pass


def _get_client() -> httpx.Client:
    global _client, _session_ready
    if _client is None:
        _client = httpx.Client(
            base_url=BASE_URL,
            follow_redirects=True,
            timeout=30.0,
            headers=DEFAULT_HEADERS,
        )
        _session_ready = False
    return _client


def _ensure_session() -> None:
    global _session_ready
    client = _get_client()
    if _session_ready:
        return
    response = client.get("/Tracking/index")
    response.raise_for_status()
    _session_ready = True
    logger.debug("AKS session initialized")


def reset_session() -> None:
    global _client, _session_ready
    with _lock:
        if _client is not None:
            _client.close()
        _client = None
        _session_ready = False
    logger.info("AKS HTTP session reset")


def _parse_history(lst_data: list[dict]) -> list[dict[str, str]]:
    history: list[dict[str, str]] = []
    for item in lst_data:
        status = str(item.get("Status") or "").strip()
        if not status:
            continue
        history.append(
            {
                "status": status,
                "location": str(item.get("Lokacija") or "").strip(),
                "time": str(item.get("VremeStr") or item.get("Vreme") or "").strip(),
            }
        )
    return history


def track_order(order_id: str) -> dict[str, Any]:
    """Fetch tracking for one order ID. Fully automatic — no CAPTCHA."""
    with _lock:
        _ensure_session()
        client = _get_client()

        response = client.post(
            "/Tracking/GetTrackData",
            headers={
                "Content-Type": "application/json; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "Referer": f"{BASE_URL}/Tracking/index",
                "Origin": BASE_URL,
            },
            content=json.dumps(order_id),
        )
        response.raise_for_status()
        time.sleep(_request_delay)

    try:
        payload = response.json()
    except json.JSONDecodeError as exc:
        raise AksTrackingError("Invalid response from AKS.") from exc

    res_code = payload.get("Res")
    lst_data = payload.get("lstData") or []

    if res_code != 1000 or not lst_data:
        raise AksNotFoundError(f"No tracking data for Order ID {order_id}.")

    history = _parse_history(lst_data)
    if not history:
        raise AksNotFoundError(f"No tracking data for Order ID {order_id}.")

    latest = history[-1]
    return {
        "status": latest["status"],
        "location": latest["location"],
        "time": latest["time"],
        "history": history,
    }
