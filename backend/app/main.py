from fastapi import FastAPI

from app.routers import health


def create_app() -> FastAPI:
    app = FastAPI(title="AI Radar")
    app.include_router(health.router, prefix="/api")
    return app


app = create_app()
