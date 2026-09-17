from datetime import timedelta

from app.clock import utcnow
from app.models import RadarNote
from tests.factories import make_placement, make_practice, make_radar


def ago(hours):
    return utcnow() - timedelta(hours=hours)


def test_list_counts_radars_currently_using_each_practice(client, session):
    platform, payments = make_radar(session, "Platform"), make_radar(session, "Payments")
    archived = make_radar(session, "Old", archived_at=utcnow())
    x, y, z = (make_practice(session, n) for n in ("X tool", "Y tool", "Z tool"))
    make_placement(session, platform, x, effective_at=ago(3))
    make_placement(session, payments, x, effective_at=ago(3))
    make_placement(session, archived, x, effective_at=ago(3))
    make_placement(session, platform, y, effective_at=ago(3))
    make_placement(session, platform, y, removed=True, effective_at=ago(1))
    make_placement(session, platform, z, effective_at=utcnow() + timedelta(days=1))

    counts = {p["name"]: p["radars_count"] for p in client.get("/api/practices").json()}
    assert counts == {"X tool": 2, "Y tool": 0, "Z tool": 0}


def test_similar_includes_radar_counts(client, session):
    radar = make_radar(session)
    practice = make_practice(session, "GitHub Copilot")
    make_placement(session, radar, practice, effective_at=ago(1))
    [match] = client.get("/api/practices/similar", params={"name": "copilot"}).json()
    assert match["radars_count"] == 1


def test_detail_lists_radars_with_labels_and_notes(client, session):
    payments, platform = make_radar(session, "payments"), make_radar(session, "Platform")
    mobile = make_radar(session, "Mobile")
    practice = make_practice(session)
    make_placement(session, platform, practice, adoption=80, value=90, effective_at=ago(2))
    make_placement(session, payments, practice, adoption=20, value=70, effective_at=ago(2))
    make_placement(session, mobile, practice, effective_at=ago(2))
    make_placement(session, mobile, practice, removed=True, effective_at=ago(1))
    session.add(RadarNote(radar_id=platform.id, practice_id=practice.id, body_md="Refactors."))
    session.flush()

    body = client.get(f"/api/practices/{practice.id}").json()
    assert body["name"] == "Claude Code"
    assert body["radars"] == [
        {
            "radar_id": payments.id,
            "radar_name": "payments",
            "label": "Hidden gem",
            "note_md": None,
        },
        {
            "radar_id": platform.id,
            "radar_name": "Platform",
            "label": "Core",
            "note_md": "Refactors.",
        },
    ]


def test_patch_still_returns_plain_practice(client, session):
    practice = make_practice(session)
    body = client.patch(f"/api/practices/{practice.id}", json={"version": 1, "summary": "x"}).json()
    assert "radars" not in body
