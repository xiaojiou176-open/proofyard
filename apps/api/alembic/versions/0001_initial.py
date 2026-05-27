"""create automation_tasks table baseline

Revision ID: 0001_initial
Revises: None
Create Date: 2026-02-21 00:00:00.000000
"""

from __future__ import annotations

from alembic import context, op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    if not context.is_offline_mode():
        bind = op.get_bind()
        inspector = sa.inspect(bind)
        if "automation_tasks" in inspector.get_table_names():
            return

    op.create_table(
        "automation_tasks",
        sa.Column("task_id", sa.Text(), nullable=False),
        sa.Column("command_id", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("requested_by", sa.Text(), nullable=True),
        sa.Column("attempt", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("started_at", sa.Text(), nullable=True),
        sa.Column("finished_at", sa.Text(), nullable=True),
        sa.Column("exit_code", sa.Integer(), nullable=True),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("output_tail", sa.Text(), nullable=False, server_default=""),
        sa.Column("idempotency_key", sa.Text(), nullable=True),
        sa.Column("replay_of_task_id", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'success', 'failed', 'cancelled')",
            name="ck_automation_tasks_status_valid",
        ),
        sa.CheckConstraint("attempt >= 1", name="ck_automation_tasks_attempt_min"),
        sa.CheckConstraint("max_attempts >= 1", name="ck_automation_tasks_max_attempts_min"),
        sa.CheckConstraint(
            "attempt <= max_attempts", name="ck_automation_tasks_attempt_not_exceed_max"
        ),
        sa.PrimaryKeyConstraint("task_id", name="pk_automation_tasks"),
    )
    op.create_index(
        "uq_automation_tasks_idempotency_key_active",
        "automation_tasks",
        ["idempotency_key"],
        unique=True,
        sqlite_where=sa.text("idempotency_key IS NOT NULL AND status IN ('queued', 'running')"),
        postgresql_where=sa.text("idempotency_key IS NOT NULL AND status IN ('queued', 'running')"),
    )


def downgrade() -> None:
    # Safety downgrade strategy:
    # keep data intact and avoid destructive full-table drop.
    pass
