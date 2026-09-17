from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Identity,
    Integer,
    SmallInteger,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.clock import utcnow
from app.db import Base

CATEGORIES = ("tool", "skill", "practice", "workflow")

# Indexes and CHECK constraints are defined in migrations/versions/*.py only.


class Radar(Base):
    __tablename__ = "radars"

    id: Mapped[int] = mapped_column(Integer, Identity(), primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text, default=None)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)


class Practice(Base):
    __tablename__ = "practices"

    id: Mapped[int] = mapped_column(Integer, Identity(), primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    category: Mapped[str] = mapped_column(String(20))
    summary: Mapped[str] = mapped_column(String(280), default="")
    body_md: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[list[str]] = mapped_column(ARRAY(String(40)), default=list)
    links: Mapped[list[dict]] = mapped_column(JSONB, default=list)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)


class RadarNote(Base):
    __tablename__ = "radar_notes"

    radar_id: Mapped[int] = mapped_column(ForeignKey("radars.id"), primary_key=True)
    practice_id: Mapped[int] = mapped_column(ForeignKey("practices.id"), primary_key=True)
    body_md: Mapped[str] = mapped_column(Text, default="")
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    edited_by: Mapped[str | None] = mapped_column(String(100), default=None)


class Placement(Base):
    __tablename__ = "placements"

    id: Mapped[int] = mapped_column(Integer, Identity(), primary_key=True)
    radar_id: Mapped[int] = mapped_column(ForeignKey("radars.id"))
    practice_id: Mapped[int] = mapped_column(ForeignKey("practices.id"))
    adoption: Mapped[int] = mapped_column(SmallInteger)
    value: Mapped[int] = mapped_column(SmallInteger)
    removed: Mapped[bool] = mapped_column(Boolean, default=False)
    effective_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    edited_by: Mapped[str | None] = mapped_column(String(100), default=None)


class Revision(Base):
    __tablename__ = "revisions"

    id: Mapped[int] = mapped_column(Integer, Identity(), primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(20))
    entity_id: Mapped[str] = mapped_column(String(50))
    action: Mapped[str] = mapped_column(String(20))
    snapshot: Mapped[dict] = mapped_column(JSONB)
    edited_by: Mapped[str | None] = mapped_column(String(100), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
