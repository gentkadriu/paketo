"""Delete database and create empty tables. Use before first deploy or to start fresh."""
from pathlib import Path

from app.database import DB_PATH, init_db


def main() -> None:
    if DB_PATH.exists():
        DB_PATH.unlink()
        print(f"Removed {DB_PATH}")
    init_db()
    print(f"Fresh database ready at {DB_PATH}")


if __name__ == "__main__":
    main()
