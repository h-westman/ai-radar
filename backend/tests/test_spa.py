import pytest
from fastapi.testclient import TestClient

from app.db import get_session
from app.main import create_app


def make_client(session, static_dir):
    app = create_app(static_dir=static_dir, rate_limit=None)
    app.dependency_overrides[get_session] = lambda: session
    return TestClient(app)


@pytest.fixture
def static_dir(tmp_path):
    build = tmp_path / "static"
    (build / "assets").mkdir(parents=True)
    (build / "index.html").write_text("<div id=root></div>")
    (build / "assets" / "app.js").write_text("console.log(1)")
    (tmp_path / "secret.txt").write_text("nope")
    return build


def test_serves_index_for_root_and_client_routes(session, static_dir):
    client = make_client(session, static_dir)
    assert client.get("/").text == "<div id=root></div>"
    assert client.get("/radar/3").text == "<div id=root></div>"


def test_serves_static_files(session, static_dir):
    assert make_client(session, static_dir).get("/assets/app.js").text == "console.log(1)"


def test_api_paths_are_not_swallowed(session, static_dir):
    client = make_client(session, static_dir)
    assert client.get("/api/nope").status_code == 404
    assert client.get("/api/health").status_code == 200


def test_path_traversal_falls_back_to_index(session, static_dir):
    response = make_client(session, static_dir).get("/%2e%2e/secret.txt")
    assert "nope" not in response.text


def test_no_catch_all_without_a_build(session, tmp_path):
    assert make_client(session, tmp_path / "missing").get("/").status_code == 404


def test_null_byte_path_falls_back_to_index(session, static_dir):
    response = make_client(session, static_dir).get("/%00")
    assert response.status_code == 200
    assert response.text == "<div id=root></div>"
