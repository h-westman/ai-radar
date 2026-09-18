from typing import Any

import psycopg
from fastapi import Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError


class ConflictError(Exception):
    def __init__(self, detail: str, current: dict[str, Any] | None = None) -> None:
        super().__init__(detail)
        self.detail = detail
        self.current = current


async def conflict_handler(_request: Request, exc: ConflictError) -> JSONResponse:
    return JSONResponse(status_code=409, content={"detail": exc.detail, "current": exc.current})


_UNIQUE_VIOLATION_MESSAGES = {
    "uq_radars_name_lower": "A radar with that name already exists",
    "uq_practices_name_lower": "A practice with that name already exists",
    "radar_notes_pkey": "This note was changed by someone else",
}


async def integrity_error_handler(request: Request, exc: IntegrityError) -> JSONResponse:
    """Turn a unique-violation IntegrityError into a 409 (races past the pre-checks).

    Anything else re-raises, so it stays a logged 500.
    """
    if not isinstance(exc.orig, psycopg.errors.UniqueViolation):
        raise exc
    session = getattr(request.state, "session", None)
    if session is not None:
        session.rollback()
    constraint = getattr(exc.orig.diag, "constraint_name", None)
    detail = _UNIQUE_VIOLATION_MESSAGES.get(constraint, "This conflicts with an existing item")
    return JSONResponse(status_code=409, content={"detail": detail, "current": None})


def ensure_version(actual: int, expected: int, current: dict[str, Any]) -> None:
    if actual != expected:
        raise ConflictError("This item was changed by someone else", current)
