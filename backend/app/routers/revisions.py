from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.clock import utcnow
from app.deps import EditedBy, SessionDep
from app.models import Practice, Revision, Team, TeamNote
from app.routers.practices import ensure_practice_name_free, get_practice_or_404
from app.routers.teams import ensure_team_name_free, get_team_or_404
from app.schemas import EntityType, RevertOut, RevisionOut
from app.services.revisions import EDITABLE_FIELDS, record_revision, serialize
from app.services.slugs import slugify

router = APIRouter(prefix="/revisions", tags=["revisions"])


@router.get("", response_model=list[RevisionOut])
def list_revisions(session: SessionDep, entity_type: EntityType, entity_id: str) -> list[Revision]:
    stmt = (
        select(Revision)
        .where(Revision.entity_type == entity_type, Revision.entity_id == entity_id)
        .order_by(Revision.created_at.desc(), Revision.id.desc())
    )
    return list(session.scalars(stmt))


def _load_entity(session: Session, revision: Revision) -> Team | Practice | TeamNote:
    if revision.entity_type == "team":
        return get_team_or_404(session, int(revision.entity_id), lock=True)
    if revision.entity_type == "practice":
        return get_practice_or_404(session, int(revision.entity_id), lock=True)
    team_id, practice_id = (int(part) for part in revision.entity_id.split(":"))
    note = session.get(TeamNote, (team_id, practice_id), with_for_update=True)
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return note


@router.post("/{revision_id}/revert", response_model=RevertOut)
def revert(revision_id: int, session: SessionDep, editor: EditedBy) -> RevertOut:
    revision = session.get(Revision, revision_id)
    if revision is None:
        raise HTTPException(status_code=404, detail="Revision not found")
    entity = _load_entity(session, revision)
    snapshot = revision.snapshot

    if isinstance(entity, Team):
        ensure_team_name_free(session, snapshot["name"], exclude_id=entity.id)
    elif isinstance(entity, Practice):
        ensure_practice_name_free(session, snapshot["name"], exclude_id=entity.id)
    if isinstance(entity, (Team, Practice)):
        entity.slug = slugify(snapshot["name"])
    if isinstance(entity, TeamNote):
        entity.edited_by = editor

    for field in EDITABLE_FIELDS[revision.entity_type]:
        setattr(entity, field, snapshot[field])
    entity.version += 1
    entity.updated_at = utcnow()
    session.flush()
    record_revision(session, entity, "revert", editor)
    session.commit()
    return RevertOut(entity_type=revision.entity_type, entity=serialize(entity))
