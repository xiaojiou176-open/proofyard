"""Harden automation_tasks constraints and idempotency uniqueness.

Revision ID: 20260225_0003_automation_tasks_constraints
Revises: 20260225_0002_merge_heads
Create Date: 2026-02-25 00:20:00.000000
"""

from __future__ import annotations

from alembic import context, op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260225_0003_automation_tasks_constraints"
down_revision = "20260225_0002_merge_heads"
branch_labels = None
depends_on = None

_ALLOWED_STATUS = ("queued", "running", "success", "failed", "cancelled")


def _table_exists() -> bool:
    if context.is_offline_mode():
        return True
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return "automation_tasks" in inspector.get_table_names()


def _column_names() -> set[str]:
    if context.is_offline_mode():
        return {
            "task_id",
            "command_id",
            "status",
            "requested_by",
            "attempt",
            "max_attempts",
            "created_at",
            "started_at",
            "finished_at",
            "exit_code",
            "message",
            "output_tail",
            "idempotency_key",
            "replay_of_task_id",
        }
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return {col["name"] for col in inspector.get_columns("automation_tasks")}


def _check_constraint_names() -> set[str]:
    if context.is_offline_mode():
        return set()
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return {
        item["name"]
        for item in inspector.get_check_constraints("automation_tasks")
        if item.get("name")
    }


def _index_names() -> set[str]:
    if context.is_offline_mode():
        return set()
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return {item["name"] for item in inspector.get_indexes("automation_tasks") if item.get("name")}


def upgrade() -> None:
    if not _table_exists():
        return

    columns = _column_names()

    with op.batch_alter_table("automation_tasks") as batch_op:
        if "idempotency_key" not in columns:
            batch_op.add_column(sa.Column("idempotency_key", sa.Text(), nullable=True))
        if "replay_of_task_id" not in columns:
            batch_op.add_column(sa.Column("replay_of_task_id", sa.Text(), nullable=True))

    # Historical compatibility backfill before setting stronger constraints.
    op.execute(
        sa.text(
            """
            UPDATE automation_tasks
            SET status = 'failed'
            WHERE status IS NULL OR status NOT IN ('queued', 'running', 'success', 'failed', 'cancelled')
            """
        )
    )
    op.execute(
        sa.text("UPDATE automation_tasks SET attempt = 1 WHERE attempt IS NULL OR attempt < 1")
    )
    op.execute(
        sa.text(
            "UPDATE automation_tasks SET max_attempts = 1 WHERE max_attempts IS NULL OR max_attempts < 1"
        )
    )
    op.execute(
        sa.text("UPDATE automation_tasks SET max_attempts = attempt WHERE max_attempts < attempt")
    )

    checks = _check_constraint_names()
    with op.batch_alter_table("automation_tasks") as batch_op:
        if "ck_automation_tasks_status_valid" not in checks:
            batch_op.create_check_constraint(
                "ck_automation_tasks_status_valid",
                f"status IN {str(_ALLOWED_STATUS)}",
            )
        if "ck_automation_tasks_attempt_min" not in checks:
            batch_op.create_check_constraint("ck_automation_tasks_attempt_min", "attempt >= 1")
        if "ck_automation_tasks_max_attempts_min" not in checks:
            batch_op.create_check_constraint(
                "ck_automation_tasks_max_attempts_min", "max_attempts >= 1"
            )
        if "ck_automation_tasks_attempt_not_exceed_max" not in checks:
            batch_op.create_check_constraint(
                "ck_automation_tasks_attempt_not_exceed_max", "attempt <= max_attempts"
            )

    indexes = _index_names()
    if "uq_automation_tasks_idempotency_key_active" not in indexes:
        op.create_index(
            "uq_automation_tasks_idempotency_key_active",
            "automation_tasks",
            ["idempotency_key"],
            unique=True,
            sqlite_where=sa.text("idempotency_key IS NOT NULL AND status IN ('queued', 'running')"),
            postgresql_where=sa.text(
                "idempotency_key IS NOT NULL AND status IN ('queued', 'running')"
            ),
        )


def downgrade() -> None:
    if not _table_exists():
        return

    indexes = _index_names()
    if "uq_automation_tasks_idempotency_key_active" in indexes:
        op.drop_index("uq_automation_tasks_idempotency_key_active", table_name="automation_tasks")

    checks = _check_constraint_names()
    with op.batch_alter_table("automation_tasks") as batch_op:
        if "ck_automation_tasks_attempt_not_exceed_max" in checks:
            batch_op.drop_constraint("ck_automation_tasks_attempt_not_exceed_max", type_="check")
        if "ck_automation_tasks_max_attempts_min" in checks:
            batch_op.drop_constraint("ck_automation_tasks_max_attempts_min", type_="check")
        if "ck_automation_tasks_attempt_min" in checks:
            batch_op.drop_constraint("ck_automation_tasks_attempt_min", type_="check")
        if "ck_automation_tasks_status_valid" in checks:
            batch_op.drop_constraint("ck_automation_tasks_status_valid", type_="check")

    # Keep columns for downgrade safety to avoid data loss.
