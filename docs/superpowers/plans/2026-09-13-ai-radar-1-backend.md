# AI Radar Plan 1: Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete AI Radar HTTP API: teams, the practice catalog, team notes, append-only placements, revisions with revert, duplicate suggestions and animation frames. It also serves the built SPA.

**Architecture:** A FastAPI app (sync SQLAlchemy 2 on psycopg 3) serves `/api/*` and later the static React build. All position and aggregation rules live in one pure-Python module (`app/services/frames.py`) that works on plain dataclasses, so it can be unit-tested without a database. Routers stay thin and load rows, call the services, and serialize the results with Pydantic.

**Tech Stack:** Python 3.12, uv, FastAPI, SQLAlchemy 2, Alembic, psycopg 3, pydantic-settings, `limits`, pytest, PostgreSQL 16 (`pg_trgm`), Docker Compose

**Spec:** `docs/superpowers/specs/2026-09-13-ai-radar-design.md`. Read §3 (data model and rules), §5 (API) and §7 (errors) before starting.

**Series:** This is Plan 1 of 3. Plan 2 builds the frontend and Plan 3 covers end-to-end tests, CI/CD and Azure.

## Global Constraints

- Python `>=3.12`, and every backend command runs through `uv` from the `backend/` directory.
- PostgreSQL 16 with the `pg_trgm` extension. Tests run against **real Postgres**. Never use SQLite.
- All timestamps are `timestamptz` in UTC, created through `app.clock.utcnow()`.
- Integer identity primary keys.
- Every API route is under `/api`.
- `adoption` and `value` are integers from 0 to 100 inclusive.
- Corner labels split at 50. High value with high adoption is `Core`, high value with low adoption is `Hidden gem`, low value with high adoption is `Question it`, and low value with low adoption is `Parked`.
- Names are unique case-insensitively (`lower(name)`), and the rule includes archived rows. This applies to teams and practices.
- Field limits:
  - `summary`: 280 characters or fewer
  - `body_md` and note bodies: 100,000 characters or fewer
  - tags: at most 20 per practice, each 1–40 characters
  - links: at most 20, `{label, url}` with an http or https URL
  - team and practice names: 1–100 characters
  - descriptions: 2,000 characters or fewer
- `edited_by` comes from the `X-Edited-By` header. The value is URL-decoded, trimmed, truncated to 100 characters, and stored as `null` when missing or empty.
- Updates to teams, practices and notes require `version`. A mismatch returns **409** with `{"detail": str, "current": <entity or null>}`, and so does a duplicate name.
- Nothing is ever hard-deleted. Teams and practices get `archived_at`, and placements are append-only.
- Every create, update, archive, restore or revert of a team, practice or team note writes exactly one `revisions` row. Its `snapshot` is the entity's API representation.
- Duplicate suggestions return at most 5 practices with `similarity >= 0.3`, archived practices included.
- Writes (POST, PUT, PATCH, DELETE under `/api/`) are limited to `60/minute` per client IP, taken from the first hop of `X-Forwarded-For`. Request bodies are limited to 256 KB via `Content-Length`.
- The schema lives in hand-written Alembic migrations. Don't use `--autogenerate`, because indexes and CHECK constraints exist only in the migrations.
- **Deliberate deviations from the spec:**
  - Rate limiting uses `limits`, the library slowapi is built on, directly as ASGI middleware. That way every write route is covered without per-route decorators.
  - API tests use FastAPI's `TestClient`, which is sync and built on httpx, rather than `httpx.AsyncClient`, because the app is synchronous.

## File Structure

```
docker-compose.yml                 local Postgres 16 on port 5433
docker/initdb/01-test-db.sql       creates airadar_test database
backend/
  pyproject.toml, uv.lock
  alembic.ini
  migrations/env.py                reads DATABASE_URL via app.config
  migrations/versions/0001_initial.py
  scripts/__init__.py
  scripts/export_openapi.py        dumps OpenAPI JSON for the frontend
  app/
    __init__.py
    main.py                        create_app(): routers, error handler, middleware, SPA
    config.py                      Settings (pydantic-settings)
    db.py                          Base, engine, SessionLocal, get_session
    clock.py                       utcnow()
    deps.py                        SessionDep, EditedBy dependencies
    errors.py                      ConflictError, handler, ensure_version()
    middleware.py                  WriteRateLimitMiddleware, BodySizeLimitMiddleware
    spa.py                         mount_spa(): static files + index.html fallback
    models.py                      Team, Practice, TeamNote, Placement, Revision
    schemas.py                     Pydantic request/response models
    routers/
      __init__.py
      health.py  teams.py  practices.py  notes.py
      placements.py  revisions.py  radar.py
    services/
      __init__.py
      labels.py                    corner_label()
      slugs.py                     slugify()
      frames.py                    pure: period_ends, latest_as_of, team/org frames
      positions.py                 DB → PlacementRow loading, position_as_of, current usage
      revisions.py                 record_revision(), serialize(), EDITABLE_FIELDS
      similarity.py                similar_practices()
  tests/
    conftest.py                    migrated test DB, per-test rollback, client
    factories.py                   make_team/make_practice/make_placement helpers
    test_health.py  test_schema.py  test_labels_slugs.py
    test_frames_periods.py  test_frames_aggregation.py
    api/__init__.py
    api/test_teams.py  api/test_practices.py  api/test_similar.py
    api/test_placements.py  api/test_notes.py  api/test_revisions.py
    api/test_practice_usage.py  api/test_radar.py
    test_middleware.py  test_spa.py  test_openapi.py
```

---

### Task 1: Backend scaffold, local Postgres, Alembic and the health endpoint

**Files:**
- Create: `docker-compose.yml`, `docker/initdb/01-test-db.sql`
- Create: `backend/pyproject.toml`, `backend/alembic.ini` (generated), `backend/migrations/env.py`
- Create: `backend/app/__init__.py`, `backend/app/config.py`, `backend/app/db.py`, `backend/app/clock.py`, `backend/app/main.py`, `backend/app/routers/__init__.py`, `backend/app/routers/health.py`
- Test: `backend/tests/conftest.py`, `backend/tests/test_health.py`

**Interfaces:**
- Produces:
  - `app.config.settings: Settings` with `database_url: str`, `write_rate_limit: str`, `max_body_bytes: int`
  - `app.db.Base`, `app.db.engine`, `app.db.get_session() -> Iterator[Session]`
  - `app.clock.utcnow() -> datetime` (tz-aware UTC)
  - `app.main.create_app() -> FastAPI`
  - Test fixtures `engine`, `session` (rolled back after each test), `app`, `client: TestClient`

- [ ] **Step 1: Add Docker Compose for Postgres**

`docker-compose.yml`:
```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: airadar
      POSTGRES_PASSWORD: airadar
      POSTGRES_DB: airadar
    ports:
      - "5433:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/initdb:/docker-entrypoint-initdb.d:ro
volumes:
  pgdata:
```

`docker/initdb/01-test-db.sql`:
```sql
CREATE DATABASE airadar_test;
```

Run: `docker compose up -d db && sleep 3 && docker compose exec db psql -U airadar -lqt | cut -d'|' -f1`
Expected: the list includes `airadar` and `airadar_test`.

- [ ] **Step 2: Create the Python project**

`backend/pyproject.toml`:
```toml
[project]
name = "ai-radar-backend"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "fastapi[standard]>=0.115",
  "gunicorn>=23",
  "uvicorn-worker>=0.2",
  "sqlalchemy>=2.0.30",
  "psycopg[binary]>=3.2",
  "alembic>=1.13",
  "pydantic-settings>=2.4",
  "limits>=3.13",
]

[dependency-groups]
dev = ["pytest>=8", "httpx>=0.27", "ruff>=0.6"]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]

[tool.ruff]
line-length = 100
target-version = "py312"
```

Run: `cd backend && uv sync`
Expected: this creates `.venv/` and `uv.lock` without errors.

- [ ] **Step 3: Write config, db and clock modules**

`backend/app/__init__.py`: an empty file.

`backend/app/config.py`:
```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://airadar:airadar@localhost:5433/airadar"
    write_rate_limit: str = "60/minute"
    max_body_bytes: int = 256 * 1024


settings = Settings()
```

`backend/app/db.py`:
```python
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings


class Base(DeclarativeBase):
    pass


engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_session() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session
```

`backend/app/clock.py`:
```python
from datetime import UTC, datetime


def utcnow() -> datetime:
    return datetime.now(UTC)
```

- [ ] **Step 4: Initialize Alembic**

Run: `cd backend && uv run alembic init migrations`

In the generated `backend/alembic.ini`, change the line `sqlalchemy.url = driver://user:pass@localhost/dbname` to:
```ini
sqlalchemy.url =
```

Replace `backend/migrations/env.py` entirely:
```python
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.config import settings
from app.db import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

if not config.get_main_option("sqlalchemy.url"):
    config.set_main_option("sqlalchemy.url", settings.database_url.replace("%", "%%"))

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

- [ ] **Step 5: Write the test fixtures and a failing health test**

`backend/tests/conftest.py`:
```python
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
from app.main import create_app  # noqa: E402


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
    db = Session(
        bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False
    )
    try:
        yield db
    finally:
        db.close()
        transaction.rollback()
        connection.close()


@pytest.fixture
def app(session: Session) -> FastAPI:
    application = create_app()
    application.dependency_overrides[get_session] = lambda: session
    return application


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    return TestClient(app)
```

`backend/tests/test_health.py`:
```python
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
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_health.py -v`
Expected: an ERROR during collection, `ModuleNotFoundError: No module named 'app.main'`.

- [ ] **Step 7: Implement the health router and app factory**

`backend/app/routers/__init__.py`: an empty file.

`backend/app/routers/health.py`:
```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_session

router = APIRouter(tags=["health"])


@router.get("/health")
def health(session: Session = Depends(get_session)) -> dict[str, str]:
    try:
        session.execute(text("SELECT 1"))
    except Exception as exc:
        raise HTTPException(status_code=503, detail="database unavailable") from exc
    return {"status": "ok"}
```

`backend/app/main.py`:
```python
from fastapi import FastAPI

from app.routers import health


def create_app() -> FastAPI:
    app = FastAPI(title="AI Radar")
    app.include_router(health.router, prefix="/api")
    return app


app = create_app()
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd backend && uv run pytest -v`
Expected: 2 passed.

Run: `cd backend && uv run ruff check .`
Expected: `All checks passed!`

- [ ] **Step 9: Commit**

```bash
git add docker-compose.yml docker backend
git commit -m "feat(backend): scaffold FastAPI app, Alembic, test DB fixtures and health endpoint"
```

### Task 2: Corner labels and slugs

**Files:**
- Create: `backend/app/services/__init__.py` (empty), `backend/app/services/labels.py`, `backend/app/services/slugs.py`
- Test: `backend/tests/__init__.py` (empty), `backend/tests/test_labels_slugs.py`

**Interfaces:**
- Produces:
  - `app.services.labels.corner_label(adoption: int, value: int) -> str`, which returns one of `"Core" | "Hidden gem" | "Question it" | "Parked"`
  - `app.services.slugs.slugify(name: str) -> str`: lowercase ASCII with words joined by `-`, at most 120 characters, and `"item"` when nothing is left

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_labels_slugs.py`:
```python
import pytest

from app.services.labels import corner_label
from app.services.slugs import slugify


@pytest.mark.parametrize(
    ("adoption", "value", "expected"),
    [
        (80, 90, "Core"),
        (50, 50, "Core"),
        (49, 50, "Hidden gem"),
        (10, 95, "Hidden gem"),
        (50, 49, "Question it"),
        (90, 10, "Question it"),
        (49, 49, "Parked"),
        (0, 0, "Parked"),
    ],
)
def test_corner_label(adoption, value, expected):
    assert corner_label(adoption, value) == expected


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("GitHub Copilot", "github-copilot"),
        ("  Spec-driven dev! ", "spec-driven-dev"),
        ("Årsplan för AI", "arsplan-for-ai"),
        ("!!!", "item"),
        ("a" * 200, "a" * 120),
    ],
)
def test_slugify(name, expected):
    assert slugify(name) == expected
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_labels_slugs.py -v`
Expected: ERROR, `ModuleNotFoundError: No module named 'app.services'`.

- [ ] **Step 3: Implement**

`backend/app/services/labels.py`:
```python
CORE = "Core"
HIDDEN_GEM = "Hidden gem"
QUESTION_IT = "Question it"
PARKED = "Parked"


def corner_label(adoption: int, value: int) -> str:
    high_adoption = adoption >= 50
    if value >= 50:
        return CORE if high_adoption else HIDDEN_GEM
    return QUESTION_IT if high_adoption else PARKED
```

`backend/app/services/slugs.py`:
```python
import re
import unicodedata


def slugify(name: str) -> str:
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")
    return slug[:120] or "item"
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_labels_slugs.py -v`
Expected: 13 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services backend/tests/__init__.py backend/tests/test_labels_slugs.py
git commit -m "feat(backend): add corner label and slug helpers"
```

---

### Task 3: ORM models, initial migration and test factories

**Files:**
- Create: `backend/app/models.py`, `backend/migrations/versions/0001_initial.py`
- Modify: `backend/migrations/env.py` (register the models)
- Test: `backend/tests/factories.py`, `backend/tests/test_schema.py`

**Interfaces:**
- Consumes: `app.db.Base`, `app.clock.utcnow`, `app.services.slugs.slugify`
- Produces:
  - `app.models.Team`: `id, name, slug, description, version, created_at, updated_at, archived_at`
  - `app.models.Practice`: `id, name, slug, category, summary, body_md, tags: list[str], links: list[dict], version, created_at, updated_at, archived_at`
  - `app.models.TeamNote`: primary key `(team_id, practice_id)`, plus `body_md, version, updated_at, edited_by`
  - `app.models.Placement`: `id, team_id, practice_id, adoption, value, removed, effective_at, recorded_at, edited_by`
  - `app.models.Revision`: `id, entity_type, entity_id, action, snapshot: dict, edited_by, created_at`
  - `app.models.CATEGORIES = ("tool", "skill", "practice", "workflow")`
  - `tests.factories.make_team(session, name="Platform", **fields) -> Team`
  - `tests.factories.make_practice(session, name="Claude Code", category="tool", **fields) -> Practice`
  - `tests.factories.make_placement(session, team, practice, *, adoption=50, value=50, removed=False, effective_at=None, recorded_at=None) -> Placement`
  - All three factories flush, so ids are assigned.

- [ ] **Step 1: Write the factories and the failing schema tests**

`backend/tests/factories.py`:
```python
from datetime import datetime

