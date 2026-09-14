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
