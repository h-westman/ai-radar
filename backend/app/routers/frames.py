import re
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from pydantic import AwareDatetime
from sqlalchemy import select

from app.clock import utcnow
from app.deps import SessionDep
from app.models import Practice
from app.routers.radars import get_radar_or_404
from app.schemas import FrameOut, FramesOut, PracticeRef
from app.services.frames import Step, build_frames, period_ends
from app.services.positions import load_placement_rows, load_radar_rows

router = APIRouter(tags=["frames"])

_SCOPE = re.compile(r"^(?:org|radar:(\d+))$")


@router.get("/frames", response_model=FramesOut, response_model_exclude_none=True)
def get_frames(
    session: SessionDep,
    scope: str = "org",
    step: Step = "month",
    from_: Annotated[AwareDatetime | None, Query(alias="from")] = None,
    to: AwareDatetime | None = None,
) -> FramesOut:
    match = _SCOPE.match(scope)
    if match is None:
        raise HTTPException(status_code=422, detail="scope must be 'org' or 'radar:<id>'")
    radar_id = int(match.group(1)) if match.group(1) else None
    if radar_id is not None:
        get_radar_or_404(session, radar_id)

    now = utcnow()
    placements = load_placement_rows(session, radar_id=radar_id)
    end = min(to or now, now)
    start = from_ or min((p.effective_at for p in placements), default=end)
    if from_ is None and radar_id is not None:
        start = min(start, end - timedelta(days=365))  # room to backdate (spec §3)
    if start > end:
        raise HTTPException(status_code=422, detail="'from' must not be after 'to'")
    max_span = timedelta(days=366 * 25)
    if end - start > max_span:
        raise HTTPException(
            status_code=422, detail=f"'from' to 'to' must not span more than {max_span.days} days"
        )

    practices = {
        p.id: p for p in session.scalars(select(Practice).where(Practice.archived_at.is_(None)))
    }
    result = build_frames(
        scope_radar_id=radar_id,
        radars=load_radar_rows(session),
        placements=placements,
        practice_ids=set(practices),
        dates=period_ends(start, end, step, now),
    )
    used = sorted({point.practice_id for frame in result for point in frame.points})
    return FramesOut(
        scope=scope,
        step=step,
        frames=[FrameOut.model_validate(frame) for frame in result],
        practices={
            str(pid): PracticeRef(name=practices[pid].name, category=practices[pid].category)
            for pid in used
        },
    )
