import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from app.datetime_util import now_local, utc_naive_to_local_str

_default_db = Path(__file__).resolve().parent.parent / "data" / "posta.db"
DB_PATH = Path(os.environ.get("POSTA_DB_PATH", _default_db))


def _column_exists(conn: sqlite3.Connection, table: str, column: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(row[1] == column for row in rows)


def _migrate(conn: sqlite3.Connection) -> None:
    if not _column_exists(conn, "batches", "user_id"):
        conn.execute("ALTER TABLE batches ADD COLUMN user_id INTEGER")
    if not _column_exists(conn, "batches", "sent_at"):
        conn.execute("ALTER TABLE batches ADD COLUMN sent_at TEXT")
    if not _column_exists(conn, "leads", "lifecycle_status"):
        conn.execute(
            "ALTER TABLE leads ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'registered'"
        )
    if not _column_exists(conn, "leads", "imported_at"):
        conn.execute("ALTER TABLE leads ADD COLUMN imported_at TEXT")
        ts = now_local()
        conn.execute("UPDATE leads SET imported_at = ? WHERE imported_at IS NULL", (ts,))
    if not _column_exists(conn, "leads", "notes"):
        conn.execute("ALTER TABLE leads ADD COLUMN notes TEXT NOT NULL DEFAULT ''")
    if not _column_exists(conn, "leads", "bundle_count"):
        conn.execute("ALTER TABLE leads ADD COLUMN bundle_count INTEGER NOT NULL DEFAULT 1")
    if not _column_exists(conn, "leads", "stock_units"):
        conn.execute("ALTER TABLE leads ADD COLUMN stock_units INTEGER NOT NULL DEFAULT 0")
    if not _column_exists(conn, "leads", "sale_product_rsd"):
        conn.execute("ALTER TABLE leads ADD COLUMN sale_product_rsd INTEGER NOT NULL DEFAULT 0")
    if not _column_exists(conn, "users", "username"):
        conn.execute("ALTER TABLE users ADD COLUMN username TEXT")
        if _column_exists(conn, "users", "email"):
            conn.execute(
                "UPDATE users SET username = lower(replace(email, '@', '_')) WHERE username IS NULL"
            )
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)"
        )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """
    )

    if conn.execute(
        "SELECT value FROM app_settings WHERE key = 'belgrade_tz'"
    ).fetchone() is None:
        for row in conn.execute(
            "SELECT id, created_at, sent_at FROM batches"
        ).fetchall():
            created = utc_naive_to_local_str(row["created_at"]) if row["created_at"] else row["created_at"]
            sent = utc_naive_to_local_str(row["sent_at"]) if row["sent_at"] else row["sent_at"]
            conn.execute(
                "UPDATE batches SET created_at = ?, sent_at = ? WHERE id = ?",
                (created, sent, row["id"]),
            )
        for row in conn.execute(
            "SELECT id, tracking_updated_at FROM leads WHERE tracking_updated_at IS NOT NULL"
        ).fetchall():
            conn.execute(
                "UPDATE leads SET tracking_updated_at = ? WHERE id = ?",
                (utc_naive_to_local_str(row["tracking_updated_at"]), row["id"]),
            )
        for row in conn.execute(
            "SELECT id, created_at FROM users WHERE created_at IS NOT NULL"
        ).fetchall():
            conn.execute(
                "UPDATE users SET created_at = ? WHERE id = ?",
                (utc_naive_to_local_str(row["created_at"]), row["id"]),
            )
        conn.execute(
            "INSERT INTO app_settings (key, value) VALUES ('belgrade_tz', '1')"
        )

    # Order ID implies sent to AKS — fix legacy rows
    conn.execute(
        """
        UPDATE leads SET lifecycle_status = 'sent'
        WHERE order_id IS NOT NULL AND order_id != ''
          AND lifecycle_status = 'registered'
        """
    )
    batch_ids = conn.execute(
        """
        SELECT id FROM batches
        WHERE sent_at IS NULL
          AND id IN (
            SELECT DISTINCT batch_id FROM leads
            WHERE order_id IS NOT NULL AND order_id != ''
          )
        """
    ).fetchall()
    ts = now_local()
    for row in batch_ids:
        conn.execute(
            "UPDATE batches SET sent_at = ?, status = 'sent' WHERE id = ?",
            (ts, row["id"]),
        )

    # Batches marked sent without any Order IDs — reset to linking
    conn.execute(
        """
        UPDATE batches SET sent_at = NULL, status = 'linking'
        WHERE id NOT IN (
            SELECT DISTINCT batch_id FROM leads
            WHERE order_id IS NOT NULL AND order_id != ''
        ) AND sent_at IS NOT NULL
        """
    )
    conn.execute(
        """
        UPDATE leads SET lifecycle_status = 'registered'
        WHERE (order_id IS NULL OR order_id = '') AND lifecycle_status = 'sent'
        """
    )

    from app.finance_db import migrate_finance
    migrate_finance(conn)

    from app.platform_db import migrate_platform
    migrate_platform(conn)


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_connection() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                name TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS batches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                sent_at TEXT,
                status TEXT NOT NULL DEFAULT 'linking',
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS leads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                batch_id INTEGER NOT NULL,
                sort_order INTEGER NOT NULL,
                first_name TEXT NOT NULL,
                last_name TEXT NOT NULL,
                street TEXT NOT NULL,
                city TEXT NOT NULL,
                postal_code TEXT NOT NULL,
                phone TEXT NOT NULL,
                order_id TEXT,
                lifecycle_status TEXT NOT NULL DEFAULT 'registered',
                tracking_status TEXT,
                tracking_location TEXT,
                tracking_updated_at TEXT,
                tracking_history TEXT,
                imported_at TEXT,
                FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
            );
            """
        )
        _migrate(conn)


@contextmanager
def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
