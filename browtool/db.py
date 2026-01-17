from __future__ import annotations

import os
import sqlite3
import time
import uuid
from dataclasses import dataclass
from typing import Iterable, Optional


@dataclass(frozen=True)
class ToolRow:
    id: str
    name: str
    description: str
    script_text: str
    created_at: int
    updated_at: int


def default_db_path() -> str:
    repo_root = os.path.abspath(os.path.join(
        os.path.dirname(__file__), os.pardir))
    return os.path.join(repo_root, "db", "browtool.sqlite")


def connect(db_path: Optional[str] = None) -> sqlite3.Connection:
    path = db_path or default_db_path()
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS tools (
            id TEXT PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            description TEXT NOT NULL,
            script_text TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        """
    )
    conn.commit()


def _tools_columns(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute("PRAGMA table_info(tools);").fetchall()
    return {r["name"] for r in rows}


def list_tools(conn: sqlite3.Connection) -> list[ToolRow]:
    cols = _tools_columns(conn)
    has_language = "language" in cols
    rows = conn.execute(
        """
        SELECT id, name, description, script_text, created_at, updated_at
        FROM tools
        ORDER BY updated_at DESC;
        """
    ).fetchall()
    tools: list[ToolRow] = []
    for r in rows:
        d = dict(r)
        if has_language:
            d.pop("language", None)
        tools.append(ToolRow(**d))
    return tools


def get_tool_by_name(conn: sqlite3.Connection, name: str) -> Optional[ToolRow]:
    cols = _tools_columns(conn)
    has_language = "language" in cols
    row = conn.execute(
        """
        SELECT id, name, description, script_text, created_at, updated_at
        FROM tools
        WHERE name = ?;
        """,
        (name,),
    ).fetchone()
    if not row:
        return None
    d = dict(row)
    if has_language:
        d.pop("language", None)
    return ToolRow(**d)


def insert_tool(
    conn: sqlite3.Connection,
    *,
    name: str,
    description: str,
    script_text: str,
) -> ToolRow:
    now = int(time.time())
    tool_id = str(uuid.uuid4())
    cols = _tools_columns(conn)
    if "language" in cols:
        conn.execute(
            """
            INSERT INTO tools (id, name, description, language, script_text, created_at, updated_at)
            VALUES (?, ?, ?, 'python', ?, ?, ?);
            """,
            (tool_id, name, description, script_text, now, now),
        )
    else:
        conn.execute(
            """
            INSERT INTO tools (id, name, description, script_text, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?);
            """,
            (tool_id, name, description, script_text, now, now),
        )
    conn.commit()
    return ToolRow(
        id=tool_id,
        name=name,
        description=description,
        script_text=script_text,
        created_at=now,
        updated_at=now,
    )
