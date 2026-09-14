import pytest

from tests.factories import revisions_for

PAYLOAD = {
    "name": "Claude Code",
    "category": "tool",
    "summary": "Agentic coding assistant.",
    "tags": ["agentic", "cli", "agentic"],
    "links": [{"label": "Docs", "url": "https://docs.anthropic.com/claude-code"}],
}


def create(client, **overrides):
    return client.post("/api/practices", json={**PAYLOAD, **overrides})


def test_create_practice(client, session):
    response = create(client)
    assert response.status_code == 201
    body = response.json()
    assert body["slug"] == "claude-code"
    assert body["tags"] == ["agentic", "cli"]
    assert body["links"] == [{"label": "Docs", "url": "https://docs.anthropic.com/claude-code"}]
    assert body["body_md"] == ""
    assert body["version"] == 1
    [revision] = revisions_for(session, "practice", body["id"])
    assert revision.action == "create"
    assert revision.snapshot["category"] == "tool"


@pytest.mark.parametrize(
    "overrides",
    [
        {"category": "gadget"},
        {"summary": "x" * 281},
        {"body_md": "x" * 100_001},
        {"tags": [f"t{i}" for i in range(21)]},
        {"tags": ["x" * 41]},
        {"links": [{"label": "Bad", "url": "javascript:alert(1)"}]},
        {"links": [{"label": "", "url": "https://example.com"}]},
        {"name": ""},
    ],
)
def test_create_validation(client, overrides):
    assert create(client, **overrides).status_code == 422


def test_duplicate_name_conflicts_even_when_archived(client):
    first = create(client).json()
    client.post(f"/api/practices/{first['id']}/archive")
    response = create(client, name="claude code")
    assert response.status_code == 409
    assert response.json()["current"]["id"] == first["id"]


def test_unicode_case_fold_conflicts_at_the_db(client):
    create(client, name="istanbul")
    response = create(client, name="İstanbul")
    assert response.status_code == 409


def test_integrity_race_returns_409(client, monkeypatch):
    import app.routers.practices as practices_router

    monkeypatch.setattr(practices_router, "ensure_practice_name_free", lambda *a, **k: None)
    create(client)
    response = create(client)
    assert response.status_code == 409
    assert response.json()["current"] is None
    assert client.get("/api/practices").status_code == 200


def test_get_practice_and_404(client):
    practice = create(client).json()
    assert client.get(f"/api/practices/{practice['id']}").json()["name"] == "Claude Code"
    assert client.get("/api/practices/999999").status_code == 404


def test_list_filters(client):
    create(client)
    create(
        client,
        name="Spec-driven development",
        category="practice",
        summary="Write the spec first",
        tags=["process"],
        links=[],
    )
    prompt = create(client, name="Prompt library", category="workflow", tags=[], links=[]).json()
    client.post(f"/api/practices/{prompt['id']}/archive")

    def names(**params):
        return [p["name"] for p in client.get("/api/practices", params=params).json()]

    assert names() == ["Claude Code", "Spec-driven development"]
    assert names(include_archived=True) == [
        "Claude Code",
        "Prompt library",
        "Spec-driven development",
    ]
    assert names(q="SPEC FIRST") == ["Spec-driven development"]
    assert names(q="claude") == ["Claude Code"]
    assert names(category="practice") == ["Spec-driven development"]
    assert names(tag="process") == ["Spec-driven development"]
    assert client.get("/api/practices", params={"category": "gadget"}).status_code == 422


def test_patch_updates_fields_and_writes_revision(client, session):
    practice = create(client).json()
    response = client.patch(
        f"/api/practices/{practice['id']}",
        json={"version": 1, "summary": "New summary", "tags": ["x"]},
    )
    assert response.status_code == 200
    body = response.json()
    assert (body["summary"], body["tags"], body["version"]) == ("New summary", ["x"], 2)
    assert body["name"] == "Claude Code"
    actions = [r.action for r in revisions_for(session, "practice", practice["id"])]
    assert actions == ["create", "update"]


def test_patch_rename_updates_slug(client):
    practice = create(client).json()
    body = client.patch(
        f"/api/practices/{practice['id']}", json={"version": 1, "name": "Claude Code CLI"}
    ).json()
    assert body["slug"] == "claude-code-cli"


def test_patch_stale_version_conflicts(client):
    practice = create(client).json()
    client.patch(f"/api/practices/{practice['id']}", json={"version": 1, "summary": "a"})
    response = client.patch(f"/api/practices/{practice['id']}", json={"version": 1, "summary": "b"})
    assert response.status_code == 409
    assert response.json()["current"]["summary"] == "a"


@pytest.mark.parametrize("field", ["name", "category", "summary", "body_md", "tags", "links"])
def test_patch_rejects_null_fields(client, field):
    practice = create(client).json()
    response = client.patch(f"/api/practices/{practice['id']}", json={"version": 1, field: None})
    assert response.status_code == 422


def test_archive_and_restore(client, session):
    practice = create(client).json()
    archived = client.post(f"/api/practices/{practice['id']}/archive").json()
    assert archived["archived_at"] is not None
    assert client.get("/api/practices").json() == []
    assert client.get(f"/api/practices/{practice['id']}").json()["archived_at"] is not None
    restored = client.post(f"/api/practices/{practice['id']}/restore").json()
    assert restored["archived_at"] is None
    actions = [r.action for r in revisions_for(session, "practice", practice["id"])]
    assert actions == ["create", "archive", "restore"]
