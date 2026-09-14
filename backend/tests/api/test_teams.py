from tests.factories import revisions_for


def create(client, name="Platform", headers=None, **extra):
    return client.post("/api/teams", json={"name": name, **extra}, headers=headers or {})


def test_create_team(client, session):
    response = create(client, headers={"X-Edited-By": "%C3%85sa%20Lind"})
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Platform"
    assert body["slug"] == "platform"
    assert body["version"] == 1
    assert body["description"] is None
    assert body["archived_at"] is None
    [revision] = revisions_for(session, "team", body["id"])
    assert revision.action == "create"
    assert revision.edited_by == "Åsa Lind"
    assert revision.snapshot["name"] == "Platform"


def test_blank_edited_by_is_stored_as_null(client, session):
    body = create(client, headers={"X-Edited-By": "   "}).json()
    assert revisions_for(session, "team", body["id"])[0].edited_by is None


def test_empty_name_is_rejected(client):
    assert create(client, name="   ").status_code == 422


def test_duplicate_name_conflicts_case_insensitively(client):
    create(client, "Platform")
    response = create(client, "platform")
    assert response.status_code == 409
    assert response.json()["current"]["name"] == "Platform"


def test_duplicate_of_archived_team_still_conflicts(client):
    team = create(client, "Platform").json()
    client.post(f"/api/teams/{team['id']}/archive")
    assert create(client, "Platform").status_code == 409


def test_list_hides_archived_by_default(client):
    create(client, "bravo")
    alpha = create(client, "Alpha").json()
    client.post(f"/api/teams/{alpha['id']}/archive")
    assert [t["name"] for t in client.get("/api/teams").json()] == ["bravo"]
    all_teams = client.get("/api/teams", params={"include_archived": True}).json()
    assert [t["name"] for t in all_teams] == ["Alpha", "bravo"]


def test_rename_updates_slug_version_and_revision(client, session):
    team = create(client).json()
    response = client.patch(
        f"/api/teams/{team['id']}", json={"version": 1, "name": "Platform Team"}
    )
    assert response.status_code == 200
    body = response.json()
    assert (body["name"], body["slug"], body["version"]) == ("Platform Team", "platform-team", 2)
    revisions = revisions_for(session, "team", team["id"])
    assert [r.action for r in revisions] == ["create", "update"]
    assert revisions[-1].snapshot["name"] == "Platform Team"


def test_partial_update_keeps_other_fields(client):
    team = create(client, description="Core services").json()
    body = client.patch(f"/api/teams/{team['id']}", json={"version": 1, "name": "Core"}).json()
    assert body["description"] == "Core services"


def test_stale_version_conflicts(client):
    team = create(client).json()
    client.patch(f"/api/teams/{team['id']}", json={"version": 1, "description": "a"})
    response = client.patch(f"/api/teams/{team['id']}", json={"version": 1, "description": "b"})
    assert response.status_code == 409
    assert response.json()["current"]["version"] == 2
    assert response.json()["current"]["description"] == "a"


def test_rename_to_existing_name_conflicts(client):
    create(client, "Payments")
    team = create(client, "Platform").json()
    response = client.patch(f"/api/teams/{team['id']}", json={"version": 1, "name": "PAYMENTS"})
    assert response.status_code == 409


def test_null_name_is_rejected(client):
    team = create(client).json()
    response = client.patch(f"/api/teams/{team['id']}", json={"version": 1, "name": None})
    assert response.status_code == 422


def test_archive_and_restore(client, session):
    team = create(client).json()
    archived = client.post(f"/api/teams/{team['id']}/archive").json()
    assert archived["archived_at"] is not None
    assert archived["version"] == 2
    again = client.post(f"/api/teams/{team['id']}/archive").json()
    assert again["version"] == 2  # no-op when already archived
    restored = client.post(f"/api/teams/{team['id']}/restore").json()
    assert restored["archived_at"] is None
    assert restored["version"] == 3
    actions = [r.action for r in revisions_for(session, "team", team["id"])]
    assert actions == ["create", "archive", "restore"]


def test_unicode_case_fold_conflicts_at_the_db(client):
    create(client, "istanbul")
    response = create(client, "İstanbul")
    assert response.status_code == 409


def test_integrity_race_returns_409(client, monkeypatch):
    import app.routers.teams as teams_router

    monkeypatch.setattr(teams_router, "ensure_team_name_free", lambda *a, **k: None)
    create(client, "Platform")
    response = create(client, "Platform")
    assert response.status_code == 409
    assert response.json()["current"] is None
    # session still usable afterward
    assert client.get("/api/teams").status_code == 200


def test_unknown_team_is_404(client):
    assert client.get("/api/teams/999999").status_code == 404
    assert client.patch("/api/teams/999999", json={"version": 1}).status_code == 404
    assert client.post("/api/teams/999999/archive").status_code == 404
