from datetime import datetime

from sqlalchemy.orm import Session

from app.clock import utcnow
from app.models import Placement, Practice, Radar


def make_radar(session: Session, name: str = "Platform", **fields) -> Radar:
    radar = Radar(name=name, **fields)
    session.add(radar)
    session.flush()
    return radar


def make_practice(
    session: Session, name: str = "Claude Code", category: str = "tool", **fields
) -> Practice:
    practice = Practice(name=name, category=category, **fields)
    session.add(practice)
    session.flush()
    return practice


def make_placement(
    session: Session,
    radar: Radar,
    practice: Practice,
    *,
    adoption: int = 50,
    value: int = 50,
    removed: bool = False,
    effective_at: datetime | None = None,
    recorded_at: datetime | None = None,
) -> Placement:
    now = utcnow()
    placement = Placement(
        radar_id=radar.id,
        practice_id=practice.id,
        adoption=adoption,
        value=value,
        removed=removed,
        effective_at=effective_at or now,
        recorded_at=recorded_at or now,
    )
    session.add(placement)
    session.flush()
    return placement


from sqlalchemy import select  # noqa: E402

from app.models import Revision  # noqa: E402


def revisions_for(session: Session, entity_type: str, entity_id) -> list[Revision]:
    stmt = (
        select(Revision)
        .where(Revision.entity_type == entity_type, Revision.entity_id == str(entity_id))
        .order_by(Revision.id)
    )
    return list(session.scalars(stmt))
