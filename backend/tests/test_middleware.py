from fastapi.testclient import TestClient

from app.db import get_session
from app.main import create_app
from app.middleware import client_ip


def make_client(session, **options):
    app = create_app(**options)
    app.dependency_overrides[get_session] = lambda: session
    return TestClient(app)


def test_writes_are_rate_limited_per_ip(session):
    client = make_client(session, rate_limit="3/minute")
    headers = {"X-Forwarded-For": "203.0.113.7:51000, 10.0.0.1"}
    codes = [
        client.post("/api/teams", json={"name": f"T{i}"}, headers=headers).status_code
        for i in range(4)
    ]
    assert codes == [201, 201, 201, 429]
    assert (
        client.post("/api/teams", json={"name": "T9"}, headers=headers).headers["Retry-After"]
        == "60"
    )
    other = client.post(
        "/api/teams", json={"name": "Other"}, headers={"X-Forwarded-For": "198.51.100.2"}
    )
    assert other.status_code == 201
    assert client.get("/api/teams", headers=headers).status_code == 200


def test_rate_limit_can_be_disabled(session):
    client = make_client(session, rate_limit=None)
    codes = {client.post("/api/teams", json={"name": f"T{i}"}).status_code for i in range(5)}
    assert codes == {201}


def test_large_bodies_are_rejected(session):
    client = make_client(session, max_body_bytes=1000)
    response = client.post(
        "/api/practices", json={"name": "Big", "category": "tool", "body_md": "x" * 2000}
    )
    assert response.status_code == 413


def test_chunked_bodies_without_content_length_are_still_capped(session):
    client = make_client(session, max_body_bytes=1000)
    response = client.post(
        "/api/practices",
        content=iter([b"x" * 3000]),
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 413


def test_client_ip_parsing():
    assert (
        client_ip({"headers": [(b"x-forwarded-for", b"203.0.113.7:51000, 10.0.0.1")]})
        == "203.0.113.7"
    )
    assert client_ip({"headers": [(b"x-forwarded-for", b"2001:db8::1")]}) == "2001:db8::1"
    assert client_ip({"headers": [], "client": ("127.0.0.1", 5000)}) == "127.0.0.1"
    assert client_ip({"headers": []}) == "unknown"
