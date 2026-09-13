"""Pure position and aggregation rules (spec §3). No database access here."""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

Step = Literal["week", "month"]


@dataclass(frozen=True)
class PlacementRow:
    id: int
    team_id: int
    practice_id: int
    adoption: int
    value: int
    removed: bool
    effective_at: datetime
    recorded_at: datetime


@dataclass(frozen=True)
class TeamRow:
    id: int
    archived_at: datetime | None


@dataclass(frozen=True)
class TeamPosition:
    team_id: int
    adoption: int
    value: int


@dataclass(frozen=True)
class Point:
    practice_id: int
    adoption: int
    value: int
    teams: int
    team_positions: tuple[TeamPosition, ...] | None = None


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
        key = (p.team_id, p.practice_id)
        current = latest.get(key)
        if current is None or _order(p) > _order(current):
            latest[key] = p
    return latest


def _round(x: float) -> int:
    return int(x + 0.5)


def active_team_ids(
    teams: Iterable[TeamRow], placements: Sequence[PlacementRow], at: datetime
) -> set[int]:
    started = {p.team_id for p in placements if p.effective_at <= at}
    return {
        t.id for t in teams if t.id in started and (t.archived_at is None or t.archived_at > at)
    }


def team_frame(
    team_id: int, placements: Sequence[PlacementRow], practice_ids: set[int], at: datetime
) -> list[Point]:
    latest = latest_as_of((p for p in placements if p.team_id == team_id), at)
    points = [
        Point(practice_id=p.practice_id, adoption=p.adoption, value=p.value, teams=1)
        for p in latest.values()
        if not p.removed and p.practice_id in practice_ids
    ]
    return sorted(points, key=lambda point: point.practice_id)


def org_frame(
    teams: Sequence[TeamRow],
    placements: Sequence[PlacementRow],
    practice_ids: set[int],
    at: datetime,
) -> list[Point]:
    active = active_team_ids(teams, placements, at)
    if not active:
        return []
    latest = latest_as_of((p for p in placements if p.team_id in active), at)
    by_practice: dict[int, list[PlacementRow]] = {}
    for p in latest.values():
        if not p.removed and p.practice_id in practice_ids:
            by_practice.setdefault(p.practice_id, []).append(p)

    points: list[Point] = []
    for practice_id in sorted(by_practice):
        rows = sorted(by_practice[practice_id], key=lambda r: r.team_id)
        points.append(
            Point(
                practice_id=practice_id,
                adoption=_round(sum(r.adoption for r in rows) / len(active)),
                value=_round(sum(r.value for r in rows) / len(rows)),
                teams=len(rows),
                team_positions=tuple(TeamPosition(r.team_id, r.adoption, r.value) for r in rows),
            )
        )
    return points


def build_frames(
    *,
    scope_team_id: int | None,
    teams: Sequence[TeamRow],
    placements: Sequence[PlacementRow],
    practice_ids: set[int],
    dates: list[datetime],
) -> list[Frame]:
    if scope_team_id is None:
        return [Frame(d, org_frame(teams, placements, practice_ids, d)) for d in dates]
    return [Frame(d, team_frame(scope_team_id, placements, practice_ids, d)) for d in dates]
