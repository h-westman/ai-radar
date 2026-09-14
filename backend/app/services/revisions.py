from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.models import Practice, Revision, Team, TeamNote
from app.schemas import NoteOut, PracticeOut, TeamOut

_REGISTRY: dict[type, tuple[str, type[BaseModel]]] = {}


def register(model_cls: type, entity_type: str, schema_cls: type[BaseModel]) -> None:
    _REGISTRY[model_cls] = (entity_type, schema_cls)


register(Team, "team", TeamOut)
register(Practice, "practice", PracticeOut)
register(TeamNote, "team_note", NoteOut)


def entity_id_of(entity: object) -> str:
    if isinstance(entity, TeamNote):
        return f"{entity.team_id}:{entity.practice_id}"
    return str(entity.id)  # type: ignore[attr-defined]


def serialize(entity: object) -> dict:
    _, schema = _REGISTRY[type(entity)]
    return schema.model_validate(entity).model_dump(mode="json")


def record_revision(
    session: Session, entity: object, action: str, edited_by: str | None
) -> Revision:
    entity_type, _ = _REGISTRY[type(entity)]
    revision = Revision(
        entity_type=entity_type,
        entity_id=entity_id_of(entity),
        action=action,
        snapshot=serialize(entity),
        edited_by=edited_by,
    )
    session.add(revision)
    return revision


EDITABLE_FIELDS: dict[str, tuple[str, ...]] = {
    "team": ("name", "description"),
    "practice": ("name", "category", "summary", "body_md", "tags", "links"),
    "team_note": ("body_md",),
}
