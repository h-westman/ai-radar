import pytest

from app.services.labels import corner_label
from app.services.slugs import slugify


@pytest.mark.parametrize(
    ("adoption", "value", "expected"),
    [
        (80, 90, "Core"),
        (50, 50, "Core"),
        (49, 50, "Hidden gem"),
        (10, 95, "Hidden gem"),
        (50, 49, "Question it"),
        (90, 10, "Question it"),
        (49, 49, "Parked"),
        (0, 0, "Parked"),
    ],
)
def test_corner_label(adoption, value, expected):
    assert corner_label(adoption, value) == expected


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("GitHub Copilot", "github-copilot"),
        ("  Spec-driven dev! ", "spec-driven-dev"),
        ("Årsplan för AI", "arsplan-for-ai"),
        ("!!!", "item"),
        ("a" * 200, "a" * 120),
    ],
)
def test_slugify(name, expected):
    assert slugify(name) == expected
