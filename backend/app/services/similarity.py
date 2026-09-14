from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Practice


def similar_practices(
    session: Session, name: str, *, limit: int = 5, threshold: float = 0.3
) -> list[Practice]:
    score = func.similarity(Practice.name, name)
    stmt = (
        select(Practice).where(score >= threshold).order_by(score.desc(), Practice.id).limit(limit)
    )
    return list(session.scalars(stmt))
