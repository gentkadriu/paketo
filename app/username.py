import re

USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9_]{3,30}$")


def normalize_username(username: str) -> str:
    return username.strip().lower()


def validate_username(username: str) -> str | None:
    u = normalize_username(username)
    if not USERNAME_PATTERN.match(u):
        return "Username must be 3–30 characters (letters, numbers, underscore)."
    return None
