import pytest

from tests.factories import make_practice, make_radar, revisions_for


@pytest.fixture
def ids(session):
    return make_radar(session).id, make_practice(session).id


def url(team_id, practice_id):
    return f"/api/teams/{team_id}/notes/{practice_id}"


def test_missing_note_is_404(client, ids):
    assert client.get(url(*ids)).status_code == 404


def test_create_then_update_note(client, session, ids):
    created = client.put(
        url(*ids),
        json={"version": 0, "body_md": "We use it for refactors."},
        headers={"X-Edited-By": "Kim"},
    )
    assert created.status_code == 201
    assert created.json()["version"] == 1
    assert created.json()["edited_by"] == "Kim"

    updated = client.put(url(*ids), json={"version": 1, "body_md": "And for tests."})
    assert updated.status_code == 200
    assert (updated.json()["body_md"], updated.json()["version"]) == ("And for tests.", 2)
    assert client.get(url(*ids)).json()["body_md"] == "And for tests."

    revisions = revisions_for(session, "team_note", f"{ids[0]}:{ids[1]}")
    assert [r.action for r in revisions] == ["create", "update"]


def test_stale_version_conflicts(client, ids):
    client.put(url(*ids), json={"version": 0, "body_md": "a"})
    client.put(url(*ids), json={"version": 1, "body_md": "b"})
    response = client.put(url(*ids), json={"version": 1, "body_md": "c"})
    assert response.status_code == 409
    assert response.json()["current"]["body_md"] == "b"


def test_creating_an_existing_note_conflicts(client, ids):
    client.put(url(*ids), json={"version": 0, "body_md": "a"})
    assert client.put(url(*ids), json={"version": 0, "body_md": "b"}).status_code == 409


def test_updating_a_missing_note_conflicts(client, ids):
    response = client.put(url(*ids), json={"version": 3, "body_md": "b"})
    assert response.status_code == 409
    assert response.json()["current"] is None


def test_unknown_team_or_practice_is_404(client, ids):
    team_id, practice_id = ids
    assert (
        client.put(url(999999, practice_id), json={"version": 0, "body_md": ""}).status_code == 404
    )
    assert client.put(url(team_id, 999999), json={"version": 0, "body_md": ""}).status_code == 404


def test_body_is_limited(client, ids):
    response = client.put(url(*ids), json={"version": 0, "body_md": "x" * 100_001})
    assert response.status_code == 422
