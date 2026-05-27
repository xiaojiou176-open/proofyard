from __future__ import annotations

import json
import sqlite3
from hashlib import sha256
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config


def _rows(conn: sqlite3.Connection) -> list[tuple[str, str, str, int, int, str | None, str | None]]:
    return conn.execute(
        """
        SELECT task_id, command_id, status, attempt, max_attempts, idempotency_key, replay_of_task_id
        FROM automation_tasks
        ORDER BY task_id
        """
    ).fetchall()


def _fingerprint(rows: list[tuple[str, str, str, int, int, str | None, str | None]]) -> str:
    return sha256(json.dumps(rows, ensure_ascii=False).encode()).hexdigest()


def _index_names(conn: sqlite3.Connection) -> set[str]:
    indexes = conn.execute("PRAGMA index_list('automation_tasks')").fetchall()
    return {item[1] for item in indexes}


def test_migration_chain_roundtrip_replay_data_consistency(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    resolved = Path(__file__).resolve()
    repo_root = next(
        (parent for parent in resolved.parents if (parent / "apps" / "api" / "alembic.ini").exists()),
        resolved.parents[2],
    )
    db_path = tmp_path / "r5-migration-chain.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+pysqlite:///{db_path}")
    cfg = Config(str(repo_root / "apps" / "api" / "alembic.ini"))
    cfg.set_main_option("script_location", str(repo_root / "apps" / "api" / "alembic"))

    command.upgrade(cfg, "head")

    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            """
            INSERT INTO automation_tasks (
                task_id, command_id, status, requested_by, attempt, max_attempts, created_at,
                started_at, finished_at, exit_code, message, output_tail, idempotency_key, replay_of_task_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "task-r5-1",
                "cmd-a",
                "running",
                "r5",
                1,
                3,
                "2026-02-25T00:00:00Z",
                None,
                None,
                None,
                "msg-a",
                "tail-a",
                "idem-r5-a",
                None,
            ),
        )
        conn.execute(
            """
            INSERT INTO automation_tasks (
                task_id, command_id, status, requested_by, attempt, max_attempts, created_at,
                started_at, finished_at, exit_code, message, output_tail, idempotency_key, replay_of_task_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "task-r5-2",
                "cmd-b",
                "success",
                "r5",
                2,
                2,
                "2026-02-25T00:10:00Z",
                "2026-02-25T00:11:00Z",
                "2026-02-25T00:12:00Z",
                0,
                "msg-b",
                "tail-b",
                "idem-r5-a",
                "task-r5-1",
            ),
        )
        conn.commit()
        expected_rows = _rows(conn)
    finally:
        conn.close()

    command.downgrade(cfg, "base")

    conn = sqlite3.connect(db_path)
    try:
        rows_after_downgrade = _rows(conn)
        assert rows_after_downgrade == expected_rows
        assert "uq_automation_tasks_idempotency_key_active" not in _index_names(conn)
    finally:
        conn.close()

    command.upgrade(cfg, "head")

    conn = sqlite3.connect(db_path)
    try:
        rows_after_reupgrade = _rows(conn)
        assert rows_after_reupgrade == expected_rows
        assert _fingerprint(rows_after_reupgrade) == _fingerprint(expected_rows)
        assert "uq_automation_tasks_idempotency_key_active" in _index_names(conn)
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                """
                INSERT INTO automation_tasks (
                    task_id, command_id, status, requested_by, attempt, max_attempts, created_at,
                    started_at, finished_at, exit_code, message, output_tail, idempotency_key, replay_of_task_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "task-r5-3",
                    "cmd-c",
                    "queued",
                    "r5",
                    1,
                    1,
                    "2026-02-25T01:00:00Z",
                    None,
                    None,
                    None,
                    "msg-c",
                    "tail-c",
                    "idem-r5-a",
                    None,
                ),
            )
        conn.rollback()
    finally:
        conn.close()