from sqlalchemy.orm import Session

from app.clock import utcnow
from app.models import Placement, Practice, Team
from app.services.slugs import slugify


def make_team(session: Session, name: str = "Platform", **fields) -> Team:
    team = Team(name=name, slug=slugify(name), **fields)
    session.add(team)
    session.flush()
    return team


def make_practice(
    session: Session, name: str = "Claude Code", category: str = "tool", **fields
) -> Practice:
    practice = Practice(name=name, slug=slugify(name), category=category, **fields)
    session.add(practice)
    session.flush()
    return practice


def make_placement(
    session: Session,
    team: Team,
    practice: Practice,
    *,
    adoption: int = 50,
    value: int = 50,
    removed: bool = False,
    effective_at: datetime | None = None,
    recorded_at: datetime | None = None,
) -> Placement:
    now = utcnow()
    placement = Placement(
        team_id=team.id,
        practice_id=practice.id,
        adoption=adoption,
        value=value,
        removed=removed,
        effective_at=effective_at or now,
        recorded_at=recorded_at or now,
    )
    session.add(placement)
    session.flush()
    return placement
```

`backend/tests/test_schema.py`:
```python
import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

from tests.factories import make_placement, make_practice, make_team


def test_all_tables_exist(session):
    tables = set(inspect(session.connection()).get_table_names())
    assert {"teams", "practices", "team_notes", "placements", "revisions"} <= tables


def test_pg_trgm_is_available(session):
    assert session.execute(text("SELECT similarity('copilot', 'copilot')")).scalar_one() == 1.0


def test_team_names_are_unique_case_insensitively(session):
    make_team(session, "Platform")
    with pytest.raises(IntegrityError):
        make_team(session, "platform")


def test_practice_names_are_unique_case_insensitively(session):
    make_practice(session, "Claude Code")
    with pytest.raises(IntegrityError):
        make_practice(session, "CLAUDE CODE")


def test_practice_category_is_constrained(session):
    with pytest.raises(IntegrityError):
        make_practice(session, "Weird", category="gadget")


def test_placement_values_are_constrained(session):
    team = make_team(session)
    practice = make_practice(session)
    with pytest.raises(IntegrityError):
        make_placement(session, team, practice, adoption=101)


def test_new_rows_get_defaults(session):
    practice = make_practice(session)
    assert practice.version == 1
    assert practice.tags == []
    assert practice.links == []
    assert practice.archived_at is None
    assert practice.created_at.tzinfo is not None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_schema.py -v`
Expected: ERROR, `ModuleNotFoundError: No module named 'app.models'`.

- [ ] **Step 3: Write the models**

`backend/app/models.py`:
```python
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Identity,
    Integer,
    SmallInteger,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.clock import utcnow
from app.db import Base

CATEGORIES = ("tool", "skill", "practice", "workflow")

# Indexes and CHECK constraints are defined in migrations/versions/*.py only.


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[int] = mapped_column(Integer, Identity(), primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    slug: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text, default=None)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)


class Practice(Base):
    __tablename__ = "practices"

    id: Mapped[int] = mapped_column(Integer, Identity(), primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    slug: Mapped[str] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(String(20))
    summary: Mapped[str] = mapped_column(String(280), default="")
    body_md: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[list[str]] = mapped_column(ARRAY(String(40)), default=list)
    links: Mapped[list[dict]] = mapped_column(JSONB, default=list)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)


class TeamNote(Base):
    __tablename__ = "team_notes"

    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), primary_key=True)
    practice_id: Mapped[int] = mapped_column(ForeignKey("practices.id"), primary_key=True)
    body_md: Mapped[str] = mapped_column(Text, default="")
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    edited_by: Mapped[str | None] = mapped_column(String(100), default=None)


