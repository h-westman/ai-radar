"""initial schema

Revision ID: 0001
Revises:
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def _ts(name: str, nullable: bool = False) -> sa.Column:
    return sa.Column(
        name,
        sa.DateTime(timezone=True),
        nullable=nullable,
        server_default=None if nullable else sa.func.now(),
    )


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    op.create_table(
        "teams",
        sa.Column("id", sa.Integer, sa.Identity(), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("slug", sa.String(120), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        _ts("created_at"),
        _ts("updated_at"),
        _ts("archived_at", nullable=True),
    )
    op.execute("CREATE UNIQUE INDEX uq_teams_name_lower ON teams (lower(name))")

    op.create_table(
        "practices",
        sa.Column("id", sa.Integer, sa.Identity(), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("slug", sa.String(120), nullable=False),
        sa.Column("category", sa.String(20), nullable=False),
        sa.Column("summary", sa.String(280), nullable=False, server_default=""),
        sa.Column("body_md", sa.Text, nullable=False, server_default=""),
        sa.Column("tags", postgresql.ARRAY(sa.String(40)), nullable=False, server_default="{}"),
        sa.Column("links", postgresql.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        _ts("created_at"),
        _ts("updated_at"),
        _ts("archived_at", nullable=True),
        sa.CheckConstraint(
            "category IN ('tool', 'skill', 'practice', 'workflow')",
            name="ck_practices_category",
        ),
    )
    op.execute("CREATE UNIQUE INDEX uq_practices_name_lower ON practices (lower(name))")
    op.execute("CREATE INDEX ix_practices_name_trgm ON practices USING gin (name gin_trgm_ops)")

    op.create_table(
        "team_notes",
        sa.Column("team_id", sa.Integer, sa.ForeignKey("teams.id"), primary_key=True),
        sa.Column("practice_id", sa.Integer, sa.ForeignKey("practices.id"), primary_key=True),
        sa.Column("body_md", sa.Text, nullable=False, server_default=""),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        _ts("updated_at"),
        sa.Column("edited_by", sa.String(100), nullable=True),
    )

    op.create_table(
        "placements",
        sa.Column("id", sa.Integer, sa.Identity(), primary_key=True),
        sa.Column("team_id", sa.Integer, sa.ForeignKey("teams.id"), nullable=False),
        sa.Column("practice_id", sa.Integer, sa.ForeignKey("practices.id"), nullable=False),
        sa.Column("adoption", sa.SmallInteger, nullable=False),
        sa.Column("value", sa.SmallInteger, nullable=False),
        sa.Column("removed", sa.Boolean, nullable=False, server_default=sa.false()),
        _ts("effective_at"),
        _ts("recorded_at"),
        sa.Column("edited_by", sa.String(100), nullable=True),
        sa.CheckConstraint("adoption BETWEEN 0 AND 100", name="ck_placements_adoption"),
        sa.CheckConstraint("value BETWEEN 0 AND 100", name="ck_placements_value"),
    )
    op.execute(
        "CREATE INDEX ix_placements_lookup ON placements "
        "(team_id, practice_id, effective_at DESC, recorded_at DESC)"
    )

    op.create_table(
        "revisions",
        sa.Column("id", sa.Integer, sa.Identity(), primary_key=True),
        sa.Column("entity_type", sa.String(20), nullable=False),
        sa.Column("entity_id", sa.String(50), nullable=False),
        sa.Column("action", sa.String(20), nullable=False),
        sa.Column("snapshot", postgresql.JSONB, nullable=False),
        sa.Column("edited_by", sa.String(100), nullable=True),
        _ts("created_at"),
        sa.CheckConstraint(
            "entity_type IN ('team', 'practice', 'team_note')", name="ck_revisions_entity_type"
        ),
        sa.CheckConstraint(
            "action IN ('create', 'update', 'archive', 'restore', 'revert')",
            name="ck_revisions_action",
        ),
    )
    op.execute(
        "CREATE INDEX ix_revisions_entity ON revisions (entity_type, entity_id, created_at DESC)"
    )


def downgrade() -> None:
    for table in ("revisions", "placements", "team_notes", "practices", "teams"):
        op.drop_table(table)
