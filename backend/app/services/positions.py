from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.clock import utcnow
from app.models import Placement, Radar
from app.services.frames import PlacementRow, RadarRow, latest_as_of


def to_row(p: Placement) -> PlacementRow:
    return PlacementRow(
        id=p.id,
        radar_id=p.radar_id,
        practice_id=p.practice_id,
        adoption=p.adoption,
        value=p.value,
        removed=p.removed,
        effective_at=p.effective_at,
        recorded_at=p.recorded_at,
    )


def load_placement_rows(
    session: Session, *, radar_id: int | None = None, practice_id: int | None = None
) -> list[PlacementRow]:
    stmt = select(Placement)
    if radar_id is not None:
        stmt = stmt.where(Placement.radar_id == radar_id)
    if practice_id is not None:
        stmt = stmt.where(Placement.practice_id == practice_id)
    return [to_row(p) for p in session.scalars(stmt)]


def position_as_of(
    session: Session, radar_id: int, practice_id: int, at: datetime
) -> PlacementRow | None:
    rows = load_placement_rows(session, radar_id=radar_id, practice_id=practice_id)
    return latest_as_of(rows, at).get((radar_id, practice_id))


def load_radar_rows(session: Session) -> list[RadarRow]:
    return [RadarRow(id=r.id, archived_at=r.archived_at) for r in session.scalars(select(Radar))]


def current_usage(
    session: Session, *, practice_id: int | None = None
) -> dict[int, list[PlacementRow]]:
    """practice_id -> on-radar placement rows as of now, for non-archived radars."""
    active = set(session.scalars(select(Radar.id).where(Radar.archived_at.is_(None))))
    rows = load_placement_rows(session, practice_id=practice_id)
    usage: dict[int, list[PlacementRow]] = {}
    for row in latest_as_of(rows, utcnow()).values():
        if not row.removed and row.radar_id in active:
            usage.setdefault(row.practice_id, []).append(row)
    return usage
