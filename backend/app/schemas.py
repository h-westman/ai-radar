from datetime import datetime
from typing import Annotated, Literal

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
