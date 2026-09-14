from app.clock import utcnow
from tests.factories import make_practice


def similar(client, name):
    return client.get("/api/practices/similar", params={"name": name})


def test_ranks_by_trigram_similarity(client, session):
    make_practice(session, "GitHub Copilot")
    make_practice(session, "GitHub Copilot Chat")
    make_practice(session, "Claude Code")
    names = [p["name"] for p in similar(client, "copilot").json()]
    assert names == ["GitHub Copilot", "GitHub Copilot Chat"]


def test_is_case_insensitive_and_includes_archived(client, session):
    make_practice(session, "GitHub Copilot", archived_at=utcnow())
    [match] = similar(client, "github copilot").json()
    assert match["name"] == "GitHub Copilot"
    assert match["archived_at"] is not None


def test_returns_at_most_five(client, session):
    for i in range(7):
        make_practice(session, f"Prompt library {i}")
    assert len(similar(client, "Prompt library").json()) == 5


def test_requires_at_least_two_characters(client):
    assert similar(client, "a").status_code == 422
