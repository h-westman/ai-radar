from pathlib import Path

from fastapi import Depends, FastAPI
from sqlalchemy.exc import IntegrityError

from app.config import settings
from app.deps import stash_session
from app.errors import ConflictError, conflict_handler, integrity_error_handler
from app.middleware import BodySizeLimitMiddleware, WriteRateLimitMiddleware
from app.routers import health, notes, placements, practices, radar, revisions, teams
from app.spa import mount_spa

DEFAULT_STATIC_DIR = Path(__file__).resolve().parent / "static"


def create_app(
    *,
    rate_limit: str | None = settings.write_rate_limit,
    max_body_bytes: int = settings.max_body_bytes,
    static_dir: Path = DEFAULT_STATIC_DIR,
) -> FastAPI:
    app = FastAPI(title="AI Radar", dependencies=[Depends(stash_session)])
    app.add_exception_handler(ConflictError, conflict_handler)
    app.add_exception_handler(IntegrityError, integrity_error_handler)
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
    mount_spa(app, static_dir)
    return app


app = create_app()
