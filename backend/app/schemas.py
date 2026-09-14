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
