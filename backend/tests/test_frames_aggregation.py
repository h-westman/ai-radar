from datetime import UTC, datetime

from app.services.frames import (
    PlacementRow,
    Point,
    RadarPosition,
    RadarRow,
    active_radar_ids,
    build_frames,
    org_frame,
    team_frame,
)

JAN = datetime(2026, 1, 31, 23, 59, 59, tzinfo=UTC)
FEB = datetime(2026, 2, 28, 23, 59, 59, tzinfo=UTC)
MAR = datetime(2026, 3, 31, 23, 59, 59, tzinfo=UTC)

_ids = iter(range(1, 10_000))


def place(team, practice, adoption, value, eff, removed=False):
    return PlacementRow(
        id=next(_ids),
        radar_id=team,
        practice_id=practice,
        adoption=adoption,
        value=value,
        removed=removed,
        effective_at=eff,
        recorded_at=eff,
    )


def teams(*ids, archived=None):
    archived = archived or {}
    return [RadarRow(id=i, archived_at=archived.get(i)) for i in ids]


X, Y = 10, 20
ALL = {X, Y}


def test_team_frame_lists_on_radar_practices_only():
    rows = [
        place(1, Y, 30, 40, JAN),
        place(1, X, 70, 80, JAN),
        place(1, X, 70, 80, FEB, removed=True),
        place(2, X, 10, 10, JAN),
    ]
    assert team_frame(1, rows, ALL, JAN) == [
        Point(practice_id=X, adoption=70, value=80, radars=1),
        Point(practice_id=Y, adoption=30, value=40, radars=1),
    ]
    assert team_frame(1, rows, ALL, FEB) == [Point(practice_id=Y, adoption=30, value=40, radars=1)]


def test_team_frame_skips_practices_not_in_practice_ids():
    rows = [place(1, X, 70, 80, JAN), place(1, Y, 30, 40, JAN)]
    assert [p.practice_id for p in team_frame(1, rows, {Y}, JAN)] == [Y]


def test_org_frame_counts_non_users_as_zero_adoption():
    rows = [
        place(1, X, 80, 90, JAN),
        place(2, X, 40, 70, JAN),
        place(3, Y, 20, 20, JAN),
    ]
    assert org_frame(teams(1, 2, 3), rows, ALL, JAN) == [
        Point(
            practice_id=X,
            adoption=40,  # (80 + 40 + 0) / 3
            value=80,  # (90 + 70) / 2
            radars=2,
            radar_positions=(RadarPosition(1, 80, 90), RadarPosition(2, 40, 70)),
        ),
        Point(
            practice_id=Y,
            adoption=7,  # 20 / 3 = 6.67
            value=20,
            radars=1,
            radar_positions=(RadarPosition(3, 20, 20),),
        ),
    ]


def test_teams_count_only_once_they_have_started():
    rows = [place(1, X, 80, 90, JAN), place(2, X, 40, 70, JAN), place(3, Y, 20, 20, MAR)]
    assert active_radar_ids(teams(1, 2, 3), rows, FEB) == {1, 2}
    [x] = org_frame(teams(1, 2, 3), rows, ALL, FEB)
    assert x.adoption == 60  # (80 + 40) / 2


def test_backdated_team_counts_from_its_backdated_date():
    rows = [place(1, X, 80, 90, JAN)]
    assert active_radar_ids(teams(1), rows, JAN) == {1}


def test_archived_teams_drop_out_from_archive_date():
    archived_mid_feb = datetime(2026, 2, 15, tzinfo=UTC)
    rows = [place(1, X, 80, 90, JAN), place(2, X, 40, 70, JAN)]
    roster = teams(1, 2, archived={2: archived_mid_feb})
    assert active_radar_ids(roster, rows, JAN) == {1, 2}
    assert active_radar_ids(roster, rows, FEB) == {1}
    [x] = org_frame(roster, rows, ALL, FEB)
    assert (x.adoption, x.value, x.radars) == (80, 90, 1)


def test_removed_practice_keeps_team_active_as_zero():
    rows = [
        place(1, X, 80, 90, JAN),
        place(2, X, 40, 70, JAN),
        place(2, X, 40, 70, FEB, removed=True),
    ]
    [x] = org_frame(teams(1, 2), rows, ALL, FEB)
    assert (x.adoption, x.value, x.radars) == (40, 90, 1)


def test_rounding_is_half_up():
    rows = [place(1, X, 45, 50, JAN), place(2, Y, 50, 50, JAN)]
    x = next(p for p in org_frame(teams(1, 2), rows, ALL, JAN) if p.practice_id == X)
    assert x.adoption == 23  # 22.5 rounds up


def test_org_frame_is_empty_without_active_teams():
    assert org_frame(teams(1), [], ALL, JAN) == []


def test_build_frames_dispatches_on_scope():
    rows = [place(1, X, 80, 90, JAN), place(2, X, 40, 70, FEB)]
    org = build_frames(
        scope_radar_id=None, radars=teams(1, 2), placements=rows, practice_ids=ALL, dates=[JAN, FEB]
    )
    assert [f.date for f in org] == [JAN, FEB]
    assert org[0].points[0].adoption == 80  # only team 1 active in January
    assert org[1].points[0].adoption == 60
    team = build_frames(
        scope_radar_id=2, radars=teams(1, 2), placements=rows, practice_ids=ALL, dates=[JAN, FEB]
    )
    assert team[0].points == []
    assert team[1].points == [Point(practice_id=X, adoption=40, value=70, radars=1)]


def test_point_counts_radars_not_teams():
    from app.services.frames import Point, RadarPosition

    point = Point(
        practice_id=10,
        adoption=70,
        value=80,
        radars=2,
        radar_positions=(RadarPosition(radar_id=1, adoption=70, value=80),),
    )
    assert point.radars == 2
    assert point.radar_positions[0].radar_id == 1
