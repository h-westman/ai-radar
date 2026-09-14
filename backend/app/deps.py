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
