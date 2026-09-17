from fastapi import APIRouter, HTTPException, Response

from app.clock import utcnow
from app.deps import EditedBy, SessionDep
from app.errors import ConflictError, ensure_version
from app.models import RadarNote
from app.routers.practices import get_practice_or_404
from app.routers.radars import get_radar_or_404
from app.schemas import NoteOut, NotePut
from app.services.revisions import record_revision, serialize

router = APIRouter(prefix="/radars/{radar_id}/notes", tags=["notes"])


@router.get("/{practice_id}", response_model=NoteOut)
def get_note(radar_id: int, practice_id: int, session: SessionDep) -> RadarNote:
    note = session.get(RadarNote, (radar_id, practice_id))
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return note


@router.put("/{practice_id}", response_model=NoteOut)
def put_note(
    radar_id: int,
    practice_id: int,
    data: NotePut,
    session: SessionDep,
    editor: EditedBy,
    response: Response,
) -> RadarNote:
    get_radar_or_404(session, radar_id)
    get_practice_or_404(session, practice_id)
    note = session.get(RadarNote, (radar_id, practice_id), with_for_update=True)

    if note is None:
        if data.version != 0:
            raise ConflictError("This note was changed by someone else", None)
        note = RadarNote(
            radar_id=radar_id, practice_id=practice_id, body_md=data.body_md, edited_by=editor
        )
        session.add(note)
        action = "create"
        response.status_code = 201
    else:
        ensure_version(note.version, data.version, serialize(note))
        note.body_md = data.body_md
        note.version += 1
        note.updated_at = utcnow()
        note.edited_by = editor
        action = "update"

    session.flush()
    record_revision(session, note, action, editor)
    session.commit()
    return note
