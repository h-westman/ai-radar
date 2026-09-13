from app.db import get_session


def test_health_ok(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_reports_database_failure(app, client):
    class BrokenSession:
        def execute(self, *_args, **_kwargs):
            raise RuntimeError("connection refused")

    app.dependency_overrides[get_session] = lambda: BrokenSession()
    response = client.get("/api/health")
    assert response.status_code == 503
    assert response.json() == {"detail": "database unavailable"}
