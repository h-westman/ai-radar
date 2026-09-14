from fastapi import FastAPI

from app.errors import ConflictError, conflict_handler
from app.routers import health, notes, placements, practices, teams


def create_app() -> FastAPI:
    app = FastAPI(title="AI Radar")
    app.add_exception_handler(ConflictError, conflict_handler)
    for router in (health.router, teams.router, practices.router, placements.router, notes.router):
        app.include_router(router, prefix="/api")
    return app


app = create_app()
