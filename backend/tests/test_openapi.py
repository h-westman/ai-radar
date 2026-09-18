from app.main import create_app

EXPECTED_PATHS = {
    "/api/health",
    "/api/radars",
    "/api/radars/{radar_id}",
    "/api/radars/{radar_id}/archive",
    "/api/radars/{radar_id}/restore",
    "/api/radars/{radar_id}/notes/{practice_id}",
    "/api/practices",
    "/api/practices/similar",
    "/api/practices/{practice_id}",
    "/api/practices/{practice_id}/archive",
    "/api/practices/{practice_id}/restore",
    "/api/placements",
    "/api/revisions",
    "/api/revisions/{revision_id}/revert",
    "/api/frames",
}


def test_openapi_lists_every_route():
    assert EXPECTED_PATHS <= set(create_app().openapi()["paths"])


def test_spa_catch_all_is_hidden_from_openapi(tmp_path):
    (tmp_path / "index.html").write_text("x")
    paths = create_app(static_dir=tmp_path).openapi()["paths"]
    assert not any("full_path" in p for p in paths)
