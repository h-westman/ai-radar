from fastapi import APIRouter, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.clock import utcnow
from app.deps import EditedBy, SessionDep
from app.errors import ConflictError, ensure_version
from app.models import Team
from app.schemas import TeamCreate, TeamOut, TeamUpdate
from app.services.revisions import record_revision, serialize
from app.services.slugs import slugify

router = APIRouter(prefix="/teams", tags=["teams"])


def get_team_or_404(session: Session, team_id: int, *, lock: bool = False) -> Team:
    team = session.get(Team, team_id, with_for_update=lock or None)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")
    return team


def ensure_team_name_free(session: Session, name: str, exclude_id: int | None = None) -> None:
    stmt = select(Team).where(func.lower(Team.name) == name.lower())
    if exclude_id is not None:
        stmt = stmt.where(Team.id != exclude_id)
    if existing := session.scalars(stmt).first():
        raise ConflictError("A team with that name already exists", serialize(existing))


def _touch(team: Team) -> None:
    team.version += 1
    team.updated_at = utcnow()


@router.get("", response_model=list[TeamOut])
def list_teams(session: SessionDep, include_archived: bool = False) -> list[Team]:
    stmt = select(Team).order_by(func.lower(Team.name))
    if not include_archived:
        stmt = stmt.where(Team.archived_at.is_(None))
    return list(session.scalars(stmt))


@router.post("", response_model=TeamOut, status_code=201)
def create_team(data: TeamCreate, session: SessionDep, editor: EditedBy) -> Team:
    ensure_team_name_free(session, data.name)
    team = Team(name=data.name, slug=slugify(data.name), description=data.description)
    session.add(team)
    session.flush()
    record_revision(session, team, "create", editor)
    session.commit()
    return team


@router.get("/{team_id}", response_model=TeamOut)
def get_team(team_id: int, session: SessionDep) -> Team:
    return get_team_or_404(session, team_id)


@router.patch("/{team_id}", response_model=TeamOut)
def update_team(team_id: int, data: TeamUpdate, session: SessionDep, editor: EditedBy) -> Team:
    team = get_team_or_404(session, team_id, lock=True)
    ensure_version(team.version, data.version, serialize(team))
    changes = data.model_dump(exclude_unset=True, exclude={"version"})
    if "name" in changes:
        ensure_team_name_free(session, changes["name"], exclude_id=team.id)
        team.slug = slugify(changes["name"])
    for field, value in changes.items():
        setattr(team, field, value)
    _touch(team)
    session.flush()
    record_revision(session, team, "update", editor)
    session.commit()
    return team


def _set_archived(session: Session, team_id: int, archived: bool, editor: str | None) -> Team:
    team = get_team_or_404(session, team_id, lock=True)
    if (team.archived_at is not None) != archived:
        team.archived_at = utcnow() if archived else None
        _touch(team)
        session.flush()
        record_revision(session, team, "archive" if archived else "restore", editor)
    session.commit()
    return team


@router.post("/{team_id}/archive", response_model=TeamOut)
def archive_team(team_id: int, session: SessionDep, editor: EditedBy) -> Team:
    return _set_archived(session, team_id, True, editor)


@router.post("/{team_id}/restore", response_model=TeamOut)
def restore_team(team_id: int, session: SessionDep, editor: EditedBy) -> Team:
    return _set_archived(session, team_id, False, editor)
