from fastapi import APIRouter, HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.clock import utcnow
from app.deps import EditedBy, SessionDep
from app.errors import ConflictError, ensure_version
from app.models import Practice
from app.schemas import (
    Category,
    PracticeCreate,
    PracticeListItem,
    PracticeOut,
    PracticeUpdate,
)
from app.services.revisions import record_revision, serialize
from app.services.slugs import slugify

router = APIRouter(prefix="/practices", tags=["practices"])


def get_practice_or_404(session: Session, practice_id: int, *, lock: bool = False) -> Practice:
    practice = session.get(Practice, practice_id, with_for_update=lock or None)
    if practice is None:
        raise HTTPException(status_code=404, detail="Practice not found")
    return practice


def ensure_practice_name_free(session: Session, name: str, exclude_id: int | None = None) -> None:
    stmt = select(Practice).where(func.lower(Practice.name) == name.lower())
    if exclude_id is not None:
        stmt = stmt.where(Practice.id != exclude_id)
    if existing := session.scalars(stmt).first():
        raise ConflictError("A practice with that name already exists", serialize(existing))


def _touch(practice: Practice) -> None:
    practice.version += 1
    practice.updated_at = utcnow()


@router.get("", response_model=list[PracticeListItem])
def list_practices(
    session: SessionDep,
    q: str | None = None,
    category: Category | None = None,
    tag: str | None = None,
    include_archived: bool = False,
) -> list[Practice]:
    stmt = select(Practice).order_by(func.lower(Practice.name))
    if not include_archived:
        stmt = stmt.where(Practice.archived_at.is_(None))
    if q:
        pattern = f"%{q.strip()}%"
        stmt = stmt.where(or_(Practice.name.ilike(pattern), Practice.summary.ilike(pattern)))
    if category:
        stmt = stmt.where(Practice.category == category)
    if tag:
        stmt = stmt.where(Practice.tags.any(tag))
    return list(session.scalars(stmt))


@router.post("", response_model=PracticeOut, status_code=201)
def create_practice(data: PracticeCreate, session: SessionDep, editor: EditedBy) -> Practice:
    ensure_practice_name_free(session, data.name)
    practice = Practice(**data.model_dump(mode="json"), slug=slugify(data.name))
    session.add(practice)
    session.flush()
    record_revision(session, practice, "create", editor)
    session.commit()
    return practice


@router.get("/{practice_id}", response_model=PracticeOut)
def get_practice(practice_id: int, session: SessionDep) -> Practice:
    return get_practice_or_404(session, practice_id)


@router.patch("/{practice_id}", response_model=PracticeOut)
def update_practice(
    practice_id: int, data: PracticeUpdate, session: SessionDep, editor: EditedBy
) -> Practice:
    practice = get_practice_or_404(session, practice_id, lock=True)
    ensure_version(practice.version, data.version, serialize(practice))
    changes = data.model_dump(mode="json", exclude_unset=True, exclude={"version"})
    if "name" in changes:
        ensure_practice_name_free(session, changes["name"], exclude_id=practice.id)
        practice.slug = slugify(changes["name"])
    for field, value in changes.items():
        setattr(practice, field, value)
    _touch(practice)
    session.flush()
    record_revision(session, practice, "update", editor)
    session.commit()
    return practice


def _set_archived(
    session: Session, practice_id: int, archived: bool, editor: str | None
) -> Practice:
    practice = get_practice_or_404(session, practice_id, lock=True)
    if (practice.archived_at is not None) != archived:
        practice.archived_at = utcnow() if archived else None
        _touch(practice)
        session.flush()
        record_revision(session, practice, "archive" if archived else "restore", editor)
    session.commit()
    return practice


@router.post("/{practice_id}/archive", response_model=PracticeOut)
def archive_practice(practice_id: int, session: SessionDep, editor: EditedBy) -> Practice:
    return _set_archived(session, practice_id, True, editor)


@router.post("/{practice_id}/restore", response_model=PracticeOut)
def restore_practice(practice_id: int, session: SessionDep, editor: EditedBy) -> Practice:
    return _set_archived(session, practice_id, False, editor)
