"""Pure position and aggregation rules (spec §3). No database access here."""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

Step = Literal["week", "month"]


@dataclass(frozen=True)
class PlacementRow:
    id: int
    radar_id: int
    practice_id: int
    adoption: int
    value: int
    removed: bool
    effective_at: datetime
    recorded_at: datetime


@dataclass(frozen=True)
class RadarRow:
    id: int
    archived_at: datetime | None


@dataclass(frozen=True)
class RadarPosition:
    radar_id: int
    adoption: int
    value: int


@dataclass(frozen=True)
class Point:
    practice_id: int
    adoption: int
    value: int
    radars: int
    radar_positions: tuple[RadarPosition, ...] | None = None


@dataclass(frozen=True)
class Frame:
    date: datetime
    points: list[Point]


def period_end(moment: datetime, step: Step) -> datetime:
    day = moment.astimezone(UTC).date()
    if step == "week":
        end_day = day + timedelta(days=6 - day.weekday())
    else:
        first_of_next = (day.replace(day=28) + timedelta(days=4)).replace(day=1)
        end_day = first_of_next - timedelta(days=1)
    return datetime(end_day.year, end_day.month, end_day.day, 23, 59, 59, tzinfo=UTC)


def period_ends(start: datetime, end: datetime, step: Step, now: datetime) -> list[datetime]:
    dates: list[datetime] = []
    current = period_end(start, step)
    last = period_end(end, step)
    while current <= last:
        dates.append(current)
        current = period_end(current + timedelta(seconds=1), step)
    if dates and end.astimezone(UTC).date() == now.astimezone(UTC).date():
        dates[-1] = now
    return dates


def _order(p: PlacementRow) -> tuple[datetime, datetime, int]:
    return (p.effective_at, p.recorded_at, p.id)


def latest_as_of(
    placements: Iterable[PlacementRow], at: datetime
) -> dict[tuple[int, int], PlacementRow]:
    latest: dict[tuple[int, int], PlacementRow] = {}
    for p in placements:
        if p.effective_at > at:
            continue
        key = (p.radar_id, p.practice_id)
        current = latest.get(key)
        if current is None or _order(p) > _order(current):
            latest[key] = p
    return latest


def _round(x: float) -> int:
    return int(x + 0.5)


def active_radar_ids(
    radars: Iterable[RadarRow], placements: Sequence[PlacementRow], at: datetime
) -> set[int]:
    started = {p.radar_id for p in placements if p.effective_at <= at}
    return {
        r.id for r in radars if r.id in started and (r.archived_at is None or r.archived_at > at)
    }


def radar_frame(
    radar_id: int, placements: Sequence[PlacementRow], practice_ids: set[int], at: datetime
) -> list[Point]:
    latest = latest_as_of((p for p in placements if p.radar_id == radar_id), at)
    points = [
        Point(practice_id=p.practice_id, adoption=p.adoption, value=p.value, radars=1)
        for p in latest.values()
        if not p.removed and p.practice_id in practice_ids
    ]
    return sorted(points, key=lambda point: point.practice_id)


def org_frame(
    radars: Sequence[RadarRow],
    placements: Sequence[PlacementRow],
    practice_ids: set[int],
    at: datetime,
) -> list[Point]:
    active = active_radar_ids(radars, placements, at)
    if not active:
        return []
    latest = latest_as_of((p for p in placements if p.radar_id in active), at)
    by_practice: dict[int, list[PlacementRow]] = {}
    for p in latest.values():
        if not p.removed and p.practice_id in practice_ids:
            by_practice.setdefault(p.practice_id, []).append(p)

    points: list[Point] = []
    for practice_id in sorted(by_practice):
        rows = sorted(by_practice[practice_id], key=lambda r: r.radar_id)
        points.append(
            Point(
                practice_id=practice_id,
                adoption=_round(sum(r.adoption for r in rows) / len(active)),
                value=_round(sum(r.value for r in rows) / len(rows)),
                radars=len(rows),
                radar_positions=tuple(RadarPosition(r.radar_id, r.adoption, r.value) for r in rows),
            )
        )
    return points


def build_frames(
    *,
    scope_radar_id: int | None,
    radars: Sequence[RadarRow],
    placements: Sequence[PlacementRow],
    practice_ids: set[int],
    dates: list[datetime],
) -> list[Frame]:
    if scope_radar_id is None:
        return [Frame(d, org_frame(radars, placements, practice_ids, d)) for d in dates]
    return [Frame(d, radar_frame(scope_radar_id, placements, practice_ids, d)) for d in dates]
