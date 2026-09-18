import os
from collections.abc import Iterator

import pytest

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://airadar:airadar@localhost:5433/airadar_test",
)
# Must be set before any `app.*` import so Settings picks it up.
os.environ["DATABASE_URL"] = TEST_DATABASE_URL

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import Engine, create_engine  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.db import get_session  # noqa: E402


@pytest.fixture(scope="session")
def engine() -> Iterator[Engine]:
    cfg = Config("alembic.ini")
    cfg.set_main_option("sqlalchemy.url", TEST_DATABASE_URL.replace("%", "%%"))
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    eng = create_engine(TEST_DATABASE_URL)
    yield eng
    eng.dispose()


@pytest.fixture
def session(engine: Engine) -> Iterator[Session]:
    connection = engine.connect()
    transaction = connection.begin()
    db = Session(bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False)
    try:
        yield db
    finally:
        db.close()
        transaction.rollback()
        connection.close()


@pytest.fixture
def app(session: Session) -> FastAPI:
    # Imported lazily: app.main pulls in every router, so tests that only need
    # the `session` fixture (not `app`/`client`) aren't forced to import and
    # pay for the whole route/model graph.
    from app.main import create_app

    application = create_app()
    application.dependency_overrides[get_session] = lambda: session
    return application


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    return TestClient(app)
