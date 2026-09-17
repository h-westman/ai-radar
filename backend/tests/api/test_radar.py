from datetime import UTC, datetime

import pytest

from app.clock import utcnow
from tests.factories import make_placement, make_practice, make_radar


def d(y, m, day):
    return datetime(y, m, day, 12, tzinfo=UTC)


def frames(client, **params):
    return client.get("/api/frames", params=params)


def test_radar_scope_frames(client, session):
    radar = make_radar(session)
    x, y = make_practice(session, "X tool"), make_practice(session, "Y tool")
    make_placement(session, radar, x, adoption=70, value=80, effective_at=d(2025, 1, 15))
    make_placement(session, radar, x, adoption=75, value=85, effective_at=d(2025, 2, 10))
    make_placement(session, radar, y, adoption=10, value=90, effective_at=d(2025, 2, 20))
    make_placement(session, radar, y, removed=True, effective_at=d(2025, 3, 5))

    response = frames(
        client,
        scope=f"radar:{radar.id}",
        **{"from": "2025-01-01T00:00:00Z"},
        to="2025-03-15T00:00:00Z",
    )
    assert response.status_code == 200
    body = response.json()
    assert body["scope"] == f"radar:{radar.id}"
    assert body["step"] == "month"
    assert [datetime.fromisoformat(f["date"]) for f in body["frames"]] == [
        datetime(2025, 1, 31, 23, 59, 59, tzinfo=UTC),
        datetime(2025, 2, 28, 23, 59, 59, tzinfo=UTC),
        datetime(2025, 3, 31, 23, 59, 59, tzinfo=UTC),
    ]
    jan, feb, mar = (f["points"] for f in body["frames"])
    assert jan == [{"practice_id": x.id, "adoption": 70, "value": 80, "radars": 1}]
    assert [p["practice_id"] for p in feb] == [x.id, y.id]
    assert mar == [{"practice_id": x.id, "adoption": 75, "value": 85, "radars": 1}]
    assert body["practices"] == {
        str(x.id): {"name": "X tool", "category": "tool"},
        str(y.id): {"name": "Y tool", "category": "tool"},
    }


def test_org_scope_aggregates_with_radar_positions(client, session):
    a, b = make_radar(session, "A"), make_radar(session, "B")
    x = make_practice(session)
    make_placement(session, a, x, adoption=80, value=90, effective_at=d(2025, 1, 10))
    make_placement(session, b, x, adoption=40, value=70, effective_at=d(2025, 1, 10))
    body = frames(client, **{"from": "2025-01-01T00:00:00Z"}, to="2025-01-20T00:00:00Z").json()
    [frame] = body["frames"]
    assert frame["points"] == [
        {
            "practice_id": x.id,
            "adoption": 60,
            "value": 80,
            "radars": 2,
            "radar_positions": [
                {"radar_id": a.id, "adoption": 80, "value": 90},
                {"radar_id": b.id, "adoption": 40, "value": 70},
            ],
        }
    ]


def test_org_default_range_runs_from_earliest_placement_to_now(client, session):
    radar = make_radar(session)
    make_placement(session, radar, make_practice(session), effective_at=d(2025, 11, 10))
    before = utcnow()
    body = frames(client).json()
    dates = [datetime.fromisoformat(f["date"]) for f in body["frames"]]
    assert dates[0] == datetime(2025, 11, 30, 23, 59, 59, tzinfo=UTC)
    assert before <= dates[-1] <= utcnow()


def test_radar_default_range_covers_at_least_the_last_year(client, session):
    radar = make_radar(session)
    make_placement(session, radar, make_practice(session))  # placed just now
    body = frames(client, scope=f"radar:{radar.id}").json()
    assert len(body["frames"]) >= 12
    assert body["frames"][0]["points"] == []
    assert len(body["frames"][-1]["points"]) == 1


def test_weekly_step(client, session):
    radar = make_radar(session)
    make_placement(session, radar, make_practice(session), effective_at=d(2025, 1, 6))
    body = frames(
        client,
        scope=f"radar:{radar.id}",
        step="week",
        **{"from": "2025-01-06T00:00:00Z"},
        to="2025-01-19T00:00:00Z",
    ).json()
    assert len(body["frames"]) == 2


def test_archived_practices_are_excluded(client, session):
    radar = make_radar(session)
    x = make_practice(session, archived_at=utcnow())
    make_placement(session, radar, x, effective_at=d(2025, 1, 10))
    body = frames(client, **{"from": "2025-01-01T00:00:00Z"}, to="2025-01-20T00:00:00Z").json()
    assert body["frames"][0]["points"] == []
    assert body["practices"] == {}


def test_empty_radar_has_single_empty_frame(client):
    body = frames(client).json()
    assert len(body["frames"]) == 1
    assert body["frames"][0]["points"] == []


@pytest.mark.parametrize(
    "params",
    [
        {"scope": "everyone"},
        {"scope": "radar:abc"},
        {"step": "day"},
        {"from": "2025-03-01T00:00:00Z", "to": "2025-01-01T00:00:00Z"},
    ],
)
def test_invalid_params_are_422(client, params):
    assert frames(client, **params).status_code == 422


def test_unknown_radar_is_404(client):
    assert frames(client, scope="radar:999999").status_code == 404


def test_huge_range_is_rejected(client):
    response = frames(client, **{"from": "0001-01-01T00:00:00Z"}, step="week")
    assert response.status_code == 422


def test_huge_range_with_offset_does_not_500(client):
    response = frames(client, **{"from": "0001-01-01T00:00:00+05:00"})
    assert response.status_code == 422


def test_frames_endpoint_accepts_radar_scope(client):
    created = client.post("/api/radars", json={"name": "Payments"}).json()
    response = client.get("/api/frames", params={"scope": f"radar:{created['id']}"})
    assert response.status_code == 200
    assert response.json()["scope"] == f"radar:{created['id']}"


def test_frames_endpoint_rejects_team_scope(client):
    assert client.get("/api/frames", params={"scope": "team:1"}).status_code == 422
