from typing import Annotated
from urllib.parse import unquote

from fastapi import Depends, Header, Request
from sqlalchemy.orm import Session

from app.db import get_session

SessionDep = Annotated[Session, Depends(get_session)]


def stash_session(request: Request, session: SessionDep) -> None:
    """Make the request's session reachable from exception handlers.

    FastAPI caches dependency resolution per request, so this is the same
    Session instance every route sees via ``SessionDep`` (including in tests,
    where ``get_session`` is overridden with a fixed session).
    """
    request.state.session = session


def edited_by(x_edited_by: Annotated[str | None, Header()] = None) -> str | None:
    """The browser sends encodeURIComponent(name), because headers must be Latin-1."""
    if x_edited_by is None:
        return None
    name = unquote(x_edited_by).strip()[:100]
    return name or None


EditedBy = Annotated[str | None, Depends(edited_by)]
