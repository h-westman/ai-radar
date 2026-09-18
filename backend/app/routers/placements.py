from fastapi import APIRouter, HTTPException

from app.clock import utcnow
from app.deps import EditedBy, SessionDep
from app.models import Placement
from app.routers.practices import get_practice_or_404
from app.routers.radars import get_radar_or_404
from app.schemas import PlacementCreate, PlacementOut
from app.services.positions import position_as_of

router = APIRouter(prefix="/placements", tags=["placements"])


@router.post("", response_model=PlacementOut, status_code=201)
def create_placement(data: PlacementCreate, session: SessionDep, editor: EditedBy) -> Placement:
    radar = get_radar_or_404(session, data.radar_id)
    practice = get_practice_or_404(session, data.practice_id)
    if radar.archived_at is not None or practice.archived_at is not None:
        raise HTTPException(status_code=422, detail="Radar or practice is archived")

    now = utcnow()
    effective_at = data.effective_at or now
    if effective_at > now:
        raise HTTPException(status_code=422, detail="effective_at cannot be in the future")

    adoption, value = data.adoption, data.value
    if data.removed:
        current = position_as_of(session, radar.id, practice.id, effective_at)
        if current is None or current.removed:
            raise HTTPException(status_code=422, detail="Practice is not on the radar at that date")
        adoption, value = current.adoption, current.value

    placement = Placement(
        radar_id=radar.id,
        practice_id=practice.id,
        adoption=adoption,
        value=value,
        removed=data.removed,
        effective_at=effective_at,
        recorded_at=now,
        edited_by=editor,
    )
    session.add(placement)
    session.commit()
    return placement
