from fastapi import APIRouter, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.clock import utcnow
from app.deps import EditedBy, SessionDep
from app.errors import ConflictError, ensure_version
from app.models import Radar
from app.schemas import RadarCreate, RadarOut, RadarUpdate
from app.services.revisions import record_revision, serialize

router = APIRouter(prefix="/radars", tags=["radars"])


def get_radar_or_404(session: Session, radar_id: int, *, lock: bool = False) -> Radar:
    radar = session.get(Radar, radar_id, with_for_update=lock or None)
    if radar is None:
        raise HTTPException(status_code=404, detail="Radar not found")
    return radar


def ensure_radar_name_free(session: Session, name: str, exclude_id: int | None = None) -> None:
    stmt = select(Radar).where(func.lower(Radar.name) == func.lower(name))
    if exclude_id is not None:
        stmt = stmt.where(Radar.id != exclude_id)
    if existing := session.scalars(stmt).first():
        raise ConflictError("A radar with that name already exists", serialize(existing))


def _touch(radar: Radar) -> None:
    radar.version += 1
    radar.updated_at = utcnow()


@router.get("", response_model=list[RadarOut])
def list_radars(session: SessionDep, include_archived: bool = False) -> list[Radar]:
    stmt = select(Radar).order_by(func.lower(Radar.name))
    if not include_archived:
        stmt = stmt.where(Radar.archived_at.is_(None))
    return list(session.scalars(stmt))


@router.post("", response_model=RadarOut, status_code=201)
def create_radar(data: RadarCreate, session: SessionDep, editor: EditedBy) -> Radar:
    ensure_radar_name_free(session, data.name)
    radar = Radar(name=data.name, description=data.description)
    session.add(radar)
    session.flush()
    record_revision(session, radar, "create", editor)
    session.commit()
    return radar


@router.get("/{radar_id}", response_model=RadarOut)
def get_radar(radar_id: int, session: SessionDep) -> Radar:
    return get_radar_or_404(session, radar_id)


@router.patch("/{radar_id}", response_model=RadarOut)
def update_radar(radar_id: int, data: RadarUpdate, session: SessionDep, editor: EditedBy) -> Radar:
    radar = get_radar_or_404(session, radar_id, lock=True)
    ensure_version(radar.version, data.version, serialize(radar))
    changes = data.model_dump(exclude_unset=True, exclude={"version"})
    if "name" in changes:
        ensure_radar_name_free(session, changes["name"], exclude_id=radar.id)
    for field, value in changes.items():
        setattr(radar, field, value)
    _touch(radar)
    session.flush()
    record_revision(session, radar, "update", editor)
    session.commit()
    return radar


def _set_archived(session: Session, radar_id: int, archived: bool, editor: str | None) -> Radar:
    radar = get_radar_or_404(session, radar_id, lock=True)
    if (radar.archived_at is not None) != archived:
        radar.archived_at = utcnow() if archived else None
        _touch(radar)
        session.flush()
        record_revision(session, radar, "archive" if archived else "restore", editor)
    session.commit()
    return radar


@router.post("/{radar_id}/archive", response_model=RadarOut)
def archive_radar(radar_id: int, session: SessionDep, editor: EditedBy) -> Radar:
    return _set_archived(session, radar_id, True, editor)


@router.post("/{radar_id}/restore", response_model=RadarOut)
def restore_radar(radar_id: int, session: SessionDep, editor: EditedBy) -> Radar:
    return _set_archived(session, radar_id, False, editor)
