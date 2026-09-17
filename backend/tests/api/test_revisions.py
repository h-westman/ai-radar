from tests.factories import make_practice, make_radar


def history(client, entity_type, entity_id):
    return client.get(
        "/api/revisions", params={"entity_type": entity_type, "entity_id": str(entity_id)}
    ).json()


def new_practice(client, name="Claude Code", summary="Original"):
    return client.post(
        "/api/practices", json={"name": name, "category": "tool", "summary": summary}
    ).json()


def test_history_is_newest_first(client):
    practice = new_practice(client)
    client.patch(f"/api/practices/{practice['id']}", json={"version": 1, "summary": "B"})
    client.patch(f"/api/practices/{practice['id']}", json={"version": 2, "summary": "C"})
    revisions = history(client, "practice", practice["id"])
    assert [r["action"] for r in revisions] == ["update", "update", "create"]
    assert revisions[0]["snapshot"]["summary"] == "C"


def test_history_requires_entity_params(client):
    assert client.get("/api/revisions").status_code == 422


def test_revert_practice(client):
    practice = new_practice(client)
    client.patch(f"/api/practices/{practice['id']}", json={"version": 1, "summary": "B"})
    create_revision = history(client, "practice", practice["id"])[-1]

    response = client.post(
        f"/api/revisions/{create_revision['id']}/revert", headers={"X-Edited-By": "Kim"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["entity_type"] == "practice"
    assert body["entity"]["summary"] == "Original"
    assert body["entity"]["version"] == 3
    latest = history(client, "practice", practice["id"])[0]
    assert (latest["action"], latest["edited_by"]) == ("revert", "Kim")


def test_revert_team_restores_name_and_slug(client):
    team = client.post("/api/teams", json={"name": "Platform"}).json()
    client.patch(f"/api/teams/{team['id']}", json={"version": 1, "name": "Core"})
    first = history(client, "team", team["id"])[-1]
    body = client.post(f"/api/revisions/{first['id']}/revert").json()
    assert (body["entity"]["name"], body["entity"]["slug"]) == ("Platform", "platform")


def test_revert_note(client, session):
    team_id, practice_id = make_radar(session).id, make_practice(session).id
    note_url = f"/api/teams/{team_id}/notes/{practice_id}"
    client.put(note_url, json={"version": 0, "body_md": "first"})
    client.put(note_url, json={"version": 1, "body_md": "second"})
    first = history(client, "team_note", f"{team_id}:{practice_id}")[-1]
    body = client.post(f"/api/revisions/{first['id']}/revert").json()
    assert (body["entity"]["body_md"], body["entity"]["version"]) == ("first", 3)


def test_revert_to_a_name_now_taken_conflicts(client):
    practice = new_practice(client, name="Alpha")
    client.patch(f"/api/practices/{practice['id']}", json={"version": 1, "name": "Beta"})
    new_practice(client, name="Alpha")
    first = history(client, "practice", practice["id"])[-1]
    assert client.post(f"/api/revisions/{first['id']}/revert").status_code == 409


def test_unknown_revision_is_404(client):
    assert client.post("/api/revisions/999999/revert").status_code == 404
