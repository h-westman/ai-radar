import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

from app.models import Placement, Practice
from tests.factories import make_placement, make_practice, make_radar


def test_all_tables_exist(session):
    tables = set(inspect(session.connection()).get_table_names())
    assert {"radars", "practices", "radar_notes", "placements", "revisions"} <= tables


def test_radar_tables_exist_and_have_no_slug():
    from app.models import Radar, RadarNote

    assert Radar.__tablename__ == "radars"
    assert RadarNote.__tablename__ == "radar_notes"
    assert not hasattr(Radar, "slug")
    assert not hasattr(Practice, "slug")
    assert "radar_id" in RadarNote.__table__.c
    assert "radar_id" in Placement.__table__.c


def test_pg_trgm_is_available(session):
    assert session.execute(text("SELECT similarity('copilot', 'copilot')")).scalar_one() == 1.0


def test_radar_names_are_unique_case_insensitively(session):
    make_radar(session, "Platform")
    with pytest.raises(IntegrityError):
        make_radar(session, "platform")


def test_practice_names_are_unique_case_insensitively(session):
    make_practice(session, "Claude Code")
    with pytest.raises(IntegrityError):
        make_practice(session, "CLAUDE CODE")


def test_practice_category_is_constrained(session):
    with pytest.raises(IntegrityError):
        make_practice(session, "Weird", category="gadget")


def test_placement_values_are_constrained(session):
    radar = make_radar(session)
    practice = make_practice(session)
    with pytest.raises(IntegrityError):
        make_placement(session, radar, practice, adoption=101)


def test_new_rows_get_defaults(session):
    practice = make_practice(session)
    assert practice.version == 1
    assert practice.tags == []
    assert practice.links == []
    assert practice.archived_at is None
    assert practice.created_at.tzinfo is not None
