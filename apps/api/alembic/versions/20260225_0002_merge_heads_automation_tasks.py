"""Merge divergent automation_tasks baseline heads.

Revision ID: 20260225_0002_merge_heads
Revises: 20260220_0001
Create Date: 2026-02-25 00:00:00.000000
"""

from __future__ import annotations

# revision identifiers, used by Alembic.
revision = "20260225_0002_merge_heads"
down_revision = "20260220_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # merge revision only, schema changes are already covered by parent heads
    pass


def downgrade() -> None:
    # merge revision only, no direct schema changes to undo
    pass
