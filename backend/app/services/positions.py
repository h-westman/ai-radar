from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.clock import utcnow
from app.models import Placement, Team
from app.services.frames import PlacementRow, TeamRow, latest_as_of


def to_row(p: Placement) -> PlacementRow:
    return PlacementRow(
        id=p.id,
        team_id=p.team_id,
        practice_id=p.practice_id,
        adoption=p.adoption,
        value=p.value,
        removed=p.removed,
        effective_at=p.effective_at,
        recorded_at=p.recorded_at,
    )


def load_placement_rows(
    session: Session, *, team_id: int | None = None, practice_id: int | None = None
) -> list[PlacementRow]:
    stmt = select(Placement)
    if team_id is not None:
        stmt = stmt.where(Placement.team_id == team_id)
    if practice_id is not None:
        stmt = stmt.where(Placement.practice_id == practice_id)
    return [to_row(p) for p in session.scalars(stmt)]


def position_as_of(
    session: Session, team_id: int, practice_id: int, at: datetime
) -> PlacementRow | None:
    rows = load_placement_rows(session, team_id=team_id, practice_id=practice_id)
    return latest_as_of(rows, at).get((team_id, practice_id))


def load_team_rows(session: Session) -> list[TeamRow]:
    return [TeamRow(id=t.id, archived_at=t.archived_at) for t in session.scalars(select(Team))]


def current_usage(
    session: Session, *, practice_id: int | None = None
) -> dict[int, list[PlacementRow]]:
    """practice_id -> on-radar placement rows as of now, for non-archived teams."""
    active = set(session.scalars(select(Team.id).where(Team.archived_at.is_(None))))
    rows = load_placement_rows(session, practice_id=practice_id)
    usage: dict[int, list[PlacementRow]] = {}
    for row in latest_as_of(rows, utcnow()).values():
        if not row.removed and row.team_id in active:
            usage.setdefault(row.practice_id, []).append(row)
    return usage
