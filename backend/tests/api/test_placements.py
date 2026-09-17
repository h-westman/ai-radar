from datetime import datetime, timedelta

import pytest

from app.clock import utcnow
from tests.factories import make_placement, make_practice, make_radar


@pytest.fixture
def team(session):
    return make_radar(session)


@pytest.fixture
def practice(session):
    return make_practice(session)


def post(client, headers=None, **body):
    return client.post("/api/placements", json=body, headers=headers or {})


def test_place_defaults_to_now(client, team, practice):
    before = utcnow()
    response = post(client, team_id=team.id, practice_id=practice.id, adoption=70, value=80)
    assert response.status_code == 201
    body = response.json()
    assert (body["adoption"], body["value"], body["removed"]) == (70, 80, False)
    assert body["effective_at"] == body["recorded_at"]
    assert datetime.fromisoformat(body["recorded_at"]) >= before


def test_records_edited_by(client, team, practice):
    body = post(
        client,
        headers={"X-Edited-By": "Kim"},
        team_id=team.id,
        practice_id=practice.id,
        adoption=1,
        value=1,
    ).json()
    assert body["edited_by"] == "Kim"


def test_backdated_placement(client, team, practice):
    month_ago = utcnow() - timedelta(days=30)
    body = post(
        client,
        team_id=team.id,
        practice_id=practice.id,
        adoption=10,
        value=20,
        effective_at=month_ago.isoformat(),
    ).json()
    assert datetime.fromisoformat(body["effective_at"]) == month_ago
    assert datetime.fromisoformat(body["recorded_at"]) > month_ago


def test_future_effective_at_is_rejected(client, team, practice):
    tomorrow = (utcnow() + timedelta(days=1)).isoformat()
    response = post(
        client,
        team_id=team.id,
        practice_id=practice.id,
        adoption=1,
        value=1,
        effective_at=tomorrow,
    )
    assert response.status_code == 422


def test_naive_effective_at_is_rejected(client, team, practice):
    response = post(
        client,
        team_id=team.id,
        practice_id=practice.id,
        adoption=1,
        value=1,
        effective_at="2026-01-01T00:00:00",
    )
    assert response.status_code == 422


@pytest.mark.parametrize(
    "position",
    [
        {"adoption": 50},
        {"value": 50},
        {"adoption": 101, "value": 5},
        {"adoption": -1, "value": 5},
    ],
)
def test_position_is_required_and_bounded(client, team, practice, position):
    response = post(client, team_id=team.id, practice_id=practice.id, **position)
    assert response.status_code == 422


def test_remove_copies_current_position(client, session, team, practice):
    make_placement(
        session,
        team,
        practice,
        adoption=60,
        value=40,
        effective_at=utcnow() - timedelta(hours=1),
    )
    body = post(client, team_id=team.id, practice_id=practice.id, removed=True).json()
    assert (body["adoption"], body["value"], body["removed"]) == (60, 40, True)


def test_backdated_remove_copies_position_as_of_that_date(client, session, team, practice):
    now = utcnow()
    make_placement(
        session, team, practice, adoption=20, value=20, effective_at=now - timedelta(days=10)
    )
    make_placement(
        session, team, practice, adoption=80, value=80, effective_at=now - timedelta(days=1)
    )
    body = post(
        client,
        team_id=team.id,
        practice_id=practice.id,
        removed=True,
        effective_at=(now - timedelta(days=5)).isoformat(),
    ).json()
    assert (body["adoption"], body["value"]) == (20, 20)


def test_remove_when_not_on_radar_is_rejected(client, session, team, practice):
    assert post(client, team_id=team.id, practice_id=practice.id, removed=True).status_code == 422
    make_placement(
        session, team, practice, removed=True, effective_at=utcnow() - timedelta(hours=1)
    )
    assert post(client, team_id=team.id, practice_id=practice.id, removed=True).status_code == 422


def test_unknown_team_or_practice_is_404(client, team, practice):
    assert (
        post(client, team_id=999999, practice_id=practice.id, adoption=1, value=1).status_code
        == 404
    )
    assert post(client, team_id=team.id, practice_id=999999, adoption=1, value=1).status_code == 404


def test_archived_practice_is_rejected(client, session, team, practice):
    practice.archived_at = utcnow()
    session.flush()
    response = post(client, team_id=team.id, practice_id=practice.id, adoption=1, value=1)
    assert response.status_code == 422
