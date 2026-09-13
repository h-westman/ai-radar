from datetime import datetime

from sqlalchemy.orm import Session

from app.clock import utcnow
from app.models import Placement, Practice, Team
from app.services.slugs import slugify


def make_team(session: Session, name: str = "Platform", **fields) -> Team:
    team = Team(name=name, slug=slugify(name), **fields)
    session.add(team)
    session.flush()
    return team


def make_practice(
    session: Session, name: str = "Claude Code", category: str = "tool", **fields
) -> Practice:
    practice = Practice(name=name, slug=slugify(name), category=category, **fields)
    session.add(practice)
    session.flush()
    return practice


def make_placement(
    session: Session,
    team: Team,
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
        team_id=team.id,
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
