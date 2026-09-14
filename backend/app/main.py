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
