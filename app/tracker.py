"""AKS tracking entry point — uses direct HTTP API (no browser, no CAPTCHA)."""

from app.aks_client import reset_session, track_order

__all__ = ["track_order", "reset_session"]
