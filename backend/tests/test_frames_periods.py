from datetime import UTC, datetime, timedelta, timezone

from app.services.frames import PlacementRow, latest_as_of, period_end, period_ends


def dt(y, m, d, h=12, mi=0, s=0):
    return datetime(y, m, d, h, mi, s, tzinfo=UTC)


def end_of(y, m, d):
    return datetime(y, m, d, 23, 59, 59, tzinfo=UTC)


def row(id, *, eff, rec=None, radar=1, practice=1, adoption=50, value=50, removed=False):
    return PlacementRow(
        id=id,
        radar_id=radar,
        practice_id=practice,
        adoption=adoption,
        value=value,
        removed=removed,
        effective_at=eff,
        recorded_at=rec or eff,
    )


# --- period_end -------------------------------------------------------------


def test_week_ends_on_sunday():
    assert period_end(dt(2026, 9, 9), "week") == end_of(2026, 9, 13)  # Wed -> Sun


def test_sunday_is_its_own_week_end():
    assert period_end(end_of(2026, 9, 13), "week") == end_of(2026, 9, 13)


def test_month_end_handles_short_and_leap_months():
    assert period_end(dt(2026, 2, 10), "month") == end_of(2026, 2, 28)
    assert period_end(dt(2028, 2, 10), "month") == end_of(2028, 2, 29)
    assert period_end(dt(2026, 12, 5), "month") == end_of(2026, 12, 31)


def test_period_end_converts_to_utc_first():
    cest = timezone(timedelta(hours=2))
    # 1 April 01:00 in UTC+2 is still 31 March in UTC.
    assert period_end(datetime(2026, 4, 1, 1, 0, tzinfo=cest), "month") == end_of(2026, 3, 31)


# --- period_ends ------------------------------------------------------------


def test_monthly_period_ends_in_the_past():
    now = dt(2026, 9, 13)
    assert period_ends(dt(2026, 1, 15), dt(2026, 3, 20), "month", now) == [
        end_of(2026, 1, 31),
        end_of(2026, 2, 28),
        end_of(2026, 3, 31),
    ]


def test_last_frame_is_now_when_range_ends_today():
    now = dt(2026, 9, 13, 10)
    assert period_ends(dt(2026, 7, 2), now, "month", now) == [
        end_of(2026, 7, 31),
        end_of(2026, 8, 31),
        now,
    ]


def test_weekly_period_ends():
    now = dt(2026, 9, 20)
    assert period_ends(dt(2026, 8, 31), dt(2026, 9, 13), "week", now) == [
        end_of(2026, 9, 6),
        end_of(2026, 9, 13),
    ]


def test_empty_when_start_after_end():
    assert period_ends(dt(2026, 5, 1), dt(2026, 3, 1), "month", dt(2026, 9, 13)) == []


# --- latest_as_of -----------------------------------------------------------


def test_latest_effective_placement_wins():
    rows = [row(1, eff=dt(2026, 1, 10)), row(2, eff=dt(2026, 3, 10))]
    assert latest_as_of(rows, dt(2026, 4, 1))[(1, 1)].id == 2
    assert latest_as_of(rows, dt(2026, 2, 1))[(1, 1)].id == 1
    assert (1, 1) not in latest_as_of(rows, dt(2025, 12, 1))


def test_backdated_placement_does_not_override_later_effective_one():
    on_time = row(1, eff=dt(2026, 3, 10), rec=dt(2026, 3, 10))
    backdated = row(2, eff=dt(2026, 2, 10), rec=dt(2026, 4, 1))
    assert latest_as_of([on_time, backdated], dt(2026, 4, 2))[(1, 1)].id == 1
    assert latest_as_of([on_time, backdated], dt(2026, 2, 28))[(1, 1)].id == 2


def test_same_effective_time_later_recorded_wins():
    same = dt(2026, 3, 10)
    rows = [row(1, eff=same, rec=dt(2026, 3, 11)), row(2, eff=same, rec=dt(2026, 3, 10))]
    assert latest_as_of(rows, dt(2026, 4, 1))[(1, 1)].id == 1


def test_full_tie_highest_id_wins():
    same = dt(2026, 3, 10)
    rows = [row(7, eff=same), row(3, eff=same)]
    assert latest_as_of(rows, dt(2026, 4, 1))[(1, 1)].id == 7


def test_keys_are_per_radar_and_practice_and_removed_rows_are_kept():
    rows = [
        row(1, eff=dt(2026, 1, 1), radar=1, practice=1),
        row(2, eff=dt(2026, 1, 1), radar=2, practice=1, removed=True),
        row(3, eff=dt(2026, 1, 1), radar=1, practice=2),
    ]
    result = latest_as_of(rows, dt(2026, 2, 1))
    assert set(result) == {(1, 1), (2, 1), (1, 2)}
    assert result[(2, 1)].removed is True
