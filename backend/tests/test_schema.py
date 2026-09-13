import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

from tests.factories import make_placement, make_practice, make_team


def test_all_tables_exist(session):
    tables = set(inspect(session.connection()).get_table_names())
    assert {"teams", "practices", "team_notes", "placements", "revisions"} <= tables


def test_pg_trgm_is_available(session):
    assert session.execute(text("SELECT similarity('copilot', 'copilot')")).scalar_one() == 1.0


def test_team_names_are_unique_case_insensitively(session):
    make_team(session, "Platform")
    with pytest.raises(IntegrityError):
        make_team(session, "platform")


def test_practice_names_are_unique_case_insensitively(session):
    make_practice(session, "Claude Code")
    with pytest.raises(IntegrityError):
        make_practice(session, "CLAUDE CODE")


def test_practice_category_is_constrained(session):
    with pytest.raises(IntegrityError):
        make_practice(session, "Weird", category="gadget")


def test_placement_values_are_constrained(session):
    team = make_team(session)
    practice = make_practice(session)
    with pytest.raises(IntegrityError):
        make_placement(session, team, practice, adoption=101)


def test_new_rows_get_defaults(session):
    practice = make_practice(session)
    assert practice.version == 1
    assert practice.tags == []
    assert practice.links == []
    assert practice.archived_at is None
    assert practice.created_at.tzinfo is not None
