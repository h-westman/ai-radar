"""Pure position and aggregation rules (spec §3). No database access here."""

from collections.abc import Iterable
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
