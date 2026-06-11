ORDER_ID_LENGTH = 14
ORDER_ID_PREFIX = "917"


def validate_order_id(order_id: str) -> str | None:
    """Return error message if invalid, else None. Empty string is allowed."""
    if not order_id:
        return None
    if not order_id.isdigit():
        return f"Order ID must contain digits only (exactly {ORDER_ID_LENGTH} characters)."
    if not order_id.startswith(ORDER_ID_PREFIX):
        return f"Order ID must start with {ORDER_ID_PREFIX}."
    if len(order_id) != ORDER_ID_LENGTH:
        return f"Order ID must be exactly {ORDER_ID_LENGTH} characters (e.g. 91766000346509)."
    return None