class Placement(Base):
    __tablename__ = "placements"

    id: Mapped[int] = mapped_column(Integer, Identity(), primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"))
    practice_id: Mapped[int] = mapped_column(ForeignKey("practices.id"))
    adoption: Mapped[int] = mapped_column(SmallInteger)
    value: Mapped[int] = mapped_column(SmallInteger)
    removed: Mapped[bool] = mapped_column(Boolean, default=False)
    effective_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    edited_by: Mapped[str | None] = mapped_column(String(100), default=None)


class Revision(Base):
    __tablename__ = "revisions"

    id: Mapped[int] = mapped_column(Integer, Identity(), primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(20))
    entity_id: Mapped[str] = mapped_column(String(50))
    action: Mapped[str] = mapped_column(String(20))
    snapshot: Mapped[dict] = mapped_column(JSONB)
    edited_by: Mapped[str | None] = mapped_column(String(100), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
```

In `backend/migrations/env.py`, add this line directly after `from app.db import Base`:
```python
import app.models  # noqa: F401  (registers tables on Base.metadata)
```

- [ ] **Step 4: Write the initial migration**

`backend/migrations/versions/0001_initial.py`:
```python
"""initial schema

Revision ID: 0001
Revises:
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def _ts(name: str, nullable: bool = False) -> sa.Column:
    return sa.Column(
        name,
        sa.DateTime(timezone=True),
        nullable=nullable,
        server_default=None if nullable else sa.func.now(),
    )


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    op.create_table(
        "teams",
        sa.Column("id", sa.Integer, sa.Identity(), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("slug", sa.String(120), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        _ts("created_at"),
        _ts("updated_at"),
        _ts("archived_at", nullable=True),
    )
    op.execute("CREATE UNIQUE INDEX uq_teams_name_lower ON teams (lower(name))")

    op.create_table(
        "practices",
        sa.Column("id", sa.Integer, sa.Identity(), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("slug", sa.String(120), nullable=False),
        sa.Column("category", sa.String(20), nullable=False),
        sa.Column("summary", sa.String(280), nullable=False, server_default=""),
        sa.Column("body_md", sa.Text, nullable=False, server_default=""),
        sa.Column(
            "tags", postgresql.ARRAY(sa.String(40)), nullable=False, server_default="{}"
        ),
        sa.Column(
            "links", postgresql.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")
        ),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        _ts("created_at"),
        _ts("updated_at"),
        _ts("archived_at", nullable=True),
        sa.CheckConstraint(
            "category IN ('tool', 'skill', 'practice', 'workflow')",
            name="ck_practices_category",
        ),
    )
    op.execute("CREATE UNIQUE INDEX uq_practices_name_lower ON practices (lower(name))")
    op.execute("CREATE INDEX ix_practices_name_trgm ON practices USING gin (name gin_trgm_ops)")

    op.create_table(
        "team_notes",
        sa.Column("team_id", sa.Integer, sa.ForeignKey("teams.id"), primary_key=True),
        sa.Column("practice_id", sa.Integer, sa.ForeignKey("practices.id"), primary_key=True),
        sa.Column("body_md", sa.Text, nullable=False, server_default=""),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        _ts("updated_at"),
        sa.Column("edited_by", sa.String(100), nullable=True),
    )

    op.create_table(
        "placements",
        sa.Column("id", sa.Integer, sa.Identity(), primary_key=True),
        sa.Column("team_id", sa.Integer, sa.ForeignKey("teams.id"), nullable=False),
        sa.Column("practice_id", sa.Integer, sa.ForeignKey("practices.id"), nullable=False),
        sa.Column("adoption", sa.SmallInteger, nullable=False),
        sa.Column("value", sa.SmallInteger, nullable=False),
        sa.Column("removed", sa.Boolean, nullable=False, server_default=sa.false()),
        _ts("effective_at"),
        _ts("recorded_at"),
        sa.Column("edited_by", sa.String(100), nullable=True),
        sa.CheckConstraint("adoption BETWEEN 0 AND 100", name="ck_placements_adoption"),
        sa.CheckConstraint("value BETWEEN 0 AND 100", name="ck_placements_value"),
    )
    op.execute(
        "CREATE INDEX ix_placements_lookup ON placements "
        "(team_id, practice_id, effective_at DESC, recorded_at DESC)"
    )

    op.create_table(
        "revisions",
        sa.Column("id", sa.Integer, sa.Identity(), primary_key=True),
        sa.Column("entity_type", sa.String(20), nullable=False),
        sa.Column("entity_id", sa.String(50), nullable=False),
        sa.Column("action", sa.String(20), nullable=False),
        sa.Column("snapshot", postgresql.JSONB, nullable=False),
        sa.Column("edited_by", sa.String(100), nullable=True),
        _ts("created_at"),
        sa.CheckConstraint(
            "entity_type IN ('team', 'practice', 'team_note')", name="ck_revisions_entity_type"
        ),
        sa.CheckConstraint(
            "action IN ('create', 'update', 'archive', 'restore', 'revert')",
            name="ck_revisions_action",
        ),
    )
    op.execute(
        "CREATE INDEX ix_revisions_entity ON revisions (entity_type, entity_id, created_at DESC)"
    )


def downgrade() -> None:
    for table in ("revisions", "placements", "team_notes", "practices", "teams"):
        op.drop_table(table)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && uv run pytest -v`
Expected: all tests pass (2 health, 13 label/slug and 7 schema tests).

Also check that the migration applies to the dev database: `cd backend && uv run alembic upgrade head`
Expected: `Running upgrade  -> 0001, initial schema`.

- [ ] **Step 6: Commit**

```bash
git add backend/app/models.py backend/migrations backend/tests/factories.py backend/tests/test_schema.py
git commit -m "feat(backend): add ORM models, initial migration and test factories"
```

### Task 4: Frames, part 1: period dates and "as of" resolution (pure)

This module deliberately has **no database access**. It works on `PlacementRow` and `TeamRow` dataclasses, so every rule in spec §3 can be tested exhaustively and fast.

**Files:**
- Create: `backend/app/services/frames.py`
- Test: `backend/tests/test_frames_periods.py`

**Interfaces:**
- Produces (from `app.services.frames`):
  - `Step = Literal["week", "month"]`
  - `@dataclass(frozen=True) PlacementRow(id: int, team_id: int, practice_id: int, adoption: int, value: int, removed: bool, effective_at: datetime, recorded_at: datetime)`
  - `@dataclass(frozen=True) TeamRow(id: int, archived_at: datetime | None)`
  - `@dataclass(frozen=True) TeamPosition(team_id: int, adoption: int, value: int)`
  - `@dataclass(frozen=True) Point(practice_id: int, adoption: int, value: int, teams: int, team_positions: tuple[TeamPosition, ...] | None = None)`
  - `@dataclass(frozen=True) Frame(date: datetime, points: list[Point])`
  - `period_end(moment: datetime, step: Step) -> datetime`: 23:59:59 UTC on the Sunday or last day of the month
  - `period_ends(start: datetime, end: datetime, step: Step, now: datetime) -> list[datetime]`
  - `latest_as_of(placements: Iterable[PlacementRow], at: datetime) -> dict[tuple[int, int], PlacementRow]`, keyed by `(team_id, practice_id)`. It **includes** removed rows, and callers filter them out.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_frames_periods.py`:
```python
from datetime import UTC, datetime, timedelta, timezone

from app.services.frames import PlacementRow, latest_as_of, period_end, period_ends


def dt(y, m, d, h=12, mi=0, s=0):
    return datetime(y, m, d, h, mi, s, tzinfo=UTC)


def end_of(y, m, d):
    return datetime(y, m, d, 23, 59, 59, tzinfo=UTC)


def row(id, *, eff, rec=None, team=1, practice=1, adoption=50, value=50, removed=False):
    return PlacementRow(
        id=id,
        team_id=team,
        practice_id=practice,
        adoption=adoption,
        value=value,
        removed=removed,
        effective_at=eff,
        recorded_at=rec or eff,
    )


# --- period_end -------------------------------------------------------------


def test_week_ends_on_sunday():
    assert period_end(dt(2026, 9, 9), "week") == end_of(2026, 9, 13)  # Wed -> Sun


def test_sunday_is_its_own_week_end():
    assert period_end(end_of(2026, 9, 13), "week") == end_of(2026, 9, 13)


def test_month_end_handles_short_and_leap_months():
    assert period_end(dt(2026, 2, 10), "month") == end_of(2026, 2, 28)
    assert period_end(dt(2028, 2, 10), "month") == end_of(2028, 2, 29)
    assert period_end(dt(2026, 12, 5), "month") == end_of(2026, 12, 31)


def test_period_end_converts_to_utc_first():
    cest = timezone(timedelta(hours=2))
    # 1 April 01:00 in UTC+2 is still 31 March in UTC.
    assert period_end(datetime(2026, 4, 1, 1, 0, tzinfo=cest), "month") == end_of(2026, 3, 31)


# --- period_ends ------------------------------------------------------------


def test_monthly_period_ends_in_the_past():
    now = dt(2026, 9, 13)
    assert period_ends(dt(2026, 1, 15), dt(2026, 3, 20), "month", now) == [
        end_of(2026, 1, 31),
        end_of(2026, 2, 28),
        end_of(2026, 3, 31),
    ]


def test_last_frame_is_now_when_range_ends_today():
    now = dt(2026, 9, 13, 10)
    assert period_ends(dt(2026, 7, 2), now, "month", now) == [
        end_of(2026, 7, 31),
        end_of(2026, 8, 31),
        now,
    ]


def test_weekly_period_ends():
    now = dt(2026, 9, 20)
    assert period_ends(dt(2026, 8, 31), dt(2026, 9, 13), "week", now) == [
        end_of(2026, 9, 6),
        end_of(2026, 9, 13),
    ]


def test_empty_when_start_after_end():
    assert period_ends(dt(2026, 5, 1), dt(2026, 3, 1), "month", dt(2026, 9, 13)) == []


# --- latest_as_of -----------------------------------------------------------


def test_latest_effective_placement_wins():
    rows = [row(1, eff=dt(2026, 1, 10)), row(2, eff=dt(2026, 3, 10))]
    assert latest_as_of(rows, dt(2026, 4, 1))[(1, 1)].id == 2
    assert latest_as_of(rows, dt(2026, 2, 1))[(1, 1)].id == 1
    assert (1, 1) not in latest_as_of(rows, dt(2025, 12, 1))


def test_backdated_placement_does_not_override_later_effective_one():
    on_time = row(1, eff=dt(2026, 3, 10), rec=dt(2026, 3, 10))
    backdated = row(2, eff=dt(2026, 2, 10), rec=dt(2026, 4, 1))
    assert latest_as_of([on_time, backdated], dt(2026, 4, 2))[(1, 1)].id == 1
    assert latest_as_of([on_time, backdated], dt(2026, 2, 28))[(1, 1)].id == 2


def test_same_effective_time_later_recorded_wins():
    same = dt(2026, 3, 10)
    rows = [row(1, eff=same, rec=dt(2026, 3, 11)), row(2, eff=same, rec=dt(2026, 3, 10))]
    assert latest_as_of(rows, dt(2026, 4, 1))[(1, 1)].id == 1


def test_full_tie_highest_id_wins():
    same = dt(2026, 3, 10)
    rows = [row(7, eff=same), row(3, eff=same)]
    assert latest_as_of(rows, dt(2026, 4, 1))[(1, 1)].id == 7


def test_keys_are_per_team_and_practice_and_removed_rows_are_kept():
    rows = [
        row(1, eff=dt(2026, 1, 1), team=1, practice=1),
        row(2, eff=dt(2026, 1, 1), team=2, practice=1, removed=True),
        row(3, eff=dt(2026, 1, 1), team=1, practice=2),
    ]
    result = latest_as_of(rows, dt(2026, 2, 1))
    assert set(result) == {(1, 1), (2, 1), (1, 2)}
    assert result[(2, 1)].removed is True
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_frames_periods.py -v`
Expected: ERROR, `ModuleNotFoundError: No module named 'app.services.frames'`.

- [ ] **Step 3: Implement**

`backend/app/services/frames.py`:
```python
"""Pure position and aggregation rules (spec §3). No database access here."""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

Step = Literal["week", "month"]


@dataclass(frozen=True)
class PlacementRow:
    id: int
    team_id: int
    practice_id: int
    adoption: int
    value: int
    removed: bool
    effective_at: datetime
    recorded_at: datetime


@dataclass(frozen=True)
class TeamRow:
    id: int
    archived_at: datetime | None


@dataclass(frozen=True)
class TeamPosition:
    team_id: int
    adoption: int
    value: int


@dataclass(frozen=True)
class Point:
    practice_id: int
    adoption: int
    value: int
    teams: int
    team_positions: tuple[TeamPosition, ...] | None = None


@dataclass(frozen=True)
class Frame:
    date: datetime
    points: list[Point]


def period_end(moment: datetime, step: Step) -> datetime:
    day = moment.astimezone(UTC).date()
    if step == "week":
        end_day = day + timedelta(days=6 - day.weekday())
    else:
        first_of_next = (day.replace(day=28) + timedelta(days=4)).replace(day=1)
        end_day = first_of_next - timedelta(days=1)
    return datetime(end_day.year, end_day.month, end_day.day, 23, 59, 59, tzinfo=UTC)


def period_ends(start: datetime, end: datetime, step: Step, now: datetime) -> list[datetime]:
    dates: list[datetime] = []
    current = period_end(start, step)
    last = period_end(end, step)
    while current <= last:
        dates.append(current)
        current = period_end(current + timedelta(seconds=1), step)
    if dates and end.astimezone(UTC).date() == now.astimezone(UTC).date():
        dates[-1] = now
    return dates


def _order(p: PlacementRow) -> tuple[datetime, datetime, int]:
    return (p.effective_at, p.recorded_at, p.id)


def latest_as_of(
    placements: Iterable[PlacementRow], at: datetime
) -> dict[tuple[int, int], PlacementRow]:
    latest: dict[tuple[int, int], PlacementRow] = {}
    for p in placements:
        if p.effective_at > at:
            continue
        key = (p.team_id, p.practice_id)
        current = latest.get(key)
        if current is None or _order(p) > _order(current):
            latest[key] = p
    return latest
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_frames_periods.py -v`
Expected: 13 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/frames.py backend/tests/test_frames_periods.py
git commit -m "feat(backend): add frame period dates and as-of placement resolution"
```

---

### Task 5: Frames, part 2: team and org aggregation (pure)

**Files:**
- Modify: `backend/app/services/frames.py` (append functions)
- Test: `backend/tests/test_frames_aggregation.py`

**Interfaces:**
- Consumes: everything produced by Task 4
- Produces (from `app.services.frames`):
  - `active_team_ids(teams: Iterable[TeamRow], placements: Sequence[PlacementRow], at: datetime) -> set[int]`
  - `team_frame(team_id: int, placements: Sequence[PlacementRow], practice_ids: set[int], at: datetime) -> list[Point]`: points sorted by `practice_id`, `teams=1`, `team_positions=None`
  - `org_frame(teams: Sequence[TeamRow], placements: Sequence[PlacementRow], practice_ids: set[int], at: datetime) -> list[Point]`: points sorted by `practice_id`, with `team_positions` sorted by `team_id`
  - `build_frames(*, scope_team_id: int | None, teams: Sequence[TeamRow], placements: Sequence[PlacementRow], practice_ids: set[int], dates: list[datetime]) -> list[Frame]`, where `scope_team_id=None` means the org scope
- Rounding is **half up** (`int(x + 0.5)`), not Python's banker's rounding.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_frames_aggregation.py`:
```python
from datetime import UTC, datetime

from app.services.frames import (
    PlacementRow,
    Point,
    TeamPosition,
    TeamRow,
    active_team_ids,
    build_frames,
    org_frame,
    team_frame,
)

JAN = datetime(2026, 1, 31, 23, 59, 59, tzinfo=UTC)
FEB = datetime(2026, 2, 28, 23, 59, 59, tzinfo=UTC)
MAR = datetime(2026, 3, 31, 23, 59, 59, tzinfo=UTC)

_ids = iter(range(1, 10_000))


def place(team, practice, adoption, value, eff, removed=False):
    return PlacementRow(
        id=next(_ids),
        team_id=team,
        practice_id=practice,
        adoption=adoption,
        value=value,
        removed=removed,
        effective_at=eff,
        recorded_at=eff,
    )


def teams(*ids, archived=None):
    archived = archived or {}
    return [TeamRow(id=i, archived_at=archived.get(i)) for i in ids]


X, Y = 10, 20
ALL = {X, Y}


def test_team_frame_lists_on_radar_practices_only():
    rows = [
        place(1, Y, 30, 40, JAN),
        place(1, X, 70, 80, JAN),
        place(1, X, 70, 80, FEB, removed=True),
        place(2, X, 10, 10, JAN),
    ]
    assert team_frame(1, rows, ALL, JAN) == [
        Point(practice_id=X, adoption=70, value=80, teams=1),
        Point(practice_id=Y, adoption=30, value=40, teams=1),
    ]
    assert team_frame(1, rows, ALL, FEB) == [Point(practice_id=Y, adoption=30, value=40, teams=1)]


def test_team_frame_skips_practices_not_in_practice_ids():
    rows = [place(1, X, 70, 80, JAN), place(1, Y, 30, 40, JAN)]
    assert [p.practice_id for p in team_frame(1, rows, {Y}, JAN)] == [Y]


def test_org_frame_counts_non_users_as_zero_adoption():
    rows = [
        place(1, X, 80, 90, JAN),
        place(2, X, 40, 70, JAN),
        place(3, Y, 20, 20, JAN),
    ]
    assert org_frame(teams(1, 2, 3), rows, ALL, JAN) == [
        Point(
            practice_id=X,
            adoption=40,  # (80 + 40 + 0) / 3
            value=80,  # (90 + 70) / 2
            teams=2,
            team_positions=(TeamPosition(1, 80, 90), TeamPosition(2, 40, 70)),
        ),
        Point(
            practice_id=Y,
            adoption=7,  # 20 / 3 = 6.67
            value=20,
            teams=1,
            team_positions=(TeamPosition(3, 20, 20),),
        ),
    ]


def test_teams_count_only_once_they_have_started():
    rows = [place(1, X, 80, 90, JAN), place(2, X, 40, 70, JAN), place(3, Y, 20, 20, MAR)]
    assert active_team_ids(teams(1, 2, 3), rows, FEB) == {1, 2}
    [x] = org_frame(teams(1, 2, 3), rows, ALL, FEB)
    assert x.adoption == 60  # (80 + 40) / 2


def test_backdated_team_counts_from_its_backdated_date():
    rows = [place(1, X, 80, 90, JAN)]
    assert active_team_ids(teams(1), rows, JAN) == {1}


def test_archived_teams_drop_out_from_archive_date():
    archived_mid_feb = datetime(2026, 2, 15, tzinfo=UTC)
    rows = [place(1, X, 80, 90, JAN), place(2, X, 40, 70, JAN)]
    roster = teams(1, 2, archived={2: archived_mid_feb})
    assert active_team_ids(roster, rows, JAN) == {1, 2}
    assert active_team_ids(roster, rows, FEB) == {1}
    [x] = org_frame(roster, rows, ALL, FEB)
    assert (x.adoption, x.value, x.teams) == (80, 90, 1)


def test_removed_practice_keeps_team_active_as_zero():
    rows = [
        place(1, X, 80, 90, JAN),
        place(2, X, 40, 70, JAN),
        place(2, X, 40, 70, FEB, removed=True),
    ]
    [x] = org_frame(teams(1, 2), rows, ALL, FEB)
    assert (x.adoption, x.value, x.teams) == (40, 90, 1)


def test_rounding_is_half_up():
    rows = [place(1, X, 45, 50, JAN), place(2, Y, 50, 50, JAN)]
    x = next(p for p in org_frame(teams(1, 2), rows, ALL, JAN) if p.practice_id == X)
    assert x.adoption == 23  # 22.5 rounds up


def test_org_frame_is_empty_without_active_teams():
    assert org_frame(teams(1), [], ALL, JAN) == []


def test_build_frames_dispatches_on_scope():
    rows = [place(1, X, 80, 90, JAN), place(2, X, 40, 70, FEB)]
    org = build_frames(
        scope_team_id=None, teams=teams(1, 2), placements=rows, practice_ids=ALL, dates=[JAN, FEB]
    )
    assert [f.date for f in org] == [JAN, FEB]
    assert org[0].points[0].adoption == 80  # only team 1 active in January
    assert org[1].points[0].adoption == 60
    team = build_frames(
        scope_team_id=2, teams=teams(1, 2), placements=rows, practice_ids=ALL, dates=[JAN, FEB]
    )
    assert team[0].points == []
    assert team[1].points == [Point(practice_id=X, adoption=40, value=70, teams=1)]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_frames_aggregation.py -v`
Expected: ERROR, `ImportError: cannot import name 'active_team_ids'`.

- [ ] **Step 3: Implement (append to `backend/app/services/frames.py`)**

First change the import line at the top of the file to:
```python
from collections.abc import Iterable, Sequence
```

Then append:
```python
def _round(x: float) -> int:
    return int(x + 0.5)


def active_team_ids(
    teams: Iterable[TeamRow], placements: Sequence[PlacementRow], at: datetime
) -> set[int]:
    started = {p.team_id for p in placements if p.effective_at <= at}
    return {
        t.id
        for t in teams
        if t.id in started and (t.archived_at is None or t.archived_at > at)
    }


def team_frame(
    team_id: int, placements: Sequence[PlacementRow], practice_ids: set[int], at: datetime
) -> list[Point]:
    latest = latest_as_of((p for p in placements if p.team_id == team_id), at)
    points = [
        Point(practice_id=p.practice_id, adoption=p.adoption, value=p.value, teams=1)
        for p in latest.values()
        if not p.removed and p.practice_id in practice_ids
    ]
    return sorted(points, key=lambda point: point.practice_id)


def org_frame(
    teams: Sequence[TeamRow],
    placements: Sequence[PlacementRow],
    practice_ids: set[int],
    at: datetime,
) -> list[Point]:
    active = active_team_ids(teams, placements, at)
    if not active:
        return []
    latest = latest_as_of((p for p in placements if p.team_id in active), at)
    by_practice: dict[int, list[PlacementRow]] = {}
    for p in latest.values():
        if not p.removed and p.practice_id in practice_ids:
            by_practice.setdefault(p.practice_id, []).append(p)

    points: list[Point] = []
    for practice_id in sorted(by_practice):
        rows = sorted(by_practice[practice_id], key=lambda r: r.team_id)
        points.append(
            Point(
                practice_id=practice_id,
                adoption=_round(sum(r.adoption for r in rows) / len(active)),
                value=_round(sum(r.value for r in rows) / len(rows)),
                teams=len(rows),
                team_positions=tuple(TeamPosition(r.team_id, r.adoption, r.value) for r in rows),
            )
        )
    return points


def build_frames(
    *,
    scope_team_id: int | None,
    teams: Sequence[TeamRow],
    placements: Sequence[PlacementRow],
    practice_ids: set[int],
    dates: list[datetime],
) -> list[Frame]:
    if scope_team_id is None:
        return [Frame(d, org_frame(teams, placements, practice_ids, d)) for d in dates]
    return [Frame(d, team_frame(scope_team_id, placements, practice_ids, d)) for d in dates]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_frames_periods.py tests/test_frames_aggregation.py -v`
Expected: 23 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/frames.py backend/tests/test_frames_aggregation.py
git commit -m "feat(backend): add team and org frame aggregation"
```

### Task 6: Teams API, with shared dependencies, conflicts and revisions

This task also introduces the pieces every later router reuses: the `SessionDep` and `EditedBy` dependencies, `ConflictError` with its 409 handler, `ensure_version`, and the revision service.

**Files:**
- Create: `backend/app/deps.py`, `backend/app/errors.py`, `backend/app/schemas.py`, `backend/app/services/revisions.py`, `backend/app/routers/teams.py`
- Modify: `backend/app/main.py`, `backend/tests/factories.py` (add `revisions_for`)
- Test: `backend/tests/api/__init__.py` (empty), `backend/tests/api/test_teams.py`

**Interfaces:**
- Consumes: `Team`, `Revision`, `TeamNote` models, `slugify`, `utcnow`
- Produces:
  - `app.deps.SessionDep`: an `Annotated[Session, Depends(get_session)]` type alias for route parameters
  - `app.deps.EditedBy`: an `Annotated[str | None, Depends(edited_by)]` type alias for route parameters
  - `app.errors.ConflictError(detail: str, current: dict | None = None)` produces a 409 response with the body `{"detail", "current"}`
  - `app.errors.ensure_version(actual: int, expected: int, current: dict) -> None` raises `ConflictError` on a mismatch
  - `app.schemas.ORMModel`, a base class with `from_attributes=True`
  - `app.schemas.Name` and `app.schemas.Description` (annotated str types)
  - `app.schemas.TeamOut`, `TeamCreate`, `TeamUpdate`
  - `app.services.revisions.record_revision(session, entity, action: str, edited_by: str | None) -> Revision`
  - `app.services.revisions.serialize(entity) -> dict`, the JSON-mode API representation
  - `app.services.revisions.entity_id_of(entity) -> str`
  - `app.services.revisions.register(model_cls, entity_type: str, schema_cls)`: later tasks call this to register `Practice` and `TeamNote`
  - `app.routers.teams.get_team_or_404(session, team_id, *, lock=False) -> Team`
  - `tests.factories.revisions_for(session, entity_type: str, entity_id) -> list[Revision]`, ordered by id
  - Routes:
    - `GET /api/teams?include_archived=`
    - `POST /api/teams`
    - `GET /api/teams/{id}`
    - `PATCH /api/teams/{id}`
    - `POST /api/teams/{id}/archive`
    - `POST /api/teams/{id}/restore`

- [ ] **Step 1: Add the query helper to the factories**

Append to `backend/tests/factories.py`:
```python
from sqlalchemy import select  # noqa: E402

from app.models import Revision  # noqa: E402


def revisions_for(session: Session, entity_type: str, entity_id) -> list[Revision]:
    stmt = (
        select(Revision)
        .where(Revision.entity_type == entity_type, Revision.entity_id == str(entity_id))
        .order_by(Revision.id)
    )
    return list(session.scalars(stmt))
```

- [ ] **Step 2: Write the failing tests**

`backend/tests/api/__init__.py`: an empty file.

`backend/tests/api/test_teams.py`:
```python
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


def test_unknown_team_is_404(client):
    assert client.get("/api/teams/999999").status_code == 404
    assert client.patch("/api/teams/999999", json={"version": 1}).status_code == 404
    assert client.post("/api/teams/999999/archive").status_code == 404
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/api/test_teams.py -v`
Expected: FAIL, with `404 != 201` and similar, because the routes don't exist yet.

- [ ] **Step 4: Implement the shared dependencies and errors**

`backend/app/deps.py`:
```python
from typing import Annotated
from urllib.parse import unquote

from fastapi import Depends, Header
from sqlalchemy.orm import Session

from app.db import get_session

SessionDep = Annotated[Session, Depends(get_session)]


def edited_by(x_edited_by: Annotated[str | None, Header()] = None) -> str | None:
    """The browser sends encodeURIComponent(name), because headers must be Latin-1."""
    if x_edited_by is None:
        return None
    name = unquote(x_edited_by).strip()[:100]
    return name or None


EditedBy = Annotated[str | None, Depends(edited_by)]
```

`backend/app/errors.py`:
```python
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse


class ConflictError(Exception):
    def __init__(self, detail: str, current: dict[str, Any] | None = None) -> None:
        super().__init__(detail)
        self.detail = detail
        self.current = current


async def conflict_handler(_request: Request, exc: ConflictError) -> JSONResponse:
    return JSONResponse(status_code=409, content={"detail": exc.detail, "current": exc.current})


def ensure_version(actual: int, expected: int, current: dict[str, Any]) -> None:
    if actual != expected:
        raise ConflictError("This item was changed by someone else", current)
```

- [ ] **Step 5: Implement the schemas and the revision service**

`backend/app/schemas.py`:
```python
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints, field_validator

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Description = Annotated[str, StringConstraints(max_length=2000)]


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- Teams -------------------------------------------------------------------


class TeamOut(ORMModel):
    id: int
    name: str
    slug: str
    description: str | None
    version: int
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None


class TeamCreate(BaseModel):
    name: Name
    description: Description | None = None


class TeamUpdate(BaseModel):
    version: int
    name: Name | None = None
    description: Description | None = None

    @field_validator("name")
    @classmethod
    def _name_not_null(cls, value: str | None) -> str:
        if value is None:
            raise ValueError("name cannot be null")
        return value
```

`backend/app/services/revisions.py`:
```python
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.models import Revision, Team, TeamNote
from app.schemas import TeamOut

_REGISTRY: dict[type, tuple[str, type[BaseModel]]] = {}


def register(model_cls: type, entity_type: str, schema_cls: type[BaseModel]) -> None:
    _REGISTRY[model_cls] = (entity_type, schema_cls)


register(Team, "team", TeamOut)


def entity_id_of(entity: object) -> str:
    if isinstance(entity, TeamNote):
        return f"{entity.team_id}:{entity.practice_id}"
    return str(entity.id)  # type: ignore[attr-defined]


def serialize(entity: object) -> dict:
    _, schema = _REGISTRY[type(entity)]
    return schema.model_validate(entity).model_dump(mode="json")


def record_revision(
    session: Session, entity: object, action: str, edited_by: str | None
) -> Revision:
    entity_type, _ = _REGISTRY[type(entity)]
    revision = Revision(
        entity_type=entity_type,
        entity_id=entity_id_of(entity),
        action=action,
        snapshot=serialize(entity),
        edited_by=edited_by,
    )
    session.add(revision)
    return revision
```

- [ ] **Step 6: Implement the teams router and wire up the app**

`backend/app/routers/teams.py`:
```python
from fastapi import APIRouter, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.clock import utcnow
from app.deps import EditedBy, SessionDep
from app.errors import ConflictError, ensure_version
from app.models import Team
from app.schemas import TeamCreate, TeamOut, TeamUpdate
from app.services.revisions import record_revision, serialize
from app.services.slugs import slugify

router = APIRouter(prefix="/teams", tags=["teams"])


def get_team_or_404(session: Session, team_id: int, *, lock: bool = False) -> Team:
    team = session.get(Team, team_id, with_for_update=lock or None)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")
    return team


def _ensure_name_free(session: Session, name: str, exclude_id: int | None = None) -> None:
    stmt = select(Team).where(func.lower(Team.name) == name.lower())
    if exclude_id is not None:
        stmt = stmt.where(Team.id != exclude_id)
    if existing := session.scalars(stmt).first():
        raise ConflictError("A team with that name already exists", serialize(existing))


def _touch(team: Team) -> None:
    team.version += 1
    team.updated_at = utcnow()


@router.get("", response_model=list[TeamOut])
def list_teams(session: SessionDep, include_archived: bool = False) -> list[Team]:
    stmt = select(Team).order_by(func.lower(Team.name))
    if not include_archived:
        stmt = stmt.where(Team.archived_at.is_(None))
    return list(session.scalars(stmt))


@router.post("", response_model=TeamOut, status_code=201)
def create_team(data: TeamCreate, session: SessionDep, editor: EditedBy) -> Team:
    _ensure_name_free(session, data.name)
    team = Team(name=data.name, slug=slugify(data.name), description=data.description)
    session.add(team)
    session.flush()
    record_revision(session, team, "create", editor)
    session.commit()
    return team


@router.get("/{team_id}", response_model=TeamOut)
def get_team(team_id: int, session: SessionDep) -> Team:
    return get_team_or_404(session, team_id)


@router.patch("/{team_id}", response_model=TeamOut)
def update_team(team_id: int, data: TeamUpdate, session: SessionDep, editor: EditedBy) -> Team:
    team = get_team_or_404(session, team_id, lock=True)
    ensure_version(team.version, data.version, serialize(team))
    changes = data.model_dump(exclude_unset=True, exclude={"version"})
    if "name" in changes:
        _ensure_name_free(session, changes["name"], exclude_id=team.id)
        team.slug = slugify(changes["name"])
    for field, value in changes.items():
        setattr(team, field, value)
    _touch(team)
    session.flush()
    record_revision(session, team, "update", editor)
    session.commit()
    return team


def _set_archived(session: Session, team_id: int, archived: bool, editor: str | None) -> Team:
    team = get_team_or_404(session, team_id, lock=True)
    if (team.archived_at is not None) != archived:
        team.archived_at = utcnow() if archived else None
        _touch(team)
        session.flush()
        record_revision(session, team, "archive" if archived else "restore", editor)
    session.commit()
    return team


@router.post("/{team_id}/archive", response_model=TeamOut)
def archive_team(team_id: int, session: SessionDep, editor: EditedBy) -> Team:
    return _set_archived(session, team_id, True, editor)


@router.post("/{team_id}/restore", response_model=TeamOut)
def restore_team(team_id: int, session: SessionDep, editor: EditedBy) -> Team:
    return _set_archived(session, team_id, False, editor)
```

Replace `backend/app/main.py` with:
```python
from fastapi import FastAPI

from app.errors import ConflictError, conflict_handler
from app.routers import health, teams


def create_app() -> FastAPI:
    app = FastAPI(title="AI Radar")
    app.add_exception_handler(ConflictError, conflict_handler)
    for router in (health.router, teams.router):
        app.include_router(router, prefix="/api")
    return app


app = create_app()
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd backend && uv run pytest -v && uv run ruff check .`
Expected: all tests pass, including 13 in `tests/api/test_teams.py`, and ruff reports `All checks passed!`

- [ ] **Step 8: Commit**

```bash
git add backend/app backend/tests
git commit -m "feat(backend): add teams API with optimistic concurrency and revisions"
```

### Task 7: Practices API (catalog CRUD, filters, archive)

**Files:**
- Create: `backend/app/routers/practices.py`
- Modify: `backend/app/schemas.py` (append practice schemas), `backend/app/services/revisions.py` (register `Practice`), `backend/app/main.py` (include the router)
- Test: `backend/tests/api/test_practices.py`

**Interfaces:**
- Consumes: `SessionDep`, `EditedBy`, `ConflictError`, `ensure_version`, `record_revision`, `serialize`, `register`, `slugify`, `utcnow`, `ORMModel`, `Name`
- Produces:
  - `app.schemas.Category = Literal["tool", "skill", "practice", "workflow"]`
  - `app.schemas.Link(label: str, url: AnyHttpUrl)`
  - `app.schemas.Markdown`, a str with at most 100,000 characters
  - `app.schemas.PracticeOut`, `PracticeListItem`, `PracticeCreate`, `PracticeUpdate`
  - `app.routers.practices.get_practice_or_404(session, practice_id, *, lock=False) -> Practice`
  - `app.routers.practices.router`. Task 8 adds `/similar` to it and Task 11 changes `GET /{id}`.
  - Routes:
    - `GET /api/practices?q=&category=&tag=&include_archived=`
    - `POST /api/practices`
    - `GET /api/practices/{id}`
    - `PATCH /api/practices/{id}`
    - `POST /api/practices/{id}/archive`
    - `POST /api/practices/{id}/restore`

- [ ] **Step 1: Write the failing tests**

`backend/tests/api/test_practices.py`:
```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/api/test_practices.py -v`
Expected: FAIL. The practice routes return 404 because they aren't registered yet.

- [ ] **Step 3: Append the practice schemas to `backend/app/schemas.py`**

Update the imports at the top of `backend/app/schemas.py` to:
```python
from datetime import datetime
from typing import Annotated, Literal

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, StringConstraints, field_validator
```

Append:
```python
# --- Practices ---------------------------------------------------------------

Category = Literal["tool", "skill", "practice", "workflow"]
Tag = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
Summary = Annotated[str, StringConstraints(max_length=280)]
Markdown = Annotated[str, StringConstraints(max_length=100_000)]
Tags = Annotated[list[Tag], Field(max_length=20)]


class Link(BaseModel):
    label: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    url: AnyHttpUrl


Links = Annotated[list[Link], Field(max_length=20)]


def _unique(tags: list[str] | None) -> list[str] | None:
    return None if tags is None else list(dict.fromkeys(tags))


class PracticeOut(ORMModel):
    id: int
    name: str
    slug: str
    category: Category
    summary: str
    body_md: str
    tags: list[str]
    links: list[Link]
    version: int
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None


class PracticeListItem(ORMModel):
    id: int
    name: str
    slug: str
    category: Category
    summary: str
    tags: list[str]
    archived_at: datetime | None


class PracticeCreate(BaseModel):
    name: Name
    category: Category
    summary: Summary = ""
    body_md: Markdown = ""
    tags: Tags = []
    links: Links = []

    @field_validator("tags")
    @classmethod
    def _dedupe_tags(cls, tags: list[str]) -> list[str]:
        return _unique(tags)


class PracticeUpdate(BaseModel):
    version: int
    name: Name | None = None
    category: Category | None = None
    summary: Summary | None = None
    body_md: Markdown | None = None
    tags: Tags | None = None
    links: Links | None = None

    @field_validator("name", "category", "summary", "body_md", "tags", "links")
    @classmethod
    def _not_null(cls, value):
        if value is None:
            raise ValueError("field cannot be null")
        return value

    @field_validator("tags")
    @classmethod
    def _dedupe_tags(cls, tags: list[str]) -> list[str]:
        return _unique(tags)
```

- [ ] **Step 4: Register practices for revisions**

In `backend/app/services/revisions.py`, change the model and schema imports and the registration block to:
```python
from app.models import Practice, Revision, Team, TeamNote
from app.schemas import PracticeOut, TeamOut
```
```python
register(Team, "team", TeamOut)
register(Practice, "practice", PracticeOut)
```

- [ ] **Step 5: Implement the practices router**

`backend/app/routers/practices.py`:
```python
from fastapi import APIRouter, HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.clock import utcnow
from app.deps import EditedBy, SessionDep
from app.errors import ConflictError, ensure_version
from app.models import Practice
from app.schemas import (
    Category,
    PracticeCreate,
    PracticeListItem,
    PracticeOut,
    PracticeUpdate,
)
from app.services.revisions import record_revision, serialize
from app.services.slugs import slugify

router = APIRouter(prefix="/practices", tags=["practices"])


def get_practice_or_404(session: Session, practice_id: int, *, lock: bool = False) -> Practice:
    practice = session.get(Practice, practice_id, with_for_update=lock or None)
    if practice is None:
        raise HTTPException(status_code=404, detail="Practice not found")
    return practice


def ensure_practice_name_free(session: Session, name: str, exclude_id: int | None = None) -> None:
    stmt = select(Practice).where(func.lower(Practice.name) == name.lower())
    if exclude_id is not None:
        stmt = stmt.where(Practice.id != exclude_id)
    if existing := session.scalars(stmt).first():
        raise ConflictError("A practice with that name already exists", serialize(existing))


def _touch(practice: Practice) -> None:
    practice.version += 1
    practice.updated_at = utcnow()


@router.get("", response_model=list[PracticeListItem])
def list_practices(
    session: SessionDep,
    q: str | None = None,
    category: Category | None = None,
    tag: str | None = None,
    include_archived: bool = False,
) -> list[Practice]:
    stmt = select(Practice).order_by(func.lower(Practice.name))
    if not include_archived:
        stmt = stmt.where(Practice.archived_at.is_(None))
    if q:
        pattern = f"%{q.strip()}%"
        stmt = stmt.where(or_(Practice.name.ilike(pattern), Practice.summary.ilike(pattern)))
    if category:
        stmt = stmt.where(Practice.category == category)
    if tag:
        stmt = stmt.where(Practice.tags.any(tag))
    return list(session.scalars(stmt))


@router.post("", response_model=PracticeOut, status_code=201)
def create_practice(data: PracticeCreate, session: SessionDep, editor: EditedBy) -> Practice:
    ensure_practice_name_free(session, data.name)
    practice = Practice(**data.model_dump(mode="json"), slug=slugify(data.name))
    session.add(practice)
    session.flush()
    record_revision(session, practice, "create", editor)
    session.commit()
    return practice


@router.get("/{practice_id}", response_model=PracticeOut)
def get_practice(practice_id: int, session: SessionDep) -> Practice:
    return get_practice_or_404(session, practice_id)


@router.patch("/{practice_id}", response_model=PracticeOut)
def update_practice(
    practice_id: int, data: PracticeUpdate, session: SessionDep, editor: EditedBy
) -> Practice:
    practice = get_practice_or_404(session, practice_id, lock=True)
    ensure_version(practice.version, data.version, serialize(practice))
    changes = data.model_dump(mode="json", exclude_unset=True, exclude={"version"})
    if "name" in changes:
        ensure_practice_name_free(session, changes["name"], exclude_id=practice.id)
        practice.slug = slugify(changes["name"])
    for field, value in changes.items():
        setattr(practice, field, value)
    _touch(practice)
    session.flush()
    record_revision(session, practice, "update", editor)
    session.commit()
    return practice


def _set_archived(
    session: Session, practice_id: int, archived: bool, editor: str | None
) -> Practice:
    practice = get_practice_or_404(session, practice_id, lock=True)
    if (practice.archived_at is not None) != archived:
        practice.archived_at = utcnow() if archived else None
        _touch(practice)
        session.flush()
        record_revision(session, practice, "archive" if archived else "restore", editor)
    session.commit()
    return practice


@router.post("/{practice_id}/archive", response_model=PracticeOut)
def archive_practice(practice_id: int, session: SessionDep, editor: EditedBy) -> Practice:
    return _set_archived(session, practice_id, True, editor)


@router.post("/{practice_id}/restore", response_model=PracticeOut)
def restore_practice(practice_id: int, session: SessionDep, editor: EditedBy) -> Practice:
    return _set_archived(session, practice_id, False, editor)
```

In `backend/app/main.py`, change the router import and loop to:
```python
from app.routers import health, practices, teams
```
```python
    for router in (health.router, teams.router, practices.router):
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && uv run pytest -v && uv run ruff check .`
Expected: all tests pass, and ruff reports `All checks passed!`

- [ ] **Step 7: Commit**

```bash
git add backend/app backend/tests/api/test_practices.py
git commit -m "feat(backend): add practices catalog API"
```

### Task 8: Duplicate suggestions (`GET /api/practices/similar`)

**Files:**
- Create: `backend/app/services/similarity.py`
- Modify: `backend/app/routers/practices.py` (add the route **above** `get_practice`)
- Test: `backend/tests/api/test_similar.py`

**Interfaces:**
- Consumes: `Practice`, `PracticeListItem`, the practices `router`
- Produces:
  - `app.services.similarity.similar_practices(session, name: str, *, limit: int = 5, threshold: float = 0.3) -> list[Practice]`, including archived practices, ordered by similarity descending and then by id
  - Route: `GET /api/practices/similar?name=` (2–100 characters) returns `list[PracticeListItem]`

- [ ] **Step 1: Write the failing tests**

`backend/tests/api/test_similar.py`:
```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/api/test_similar.py -v`
Expected: FAIL with 422. `/similar` is currently matched by `/{practice_id}` and fails the int check.

- [ ] **Step 3: Implement**

`backend/app/services/similarity.py`:
```python
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Practice


def similar_practices(
    session: Session, name: str, *, limit: int = 5, threshold: float = 0.3
) -> list[Practice]:
    score = func.similarity(Practice.name, name)
    stmt = (
        select(Practice)
        .where(score >= threshold)
        .order_by(score.desc(), Practice.id)
        .limit(limit)
    )
    return list(session.scalars(stmt))
```

In `backend/app/routers/practices.py`, add these imports:
```python
from typing import Annotated

from fastapi import Query

from app.services.similarity import similar_practices
```

Insert this route directly **after** `list_practices` and **before** `create_practice`. It must be declared before `GET /{practice_id}`.
```python
@router.get("/similar", response_model=list[PracticeListItem])
def similar(
    session: SessionDep, name: Annotated[str, Query(min_length=2, max_length=100)]
) -> list[Practice]:
    return similar_practices(session, name.strip())
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && uv run pytest tests/api -v`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/similarity.py backend/app/routers/practices.py backend/tests/api/test_similar.py
git commit -m "feat(backend): add trigram duplicate suggestions for practices"
```

---

### Task 9: Placements API (append-only positions, backdating, removal)

**Files:**
- Create: `backend/app/services/positions.py`, `backend/app/routers/placements.py`
- Modify: `backend/app/schemas.py` (append), `backend/app/main.py` (include the router)
- Test: `backend/tests/api/test_placements.py`

**Interfaces:**
- Consumes: `get_team_or_404`, `get_practice_or_404`, `PlacementRow`, `latest_as_of`, `utcnow`
- Produces:
  - `app.services.positions.to_row(p: Placement) -> PlacementRow`
  - `app.services.positions.load_placement_rows(session, *, team_id: int | None = None, practice_id: int | None = None) -> list[PlacementRow]`
  - `app.services.positions.position_as_of(session, team_id: int, practice_id: int, at: datetime) -> PlacementRow | None`, which may return a removed row
  - `app.schemas.Score`: an int from 0 to 100
  - `app.schemas.PlacementCreate`, `PlacementOut`
  - Route: `POST /api/placements` returns 201 with a `PlacementOut`

- [ ] **Step 1: Write the failing tests**

`backend/tests/api/test_placements.py`:
```python
from datetime import datetime, timedelta

import pytest

from app.clock import utcnow
from tests.factories import make_placement, make_practice, make_team


@pytest.fixture
def team(session):
    return make_team(session)


@pytest.fixture
def practice(session):
    return make_practice(session)


def post(client, headers=None, **body):
    return client.post("/api/placements", json=body, headers=headers or {})


def test_place_defaults_to_now(client, team, practice):
    before = utcnow()
    response = post(client, team_id=team.id, practice_id=practice.id, adoption=70, value=80)
    assert response.status_code == 201
    body = response.json()
    assert (body["adoption"], body["value"], body["removed"]) == (70, 80, False)
    assert body["effective_at"] == body["recorded_at"]
    assert datetime.fromisoformat(body["recorded_at"]) >= before


def test_records_edited_by(client, team, practice):
    body = post(
        client, headers={"X-Edited-By": "Kim"},
        team_id=team.id, practice_id=practice.id, adoption=1, value=1,
    ).json()
    assert body["edited_by"] == "Kim"


def test_backdated_placement(client, team, practice):
    month_ago = utcnow() - timedelta(days=30)
    body = post(
        client, team_id=team.id, practice_id=practice.id, adoption=10, value=20,
        effective_at=month_ago.isoformat(),
    ).json()
    assert datetime.fromisoformat(body["effective_at"]) == month_ago
    assert datetime.fromisoformat(body["recorded_at"]) > month_ago


def test_future_effective_at_is_rejected(client, team, practice):
    tomorrow = (utcnow() + timedelta(days=1)).isoformat()
    response = post(
        client, team_id=team.id, practice_id=practice.id, adoption=1, value=1,
        effective_at=tomorrow,
    )
    assert response.status_code == 422


def test_naive_effective_at_is_rejected(client, team, practice):
    response = post(
        client, team_id=team.id, practice_id=practice.id, adoption=1, value=1,
        effective_at="2026-01-01T00:00:00",
    )
    assert response.status_code == 422


@pytest.mark.parametrize(
    "position", [{"adoption": 50}, {"value": 50}, {"adoption": 101, "value": 5}, {"adoption": -1, "value": 5}]
)
def test_position_is_required_and_bounded(client, team, practice, position):
    response = post(client, team_id=team.id, practice_id=practice.id, **position)
    assert response.status_code == 422


def test_remove_copies_current_position(client, session, team, practice):
    make_placement(session, team, practice, adoption=60, value=40, effective_at=utcnow() - timedelta(hours=1))
    body = post(client, team_id=team.id, practice_id=practice.id, removed=True).json()
    assert (body["adoption"], body["value"], body["removed"]) == (60, 40, True)


def test_backdated_remove_copies_position_as_of_that_date(client, session, team, practice):
    now = utcnow()
    make_placement(session, team, practice, adoption=20, value=20, effective_at=now - timedelta(days=10))
    make_placement(session, team, practice, adoption=80, value=80, effective_at=now - timedelta(days=1))
    body = post(
        client, team_id=team.id, practice_id=practice.id, removed=True,
        effective_at=(now - timedelta(days=5)).isoformat(),
    ).json()
    assert (body["adoption"], body["value"]) == (20, 20)


def test_remove_when_not_on_radar_is_rejected(client, session, team, practice):
    assert post(client, team_id=team.id, practice_id=practice.id, removed=True).status_code == 422
    make_placement(session, team, practice, removed=True, effective_at=utcnow() - timedelta(hours=1))
    assert post(client, team_id=team.id, practice_id=practice.id, removed=True).status_code == 422


def test_unknown_team_or_practice_is_404(client, team, practice):
    assert post(client, team_id=999999, practice_id=practice.id, adoption=1, value=1).status_code == 404
    assert post(client, team_id=team.id, practice_id=999999, adoption=1, value=1).status_code == 404


def test_archived_practice_is_rejected(client, session, team, practice):
    practice.archived_at = utcnow()
    session.flush()
    response = post(client, team_id=team.id, practice_id=practice.id, adoption=1, value=1)
    assert response.status_code == 422
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/api/test_placements.py -v`
Expected: FAIL with 404, because the route isn't registered.

- [ ] **Step 3: Implement the positions service**

`backend/app/services/positions.py`:
```python
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Placement
from app.services.frames import PlacementRow, latest_as_of


def to_row(p: Placement) -> PlacementRow:
    return PlacementRow(
        id=p.id,
        team_id=p.team_id,
        practice_id=p.practice_id,
        adoption=p.adoption,
        value=p.value,
        removed=p.removed,
        effective_at=p.effective_at,
        recorded_at=p.recorded_at,
    )


def load_placement_rows(
    session: Session, *, team_id: int | None = None, practice_id: int | None = None
) -> list[PlacementRow]:
    stmt = select(Placement)
    if team_id is not None:
        stmt = stmt.where(Placement.team_id == team_id)
    if practice_id is not None:
        stmt = stmt.where(Placement.practice_id == practice_id)
    return [to_row(p) for p in session.scalars(stmt)]


def position_as_of(
    session: Session, team_id: int, practice_id: int, at: datetime
) -> PlacementRow | None:
    rows = load_placement_rows(session, team_id=team_id, practice_id=practice_id)
    return latest_as_of(rows, at).get((team_id, practice_id))
```

- [ ] **Step 4: Append the placement schemas**

In `backend/app/schemas.py`, add `AwareDatetime` and `model_validator` to the pydantic import:
```python
from pydantic import (
    AnyHttpUrl,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)
```

Append:
```python
# --- Placements --------------------------------------------------------------

Score = Annotated[int, Field(ge=0, le=100)]


class PlacementCreate(BaseModel):
    team_id: int
    practice_id: int
    adoption: Score | None = None
    value: Score | None = None
    removed: bool = False
    effective_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def _position_required(self) -> "PlacementCreate":
        if not self.removed and (self.adoption is None or self.value is None):
            raise ValueError("adoption and value are required unless removed is true")
        return self


class PlacementOut(ORMModel):
    id: int
    team_id: int
    practice_id: int
    adoption: int
    value: int
    removed: bool
    effective_at: datetime
    recorded_at: datetime
    edited_by: str | None
```

- [ ] **Step 5: Implement the placements router**

`backend/app/routers/placements.py`:
```python
from fastapi import APIRouter, HTTPException

from app.clock import utcnow
from app.deps import EditedBy, SessionDep
from app.models import Placement
from app.routers.practices import get_practice_or_404
from app.routers.teams import get_team_or_404
from app.schemas import PlacementCreate, PlacementOut
from app.services.positions import position_as_of

router = APIRouter(prefix="/placements", tags=["placements"])


@router.post("", response_model=PlacementOut, status_code=201)
def create_placement(data: PlacementCreate, session: SessionDep, editor: EditedBy) -> Placement:
    team = get_team_or_404(session, data.team_id)
    practice = get_practice_or_404(session, data.practice_id)
    if team.archived_at is not None or practice.archived_at is not None:
        raise HTTPException(status_code=422, detail="Team or practice is archived")

    now = utcnow()
    effective_at = data.effective_at or now
    if effective_at > now:
        raise HTTPException(status_code=422, detail="effective_at cannot be in the future")

    adoption, value = data.adoption, data.value
    if data.removed:
        current = position_as_of(session, team.id, practice.id, effective_at)
        if current is None or current.removed:
            raise HTTPException(
                status_code=422, detail="Practice is not on the team's radar at that date"
            )
        adoption, value = current.adoption, current.value

    placement = Placement(
        team_id=team.id,
        practice_id=practice.id,
        adoption=adoption,
        value=value,
        removed=data.removed,
        effective_at=effective_at,
        recorded_at=now,
        edited_by=editor,
    )
    session.add(placement)
    session.commit()
    return placement
```

In `backend/app/main.py`, add `placements` to the router import and to the `for router in (...)` tuple.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && uv run pytest -v && uv run ruff check . && uv run ruff format --check .`
Expected: all tests pass and ruff is clean. If `format --check` fails, run `uv run ruff format .` and re-run.

- [ ] **Step 7: Commit**

```bash
git add backend/app backend/tests/api/test_placements.py
git commit -m "feat(backend): add append-only placements API with backdating and removal"
```

### Task 10: Team notes API

**Files:**
- Create: `backend/app/routers/notes.py`
- Modify: `backend/app/schemas.py` (append), `backend/app/services/revisions.py` (register `TeamNote`), `backend/app/main.py`
- Test: `backend/tests/api/test_notes.py`

**Interfaces:**
- Consumes: `get_team_or_404`, `get_practice_or_404`, `ConflictError`, `ensure_version`, `record_revision`, `serialize`, `register`, `Markdown`
- Produces:
  - `app.schemas.NoteOut(team_id, practice_id, body_md, version, updated_at, edited_by)`
  - `app.schemas.NotePut(version: int >= 0, body_md: Markdown)`
  - Routes:
    - `GET /api/teams/{team_id}/notes/{practice_id}` returns the note, or 404
    - `PUT /api/teams/{team_id}/notes/{practice_id}` returns 201 when it creates the note (`version: 0`) and 200 when it updates one
  - Note revisions use `entity_type="team_note"` and `entity_id="<team_id>:<practice_id>"`

- [ ] **Step 1: Write the failing tests**

`backend/tests/api/test_notes.py`:
```python
import pytest

from tests.factories import make_practice, make_team, revisions_for


@pytest.fixture
def ids(session):
    return make_team(session).id, make_practice(session).id


def url(team_id, practice_id):
    return f"/api/teams/{team_id}/notes/{practice_id}"


def test_missing_note_is_404(client, ids):
    assert client.get(url(*ids)).status_code == 404


def test_create_then_update_note(client, session, ids):
    created = client.put(
        url(*ids), json={"version": 0, "body_md": "We use it for refactors."},
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
    assert client.put(url(999999, practice_id), json={"version": 0, "body_md": ""}).status_code == 404
    assert client.put(url(team_id, 999999), json={"version": 0, "body_md": ""}).status_code == 404


def test_body_is_limited(client, ids):
    response = client.put(url(*ids), json={"version": 0, "body_md": "x" * 100_001})
    assert response.status_code == 422
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/api/test_notes.py -v`
Expected: FAIL. The note routes return 404 or 405 because they aren't registered yet.

- [ ] **Step 3: Implement**

Append to `backend/app/schemas.py`:
```python
# --- Team notes --------------------------------------------------------------


class NoteOut(ORMModel):
    team_id: int
    practice_id: int
    body_md: str
    version: int
    updated_at: datetime
    edited_by: str | None


class NotePut(BaseModel):
    version: int = Field(ge=0)
    body_md: Markdown
```

In `backend/app/services/revisions.py`, update the schema import and add the registration:
```python
from app.schemas import NoteOut, PracticeOut, TeamOut
```
```python
register(TeamNote, "team_note", NoteOut)
```

`backend/app/routers/notes.py`:
```python
from fastapi import APIRouter, HTTPException, Response

from app.clock import utcnow
from app.deps import EditedBy, SessionDep
from app.errors import ConflictError, ensure_version
from app.models import TeamNote
from app.routers.practices import get_practice_or_404
from app.routers.teams import get_team_or_404
from app.schemas import NoteOut, NotePut
from app.services.revisions import record_revision, serialize

router = APIRouter(prefix="/teams/{team_id}/notes", tags=["notes"])


@router.get("/{practice_id}", response_model=NoteOut)
def get_note(team_id: int, practice_id: int, session: SessionDep) -> TeamNote:
    note = session.get(TeamNote, (team_id, practice_id))
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return note


@router.put("/{practice_id}", response_model=NoteOut)
def put_note(
    team_id: int,
    practice_id: int,
    data: NotePut,
    session: SessionDep,
    editor: EditedBy,
    response: Response,
) -> TeamNote:
    get_team_or_404(session, team_id)
    get_practice_or_404(session, practice_id)
    note = session.get(TeamNote, (team_id, practice_id), with_for_update=True)

    if note is None:
        if data.version != 0:
            raise ConflictError("This note was changed by someone else", None)
        note = TeamNote(
            team_id=team_id, practice_id=practice_id, body_md=data.body_md, edited_by=editor
        )
        session.add(note)
        action = "create"
        response.status_code = 201
    else:
        ensure_version(note.version, data.version, serialize(note))
        note.body_md = data.body_md
        note.version += 1
        note.updated_at = utcnow()
        note.edited_by = editor
        action = "update"

    session.flush()
    record_revision(session, note, action, editor)
    session.commit()
    return note
```

In `backend/app/main.py`, add `notes` to the router import and the router tuple.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && uv run pytest -v`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app backend/tests/api/test_notes.py
git commit -m "feat(backend): add team notes API"
```

---

### Task 11: Revisions API (history and revert)

**Files:**
- Create: `backend/app/routers/revisions.py`
- Modify: `backend/app/schemas.py` (append), `backend/app/services/revisions.py` (add `EDITABLE_FIELDS`), `backend/app/routers/teams.py` (rename `_ensure_name_free` → `ensure_team_name_free`), `backend/app/main.py`
- Test: `backend/tests/api/test_revisions.py`

**Interfaces:**
- Consumes: `get_team_or_404`, `get_practice_or_404`, `ensure_practice_name_free`, `record_revision`, `serialize`, `slugify`
- Produces:
  - `app.routers.teams.ensure_team_name_free(session, name, exclude_id=None) -> None` (renamed)
  - `app.services.revisions.EDITABLE_FIELDS: dict[str, tuple[str, ...]]`
  - `app.schemas.EntityType = Literal["team", "practice", "team_note"]`
  - `app.schemas.RevisionOut(id, entity_type, entity_id, action, snapshot: dict, edited_by, created_at)`
  - `app.schemas.RevertOut(entity_type: EntityType, entity: dict)`
  - Routes:
    - `GET /api/revisions?entity_type=&entity_id=`, newest first
    - `POST /api/revisions/{id}/revert` returns a `RevertOut`

- [ ] **Step 1: Write the failing tests**

`backend/tests/api/test_revisions.py`:
```python
from tests.factories import make_practice, make_team


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
    team_id, practice_id = make_team(session).id, make_practice(session).id
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/api/test_revisions.py -v`
Expected: FAIL. `/api/revisions` returns 404 because it isn't registered.

- [ ] **Step 3: Rename the team name check**

In `backend/app/routers/teams.py`, rename `_ensure_name_free` to `ensure_team_name_free`. There are three occurrences: the definition and the calls in `create_team` and `update_team`.

Run: `cd backend && uv run pytest tests/api/test_teams.py -q`
Expected: all team tests still pass.

- [ ] **Step 4: Implement**

Append to `backend/app/schemas.py`:
```python
# --- Revisions ---------------------------------------------------------------

EntityType = Literal["team", "practice", "team_note"]


class RevisionOut(ORMModel):
    id: int
    entity_type: EntityType
    entity_id: str
    action: str
    snapshot: dict
    edited_by: str | None
    created_at: datetime


class RevertOut(BaseModel):
    entity_type: EntityType
    entity: dict
```

Append to `backend/app/services/revisions.py`:
```python
EDITABLE_FIELDS: dict[str, tuple[str, ...]] = {
    "team": ("name", "description"),
    "practice": ("name", "category", "summary", "body_md", "tags", "links"),
    "team_note": ("body_md",),
}
```

`backend/app/routers/revisions.py`:
```python
from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.clock import utcnow
from app.deps import EditedBy, SessionDep
from app.models import Practice, Revision, Team, TeamNote
from app.routers.practices import ensure_practice_name_free, get_practice_or_404
from app.routers.teams import ensure_team_name_free, get_team_or_404
from app.schemas import EntityType, RevertOut, RevisionOut
from app.services.revisions import EDITABLE_FIELDS, record_revision, serialize
from app.services.slugs import slugify

router = APIRouter(prefix="/revisions", tags=["revisions"])


@router.get("", response_model=list[RevisionOut])
def list_revisions(session: SessionDep, entity_type: EntityType, entity_id: str) -> list[Revision]:
    stmt = (
        select(Revision)
        .where(Revision.entity_type == entity_type, Revision.entity_id == entity_id)
        .order_by(Revision.created_at.desc(), Revision.id.desc())
    )
    return list(session.scalars(stmt))


def _load_entity(session: Session, revision: Revision) -> Team | Practice | TeamNote:
    if revision.entity_type == "team":
        return get_team_or_404(session, int(revision.entity_id), lock=True)
    if revision.entity_type == "practice":
        return get_practice_or_404(session, int(revision.entity_id), lock=True)
    team_id, practice_id = (int(part) for part in revision.entity_id.split(":"))
    note = session.get(TeamNote, (team_id, practice_id), with_for_update=True)
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return note


@router.post("/{revision_id}/revert", response_model=RevertOut)
def revert(revision_id: int, session: SessionDep, editor: EditedBy) -> RevertOut:
    revision = session.get(Revision, revision_id)
    if revision is None:
        raise HTTPException(status_code=404, detail="Revision not found")
    entity = _load_entity(session, revision)
    snapshot = revision.snapshot

    if isinstance(entity, Team):
        ensure_team_name_free(session, snapshot["name"], exclude_id=entity.id)
    elif isinstance(entity, Practice):
        ensure_practice_name_free(session, snapshot["name"], exclude_id=entity.id)
    if isinstance(entity, (Team, Practice)):
        entity.slug = slugify(snapshot["name"])
    if isinstance(entity, TeamNote):
        entity.edited_by = editor

    for field in EDITABLE_FIELDS[revision.entity_type]:
        setattr(entity, field, snapshot[field])
    entity.version += 1
    entity.updated_at = utcnow()
    session.flush()
    record_revision(session, entity, "revert", editor)
    session.commit()
    return RevertOut(entity_type=revision.entity_type, entity=serialize(entity))
```

In `backend/app/main.py`, add `revisions` to the router import and the router tuple.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && uv run pytest -v && uv run ruff check .`
Expected: all tests pass, and ruff reports `All checks passed!`

- [ ] **Step 6: Commit**

```bash
git add backend/app backend/tests/api/test_revisions.py
git commit -m "feat(backend): add revision history and revert"
```

### Task 12: Practice usage (team counts in lists, teams on the detail page)

**Files:**
- Modify: `backend/app/services/positions.py` (add `load_team_rows`, `current_usage`), `backend/app/schemas.py` (add `teams_count`, `PracticeTeamUsage`, `PracticeDetail`), `backend/app/routers/practices.py` (list, similar, detail)
- Test: `backend/tests/api/test_practice_usage.py`

**Interfaces:**
- Consumes: `load_placement_rows`, `latest_as_of`, `TeamRow`, `corner_label`
- Produces:
  - `app.services.positions.load_team_rows(session) -> list[TeamRow]`, covering every team including archived ones
  - `app.services.positions.current_usage(session, *, practice_id: int | None = None) -> dict[int, list[PlacementRow]]`: maps `practice_id` to the on-radar rows as of now, for non-archived teams only
  - `PracticeListItem.teams_count: int`, filled in by `GET /api/practices` and `GET /api/practices/similar`
  - `app.schemas.PracticeTeamUsage(team_id, team_name, team_slug, label, note_md: str | None)`
  - `app.schemas.PracticeDetail(PracticeOut)` with an extra `teams: list[PracticeTeamUsage]`, sorted by team name case-insensitively
  - `GET /api/practices/{id}` now returns a `PracticeDetail`. `PATCH`, archive and restore still return a `PracticeOut`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/api/test_practice_usage.py`:
```python
from datetime import timedelta

from app.clock import utcnow
from app.models import TeamNote
from tests.factories import make_placement, make_practice, make_team


def ago(hours):
    return utcnow() - timedelta(hours=hours)


def test_list_counts_teams_currently_using_each_practice(client, session):
    platform, payments = make_team(session, "Platform"), make_team(session, "Payments")
    archived = make_team(session, "Old", archived_at=utcnow())
    x, y, z = (make_practice(session, n) for n in ("X tool", "Y tool", "Z tool"))
    make_placement(session, platform, x, effective_at=ago(3))
    make_placement(session, payments, x, effective_at=ago(3))
    make_placement(session, archived, x, effective_at=ago(3))
    make_placement(session, platform, y, effective_at=ago(3))
    make_placement(session, platform, y, removed=True, effective_at=ago(1))
    make_placement(session, platform, z, effective_at=utcnow() + timedelta(days=1))

    counts = {p["name"]: p["teams_count"] for p in client.get("/api/practices").json()}
    assert counts == {"X tool": 2, "Y tool": 0, "Z tool": 0}


def test_similar_includes_team_counts(client, session):
    team = make_team(session)
    practice = make_practice(session, "GitHub Copilot")
    make_placement(session, team, practice, effective_at=ago(1))
    [match] = client.get("/api/practices/similar", params={"name": "copilot"}).json()
    assert match["teams_count"] == 1


def test_detail_lists_teams_with_labels_and_notes(client, session):
    payments, platform = make_team(session, "payments"), make_team(session, "Platform")
    mobile = make_team(session, "Mobile")
    practice = make_practice(session)
    make_placement(session, platform, practice, adoption=80, value=90, effective_at=ago(2))
    make_placement(session, payments, practice, adoption=20, value=70, effective_at=ago(2))
    make_placement(session, mobile, practice, effective_at=ago(2))
    make_placement(session, mobile, practice, removed=True, effective_at=ago(1))
    session.add(TeamNote(team_id=platform.id, practice_id=practice.id, body_md="Refactors."))
    session.flush()

    body = client.get(f"/api/practices/{practice.id}").json()
    assert body["name"] == "Claude Code"
    assert body["teams"] == [
        {
            "team_id": payments.id,
            "team_name": "payments",
            "team_slug": "payments",
            "label": "Hidden gem",
            "note_md": None,
        },
        {
            "team_id": platform.id,
            "team_name": "Platform",
            "team_slug": "platform",
            "label": "Core",
            "note_md": "Refactors.",
        },
    ]


def test_patch_still_returns_plain_practice(client, session):
    practice = make_practice(session)
    body = client.patch(f"/api/practices/{practice.id}", json={"version": 1, "summary": "x"}).json()
    assert "teams" not in body
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/api/test_practice_usage.py -v`
Expected: FAIL with `KeyError: 'teams_count'` and a missing `teams` key.

- [ ] **Step 3: Extend the positions service**

In `backend/app/services/positions.py`, update the imports and append:
```python
from app.clock import utcnow
from app.models import Placement, Team
from app.services.frames import PlacementRow, TeamRow, latest_as_of
```
```python
def load_team_rows(session: Session) -> list[TeamRow]:
    return [TeamRow(id=t.id, archived_at=t.archived_at) for t in session.scalars(select(Team))]


def current_usage(
    session: Session, *, practice_id: int | None = None
) -> dict[int, list[PlacementRow]]:
    """practice_id -> on-radar placement rows as of now, for non-archived teams."""
    active = set(session.scalars(select(Team.id).where(Team.archived_at.is_(None))))
    rows = load_placement_rows(session, practice_id=practice_id)
    usage: dict[int, list[PlacementRow]] = {}
    for row in latest_as_of(rows, utcnow()).values():
        if not row.removed and row.team_id in active:
            usage.setdefault(row.practice_id, []).append(row)
    return usage
```

- [ ] **Step 4: Extend the schemas**

In `backend/app/schemas.py`, add a field to `PracticeListItem` (as its last field):
```python
    teams_count: int = 0
```

Append after the practice schemas:
```python
class PracticeTeamUsage(BaseModel):
    team_id: int
    team_name: str
    team_slug: str
    label: str
    note_md: str | None


class PracticeDetail(PracticeOut):
    teams: list[PracticeTeamUsage]
```

- [ ] **Step 5: Update the practices router**

In `backend/app/routers/practices.py`, extend the imports:
```python
from app.models import Practice, Team, TeamNote
from app.schemas import (
    Category,
    PracticeCreate,
    PracticeDetail,
    PracticeListItem,
    PracticeOut,
    PracticeTeamUsage,
    PracticeUpdate,
)
from app.services.labels import corner_label
from app.services.positions import current_usage
```

Add this helper below `_touch`:
```python
def _with_counts(session: Session, practices: list[Practice]) -> list[PracticeListItem]:
    usage = current_usage(session)
    return [
        PracticeListItem.model_validate(p).model_copy(
            update={"teams_count": len(usage.get(p.id, []))}
        )
        for p in practices
    ]
```

Change the last line of `list_practices` and its return annotation:
```python
) -> list[PracticeListItem]:
    ...
    return _with_counts(session, list(session.scalars(stmt)))
```

Change `similar` the same way:
```python
) -> list[PracticeListItem]:
    return _with_counts(session, similar_practices(session, name.strip()))
```

Replace `get_practice`:
```python
@router.get("/{practice_id}", response_model=PracticeDetail)
def get_practice(practice_id: int, session: SessionDep) -> PracticeDetail:
    practice = get_practice_or_404(session, practice_id)
    rows = current_usage(session, practice_id=practice.id).get(practice.id, [])
    teams = {
        t.id: t
        for t in session.scalars(select(Team).where(Team.id.in_([r.team_id for r in rows])))
    }
    notes = {
        n.team_id: n.body_md
        for n in session.scalars(select(TeamNote).where(TeamNote.practice_id == practice.id))
    }
    usage = [
        PracticeTeamUsage(
            team_id=r.team_id,
            team_name=teams[r.team_id].name,
            team_slug=teams[r.team_id].slug,
            label=corner_label(r.adoption, r.value),
            note_md=notes.get(r.team_id),
        )
        for r in rows
    ]
    usage.sort(key=lambda u: u.team_name.lower())
    return PracticeDetail(**PracticeOut.model_validate(practice).model_dump(), teams=usage)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && uv run pytest -v`
Expected: all tests pass. The earlier practice tests are unaffected, because they only read fields that still exist.

- [ ] **Step 7: Commit**

```bash
git add backend/app backend/tests/api/test_practice_usage.py
git commit -m "feat(backend): add team usage counts and per-team labels to practices"
```

---

### Task 13: Radar frames endpoint (`GET /api/radar/frames`)

**Files:**
- Create: `backend/app/routers/radar.py`
- Modify: `backend/app/schemas.py` (append), `backend/app/main.py`
- Test: `backend/tests/api/test_radar.py`

**Interfaces:**
- Consumes: `build_frames`, `period_ends`, `Step`, `load_placement_rows`, `load_team_rows`, `get_team_or_404`, `Category`
- Produces:
  - `app.schemas.TeamPositionOut`, `PointOut`, `FrameOut`, `PracticeRef(name, category)`, `FramesOut(scope, step, frames, practices: dict[str, PracticeRef])`
  - Route: `GET /api/radar/frames?scope=org|team:{id}&from=&to=&step=week|month`
    - Defaults: `scope=org`, `step=month`, `from` = the earliest `effective_at` in scope, `to` = now. `to` is clamped to now.
    - **Team scope only:** when `from` isn't given, the range starts no later than 365 days before now. That gives a brand-new team past months to scrub back to and backdate into.
    - `team_positions` appears only in the org scope (`response_model_exclude_none=True`).
    - `practices` holds only the non-archived practices that appear in at least one frame, keyed by id as a string.
    - Errors: a bad scope, a bad step, or `from > to` returns 422. An unknown team returns 404.

- [ ] **Step 1: Write the failing tests**

`backend/tests/api/test_radar.py`:
```python
from datetime import UTC, datetime

import pytest

from app.clock import utcnow
from tests.factories import make_placement, make_practice, make_team


def d(y, m, day):
    return datetime(y, m, day, 12, tzinfo=UTC)


def frames(client, **params):
    return client.get("/api/radar/frames", params=params)


def test_team_scope_frames(client, session):
    team = make_team(session)
    x, y = make_practice(session, "X tool"), make_practice(session, "Y tool")
    make_placement(session, team, x, adoption=70, value=80, effective_at=d(2025, 1, 15))
    make_placement(session, team, x, adoption=75, value=85, effective_at=d(2025, 2, 10))
    make_placement(session, team, y, adoption=10, value=90, effective_at=d(2025, 2, 20))
    make_placement(session, team, y, removed=True, effective_at=d(2025, 3, 5))

    response = frames(
        client, scope=f"team:{team.id}", **{"from": "2025-01-01T00:00:00Z"}, to="2025-03-15T00:00:00Z"
    )
    assert response.status_code == 200
    body = response.json()
    assert body["scope"] == f"team:{team.id}"
    assert body["step"] == "month"
    assert [datetime.fromisoformat(f["date"]) for f in body["frames"]] == [
        datetime(2025, 1, 31, 23, 59, 59, tzinfo=UTC),
        datetime(2025, 2, 28, 23, 59, 59, tzinfo=UTC),
        datetime(2025, 3, 31, 23, 59, 59, tzinfo=UTC),
    ]
    jan, feb, mar = (f["points"] for f in body["frames"])
    assert jan == [{"practice_id": x.id, "adoption": 70, "value": 80, "teams": 1}]
    assert [p["practice_id"] for p in feb] == [x.id, y.id]
    assert mar == [{"practice_id": x.id, "adoption": 75, "value": 85, "teams": 1}]
    assert body["practices"] == {
        str(x.id): {"name": "X tool", "category": "tool"},
        str(y.id): {"name": "Y tool", "category": "tool"},
    }


def test_org_scope_aggregates_with_team_positions(client, session):
    a, b = make_team(session, "A"), make_team(session, "B")
    x = make_practice(session)
    make_placement(session, a, x, adoption=80, value=90, effective_at=d(2025, 1, 10))
    make_placement(session, b, x, adoption=40, value=70, effective_at=d(2025, 1, 10))
    body = frames(client, **{"from": "2025-01-01T00:00:00Z"}, to="2025-01-20T00:00:00Z").json()
    [frame] = body["frames"]
    assert frame["points"] == [
        {
            "practice_id": x.id,
            "adoption": 60,
            "value": 80,
            "teams": 2,
            "team_positions": [
                {"team_id": a.id, "adoption": 80, "value": 90},
                {"team_id": b.id, "adoption": 40, "value": 70},
            ],
        }
    ]


def test_org_default_range_runs_from_earliest_placement_to_now(client, session):
    team = make_team(session)
    make_placement(session, team, make_practice(session), effective_at=d(2025, 11, 10))
    before = utcnow()
    body = frames(client).json()
    dates = [datetime.fromisoformat(f["date"]) for f in body["frames"]]
    assert dates[0] == datetime(2025, 11, 30, 23, 59, 59, tzinfo=UTC)
    assert before <= dates[-1] <= utcnow()


def test_team_default_range_covers_at_least_the_last_year(client, session):
    team = make_team(session)
    make_placement(session, team, make_practice(session))  # placed just now
    body = frames(client, scope=f"team:{team.id}").json()
    assert len(body["frames"]) >= 12
    assert body["frames"][0]["points"] == []
    assert len(body["frames"][-1]["points"]) == 1


def test_weekly_step(client, session):
    team = make_team(session)
    make_placement(session, team, make_practice(session), effective_at=d(2025, 1, 6))
    body = frames(
        client, scope=f"team:{team.id}", step="week",
        **{"from": "2025-01-06T00:00:00Z"}, to="2025-01-19T00:00:00Z",
    ).json()
    assert len(body["frames"]) == 2


def test_archived_practices_are_excluded(client, session):
    team = make_team(session)
    x = make_practice(session, archived_at=utcnow())
    make_placement(session, team, x, effective_at=d(2025, 1, 10))
    body = frames(client, **{"from": "2025-01-01T00:00:00Z"}, to="2025-01-20T00:00:00Z").json()
    assert body["frames"][0]["points"] == []
    assert body["practices"] == {}


def test_empty_radar_has_single_empty_frame(client):
    body = frames(client).json()
    assert len(body["frames"]) == 1
    assert body["frames"][0]["points"] == []


@pytest.mark.parametrize(
    "params",
    [
        {"scope": "everyone"},
        {"scope": "team:abc"},
        {"step": "day"},
        {"from": "2025-03-01T00:00:00Z", "to": "2025-01-01T00:00:00Z"},
    ],
)
def test_invalid_params_are_422(client, params):
    assert frames(client, **params).status_code == 422


def test_unknown_team_is_404(client):
    assert frames(client, scope="team:999999").status_code == 404
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/api/test_radar.py -v`
Expected: FAIL with 404, because the route isn't registered.

- [ ] **Step 3: Append the frame schemas**

Append to `backend/app/schemas.py`:
```python
# --- Radar frames ------------------------------------------------------------


class TeamPositionOut(ORMModel):
    team_id: int
    adoption: int
    value: int


class PointOut(ORMModel):
    practice_id: int
    adoption: int
    value: int
    teams: int
    team_positions: list[TeamPositionOut] | None = None


class FrameOut(ORMModel):
    date: datetime
    points: list[PointOut]


class PracticeRef(BaseModel):
    name: str
    category: Category


class FramesOut(BaseModel):
    scope: str
    step: Literal["week", "month"]
    frames: list[FrameOut]
    practices: dict[str, PracticeRef]
```

- [ ] **Step 4: Implement the radar router**

`backend/app/routers/radar.py`:
```python
import re
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from pydantic import AwareDatetime
from sqlalchemy import select

from app.clock import utcnow
from app.deps import SessionDep
from app.models import Practice
from app.routers.teams import get_team_or_404
from app.schemas import FrameOut, FramesOut, PracticeRef
from app.services.frames import Step, build_frames, period_ends
from app.services.positions import load_placement_rows, load_team_rows

router = APIRouter(prefix="/radar", tags=["radar"])

_SCOPE = re.compile(r"^(?:org|team:(\d+))$")


@router.get("/frames", response_model=FramesOut, response_model_exclude_none=True)
def get_frames(
    session: SessionDep,
    scope: str = "org",
    step: Step = "month",
    from_: Annotated[AwareDatetime | None, Query(alias="from")] = None,
    to: AwareDatetime | None = None,
) -> FramesOut:
    match = _SCOPE.match(scope)
    if match is None:
        raise HTTPException(status_code=422, detail="scope must be 'org' or 'team:<id>'")
    team_id = int(match.group(1)) if match.group(1) else None
    if team_id is not None:
        get_team_or_404(session, team_id)

    now = utcnow()
    placements = load_placement_rows(session, team_id=team_id)
    end = min(to or now, now)
    start = from_ or min((p.effective_at for p in placements), default=end)
    if from_ is None and team_id is not None:
        start = min(start, end - timedelta(days=365))  # room to backdate (spec §3)
    if start > end:
        raise HTTPException(status_code=422, detail="'from' must not be after 'to'")

    practices = {
        p.id: p for p in session.scalars(select(Practice).where(Practice.archived_at.is_(None)))
    }
    result = build_frames(
        scope_team_id=team_id,
        teams=load_team_rows(session),
        placements=placements,
        practice_ids=set(practices),
        dates=period_ends(start, end, step, now),
    )
    used = sorted({point.practice_id for frame in result for point in frame.points})
    return FramesOut(
        scope=scope,
        step=step,
        frames=[FrameOut.model_validate(frame) for frame in result],
        practices={
            str(pid): PracticeRef(name=practices[pid].name, category=practices[pid].category)
            for pid in used
        },
    )
```

In `backend/app/main.py`, add `radar` to the router import and the router tuple.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && uv run pytest -v && uv run ruff check .`
Expected: all tests pass, and ruff reports `All checks passed!`

- [ ] **Step 6: Commit**

```bash
git add backend/app backend/tests/api/test_radar.py
git commit -m "feat(backend): add radar frames endpoint for team and org scopes"
```

### Task 14: Write rate limiting and body-size limit

**Files:**
- Create: `backend/app/middleware.py`
- Modify: `backend/app/main.py` (`create_app` gets keyword options)
- Test: `backend/tests/test_middleware.py`

**Interfaces:**
- Consumes: `settings.write_rate_limit`, `settings.max_body_bytes`
- Produces:
  - `app.middleware.client_ip(scope) -> str`: the first hop of `X-Forwarded-For` with any IPv4 port removed, falling back to the ASGI client address
  - `WriteRateLimitMiddleware(app, limit: str)`: POST, PUT, PATCH and DELETE under `/api/` return **429** `{"detail": ...}` with `Retry-After: 60` once the limit is exceeded
  - `BodySizeLimitMiddleware(app, max_bytes: int)`: returns **413** when `Content-Length` exceeds the limit
  - `app.main.create_app(*, rate_limit: str | None = settings.write_rate_limit, max_body_bytes: int = settings.max_body_bytes) -> FastAPI`. Passing `rate_limit=None` disables the limiter.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_middleware.py`:
```python
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
    assert client.post("/api/teams", json={"name": "T9"}, headers=headers).headers["Retry-After"] == "60"
    other = client.post("/api/teams", json={"name": "Other"}, headers={"X-Forwarded-For": "198.51.100.2"})
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


def test_client_ip_parsing():
    assert client_ip({"headers": [(b"x-forwarded-for", b"203.0.113.7:51000, 10.0.0.1")]}) == "203.0.113.7"
    assert client_ip({"headers": [(b"x-forwarded-for", b"2001:db8::1")]}) == "2001:db8::1"
    assert client_ip({"headers": [], "client": ("127.0.0.1", 5000)}) == "127.0.0.1"
    assert client_ip({"headers": []}) == "unknown"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_middleware.py -v`
Expected: ERROR, `ModuleNotFoundError: No module named 'app.middleware'`.

- [ ] **Step 3: Implement the middleware**

`backend/app/middleware.py`:
```python
from limits import parse
from limits.storage import MemoryStorage
from limits.strategies import MovingWindowRateLimiter
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def client_ip(scope: Scope) -> str:
    headers = dict(scope.get("headers") or [])
    forwarded = headers.get(b"x-forwarded-for")
    if forwarded:
        first = forwarded.decode("latin-1").split(",")[0].strip()
        if first.count(":") == 1:  # IPv4 with port, as Azure App Service sends it
            first = first.split(":")[0]
        return first
    client = scope.get("client")
    return client[0] if client else "unknown"


class WriteRateLimitMiddleware:
    """In-memory, per-worker limit. Approximate by design (spec §7)."""

    def __init__(self, app: ASGIApp, limit: str) -> None:
        self.app = app
        self.limit = parse(limit)
        self.limiter = MovingWindowRateLimiter(MemoryStorage())

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] == "http"
            and scope["method"] in WRITE_METHODS
            and scope["path"].startswith("/api/")
            and not self.limiter.hit(self.limit, client_ip(scope))
        ):
            response = JSONResponse(
                {"detail": "Too many changes. Please wait a minute."},
                status_code=429,
                headers={"Retry-After": "60"},
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


class BodySizeLimitMiddleware:
    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            length = dict(scope["headers"]).get(b"content-length", b"0")
            if length.isdigit() and int(length) > self.max_bytes:
                response = JSONResponse({"detail": "Request body too large"}, status_code=413)
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)
```

Replace `create_app` in `backend/app/main.py`, keeping the existing router imports, so that it becomes:
```python
from fastapi import FastAPI

from app.config import settings
from app.errors import ConflictError, conflict_handler
from app.middleware import BodySizeLimitMiddleware, WriteRateLimitMiddleware
from app.routers import health, notes, placements, practices, radar, revisions, teams


def create_app(
    *,
    rate_limit: str | None = settings.write_rate_limit,
    max_body_bytes: int = settings.max_body_bytes,
) -> FastAPI:
    app = FastAPI(title="AI Radar")
    app.add_exception_handler(ConflictError, conflict_handler)
    for router in (
        health.router,
        teams.router,
        practices.router,
        notes.router,
        placements.router,
        revisions.router,
        radar.router,
    ):
        app.include_router(router, prefix="/api")
    if rate_limit:
        app.add_middleware(WriteRateLimitMiddleware, limit=rate_limit)
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=max_body_bytes)
    return app


app = create_app()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && uv run pytest -v`
Expected: all tests pass. The default `client` fixture keeps the 60/minute limit, and no single test makes 60 writes.

- [ ] **Step 5: Commit**

```bash
git add backend/app/middleware.py backend/app/main.py backend/tests/test_middleware.py
git commit -m "feat(backend): add per-IP write rate limiting and body size limit"
```

---

### Task 15: Serve the SPA and export OpenAPI for the frontend

**Files:**
- Create: `backend/app/spa.py`, `backend/scripts/__init__.py` (empty), `backend/scripts/export_openapi.py`
- Modify: `backend/app/main.py` (add a `static_dir` option and call `mount_spa` last)
- Test: `backend/tests/test_spa.py`, `backend/tests/test_openapi.py`

**Interfaces:**
- Produces:
  - `app.spa.mount_spa(app: FastAPI, static_dir: Path) -> None`. It is a no-op when `static_dir/index.html` is missing. Otherwise it adds a hidden catch-all `GET /{full_path:path}` that serves files inside `static_dir` and falls back to `index.html`, while `api/*` paths still return 404.
  - `create_app(..., static_dir: Path = app/static)`
  - `uv run python -m scripts.export_openapi` prints the OpenAPI JSON. Plan 2 writes it to `frontend/openapi.json`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_spa.py`:
```python
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
    assert client.get("/radar/team/3-platform").text == "<div id=root></div>"


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
```

`backend/tests/test_openapi.py`:
```python
from app.main import create_app

EXPECTED_PATHS = {
    "/api/health",
    "/api/teams",
    "/api/teams/{team_id}",
    "/api/teams/{team_id}/archive",
    "/api/teams/{team_id}/restore",
    "/api/teams/{team_id}/notes/{practice_id}",
    "/api/practices",
    "/api/practices/similar",
    "/api/practices/{practice_id}",
    "/api/practices/{practice_id}/archive",
    "/api/practices/{practice_id}/restore",
    "/api/placements",
    "/api/revisions",
    "/api/revisions/{revision_id}/revert",
    "/api/radar/frames",
}


def test_openapi_lists_every_route():
    assert EXPECTED_PATHS <= set(create_app().openapi()["paths"])


def test_spa_catch_all_is_hidden_from_openapi(tmp_path):
    (tmp_path / "index.html").write_text("x")
    paths = create_app(static_dir=tmp_path).openapi()["paths"]
    assert not any("full_path" in p for p in paths)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_spa.py tests/test_openapi.py -v`
Expected: FAIL, `TypeError: create_app() got an unexpected keyword argument 'static_dir'`.

- [ ] **Step 3: Implement**

`backend/app/spa.py`:
```python
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse


def mount_spa(app: FastAPI, static_dir: Path) -> None:
    index = static_dir / "index.html"
    if not index.is_file():
        return
    root = static_dir.resolve()

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str) -> FileResponse:
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        candidate = (root / full_path).resolve()
        if full_path and candidate.is_file() and candidate.is_relative_to(root):
            return FileResponse(candidate)
        return FileResponse(index)
```

In `backend/app/main.py`:
- Add the imports `from pathlib import Path` and `from app.spa import mount_spa`.
- Add the constant `DEFAULT_STATIC_DIR = Path(__file__).resolve().parent / "static"`.
- Add `static_dir: Path = DEFAULT_STATIC_DIR` as the last keyword parameter of `create_app`.
- Call `mount_spa(app, static_dir)` right before `return app`. It must come after all `include_router` calls.

`backend/scripts/export_openapi.py`:
```python
"""Print the OpenAPI schema.

Usage (from backend/): uv run python -m scripts.export_openapi > ../frontend/openapi.json
"""

import json
import sys

from app.main import create_app


def main() -> None:
    json.dump(create_app().openapi(), sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && uv run pytest -v && uv run ruff check .`
Expected: all tests pass, and ruff reports `All checks passed!`

Run: `cd backend && uv run python -m scripts.export_openapi | head -5`
Expected: the start of a JSON document containing `"components"`.

- [ ] **Step 5: Commit**

```bash
git add backend/app backend/scripts backend/tests/test_spa.py backend/tests/test_openapi.py
git commit -m "feat(backend): serve built SPA with index fallback and add OpenAPI export"
```

---

## Plan 1 completion check

- [ ] `docker compose up -d db && cd backend && uv run pytest -q` passes in full.
- [ ] `uv run ruff check . && uv run ruff format --check .` is clean. Run `uv run ruff format .` first if needed, then commit with `style: ruff format`.
- [ ] Smoke test against the dev database. Run `uv run alembic upgrade head && uv run fastapi dev app/main.py`, then in another shell:
  - `curl -s localhost:8000/api/health` → `{"status":"ok"}`
  - `curl -s -XPOST localhost:8000/api/teams -H 'content-type: application/json' -d '{"name":"Platform"}'` → 201 JSON
  - `curl -s 'localhost:8000/api/radar/frames?scope=org'` → a JSON object with `frames`
- [ ] Continue with **Plan 2** (`docs/superpowers/plans/2026-09-13-ai-radar-2-frontend.md`).
