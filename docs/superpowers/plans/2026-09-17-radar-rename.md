# Team → Radar Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the `Team` entity to `Radar` at every layer, and replace `<id>-<slug>` URLs with bare ids.

**Architecture:** Bottom-up. The database and models move first, then services, then schemas and routers. The backend test suite is the gate before the API contract is regenerated; `openapi-typescript` then propagates the rename into the frontend, where the TypeScript compiler enumerates every remaining break. No layer starts before the one below it is green.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2, Alembic, pytest, uv · React 19, TypeScript 6, Vite 8, TanStack Query, Vitest, Testing Library, MSW

**Spec:** `docs/superpowers/specs/2026-09-17-radar-rename-design.md`

## Global Constraints

- The entity is **Radar**. The word "team" survives only in prose that means an actual human team.
- The org scope is unchanged: `scope=org`, labelled "Whole organization".
- URLs carry bare ids: `/radar/12`, `/practices/45`, `/radars`. No slugs.
- The `slug` column is **dropped** from `radars` and `practices`; `app/services/slugs.py` is deleted.
- `0001_initial.py` is **rewritten in place**. No rename migration is added.
- `revisions.entity_type` value `'team'` becomes `'radar'`; `'team_note'` becomes `'radar_note'`.
- The frames endpoint moves to `GET /api/frames`.
- The sidebar heading is `Who’s using it` — typographic apostrophe U+2019, identical in the visible heading and the `aria-label`.
- `TeamsPage.tsx` becomes `RadarListPage.tsx`, never `RadarsPage.tsx`.
- No test is deleted to make the rename pass. A test that no longer compiles is rewritten against the new names.
- Local database must be recreated: `docker compose down -v && docker compose up -d db && uv run alembic upgrade head`.

---

### Task 1: Models and migration

**Files:**
- Modify: `backend/app/models.py:24-64`
- Modify: `backend/migrations/versions/0001_initial.py`
- Delete: `backend/app/services/slugs.py`
- Delete: `backend/tests/test_labels_slugs.py` slug cases (keep label cases — see Step 1)
- Test: `backend/tests/test_schema.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `Radar` (table `radars`), `RadarNote` (table `radar_notes`, PK `radar_id, practice_id`), `Placement.radar_id`. Neither `Radar` nor `Practice` has a `slug` attribute.

- [ ] **Step 1: Split the slug tests off the label tests**

`backend/tests/test_labels_slugs.py` covers two services. Only the slug half goes. Rename the file to `backend/tests/test_labels.py` and delete every test that calls `slugify`, keeping the corner-label tests exactly as they are.

```bash
cd backend
git mv tests/test_labels_slugs.py tests/test_labels.py
```

Then remove the `from app.services.slugs import slugify` import and every `def test_slug*` function from that file.

- [ ] **Step 2: Write the failing schema test**

In `backend/tests/test_schema.py`, add:

```python
def test_radar_tables_exist_and_have_no_slug():
    from app.models import Radar, RadarNote

    assert Radar.__tablename__ == "radars"
    assert RadarNote.__tablename__ == "radar_notes"
    assert not hasattr(Radar, "slug")
    assert not hasattr(Practice, "slug")
    assert "radar_id" in RadarNote.__table__.c
    assert "radar_id" in Placement.__table__.c
```

Add `Placement` and `Practice` to that module's existing `from app.models import ...` line if they are not already imported.

- [ ] **Step 3: Run it to make sure it fails**

Run: `cd backend && uv run pytest tests/test_schema.py::test_radar_tables_exist_and_have_no_slug -v`
Expected: FAIL with `ImportError: cannot import name 'Radar' from 'app.models'`

- [ ] **Step 4: Rename the models and drop slug**

In `backend/app/models.py`, rename `class Team` to `class Radar` with `__tablename__ = "radars"`, and `class TeamNote` to `class RadarNote` with `__tablename__ = "radar_notes"`. Delete the `slug` column from both `Radar` and `Practice`. Rename `team_id` to `radar_id` in `RadarNote` and `Placement`, pointing at `ForeignKey("radars.id")`.

```python
class Radar(Base):
    __tablename__ = "radars"

    id: Mapped[int] = mapped_column(Integer, Identity(), primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text, default=None)
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
```

Delete `backend/app/services/slugs.py`.

- [ ] **Step 5: Rewrite the initial migration**

In `backend/migrations/versions/0001_initial.py`, apply every one of these edits:

- `op.create_table("teams", ...)` → `op.create_table("radars", ...)`, and delete its `sa.Column("slug", sa.String(120), nullable=False)` line.
- Delete the `slug` column from the `practices` table too.
- `CREATE UNIQUE INDEX uq_teams_name_lower ON teams (lower(name))` → `CREATE UNIQUE INDEX uq_radars_name_lower ON radars (lower(name))`
- `op.create_table("team_notes", ...)` → `op.create_table("radar_notes", ...)`, with `sa.Column("radar_id", sa.Integer, sa.ForeignKey("radars.id"), primary_key=True)`
- In `placements`: `sa.Column("radar_id", sa.Integer, sa.ForeignKey("radars.id"), nullable=False)`
- The placements index body becomes `"(radar_id, practice_id, effective_at DESC, recorded_at DESC)"`
- The revisions check constraint becomes `"entity_type IN ('radar', 'practice', 'radar_note')"`, name unchanged
- The downgrade loop becomes `for table in ("revisions", "placements", "radar_notes", "practices", "radars"):`

- [ ] **Step 6: Update the pre-existing schema test and factory**

`backend/tests/test_schema.py` already has `test_all_tables_exist`, which asserts the old table names and imports `make_team`. Both must move now or this task's own test run fails:

```python
def test_all_tables_exist(session):
    tables = set(inspect(session.connection()).get_table_names())
    assert {"radars", "practices", "radar_notes", "placements", "revisions"} <= tables
```

In `backend/tests/factories.py`, rename `make_team` to `make_radar`, have it construct `Radar` with no `slug` argument, and rename its `team_id=` keyword arguments to `radar_id=`. Update the import line in `test_schema.py` and every other caller in `backend/tests/` to `make_radar`.

- [ ] **Step 7: Recreate the database and run the test**

```bash
cd /Users/hans/dev/ai-radar
docker compose down -v && docker compose up -d db
cd backend && uv run alembic upgrade head
uv run pytest tests/test_schema.py -v
```
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add backend/app/models.py backend/migrations/versions/0001_initial.py backend/tests/
git rm backend/app/services/slugs.py
git commit -m "refactor(backend): rename Team to Radar in models and drop slug columns"
```

---

### Task 2: Services

**Files:**
- Modify: `backend/app/services/frames.py:24-42,95-160`
- Modify: `backend/app/services/positions.py`
- Modify: `backend/app/services/revisions.py:14-48`
- Test: `backend/tests/test_frames_aggregation.py`, `backend/tests/test_frames_periods.py`, `backend/tests/factories.py`

**Interfaces:**
- Consumes: `Radar`, `RadarNote`, `Placement.radar_id` from Task 1.
- Produces: `RadarRow(id, archived_at)`, `RadarPosition(radar_id, adoption, value)`, `Point(practice_id, adoption, value, radars, radar_positions)`, `PlacementRow(..., radar_id, ...)`, `active_radar_ids(...)`, `build_frames(scope_radar_id=..., radars=..., ...)`, `load_radar_rows(session)`, `position_as_of(session, radar_id, practice_id, at)`, `load_placement_rows(session, *, radar_id=None, practice_id=None)`, `current_usage(session, *, practice_id=None)` returning `dict[int, list[PlacementRow]]`.

- [ ] **Step 1: Write the failing service test**

(`backend/tests/factories.py` was already renamed in Task 1 — `make_radar`, `radar_id=`. Do not redo it.)


Add to `backend/tests/test_frames_aggregation.py`:

```python
def test_point_counts_radars_not_teams():
    from app.services.frames import Point, RadarPosition

    point = Point(
        practice_id=10,
        adoption=70,
        value=80,
        radars=2,
        radar_positions=(RadarPosition(radar_id=1, adoption=70, value=80),),
    )
    assert point.radars == 2
    assert point.radar_positions[0].radar_id == 1
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd backend && uv run pytest tests/test_frames_aggregation.py::test_point_counts_radars_not_teams -v`
Expected: FAIL with `ImportError: cannot import name 'RadarPosition' from 'app.services.frames'`

- [ ] **Step 3: Rename through the three service modules**

In `backend/app/services/frames.py`: `TeamRow` → `RadarRow`, `TeamPosition` → `RadarPosition` (its field `team_id` → `radar_id`), `Point.teams` → `Point.radars`, `Point.team_positions` → `Point.radar_positions`, `active_team_ids` → `active_radar_ids`, `PlacementRow.team_id` → `radar_id`, and the `build_frames` parameters `scope_team_id` → `scope_radar_id` and `teams` → `radars`. Inside `build_frames` the aggregate line becomes:

```python
adoption=_round(sum(r.adoption for r in rows) / len(active)),
```

— unchanged arithmetic; `active` is now the set of active radar ids.

In `backend/app/services/positions.py`: `load_team_rows` → `load_radar_rows`, the `Team` import → `Radar`, and every `team_id` parameter, keyword and attribute → `radar_id`.

In `backend/app/services/revisions.py` — note the schema symbol stays `TeamOut` for now. It is renamed to `RadarOut` in Task 3, when the schema itself is renamed; referencing `RadarOut` here would not import:

```python
from app.models import Practice, Radar, RadarNote, Revision
from app.schemas import NoteOut, PracticeOut, TeamOut

register(Radar, "radar", TeamOut)
register(Practice, "practice", PracticeOut)
register(RadarNote, "radar_note", NoteOut)
```

the entity-id helper returns `f"{entity.radar_id}:{entity.practice_id}"`, and the editable-fields map keys become `"radar": ("name", "description")` and `"radar_note": ("body_md",)`. Delete the `slugify` import and the `entity.slug = slugify(snapshot["name"])` line from the revert path.

- [ ] **Step 4: Rename through the service tests**

In `backend/tests/test_frames_aggregation.py` and `backend/tests/test_frames_periods.py`, replace `TeamRow` → `RadarRow`, `TeamPosition` → `RadarPosition`, `team_id=` → `radar_id=`, `teams=` → `radars=`, `scope_team_id=` → `scope_radar_id=`, `.teams` → `.radars`, `.team_positions` → `.radar_positions`.

- [ ] **Step 5: Run the service tests**

Run: `cd backend && uv run pytest tests/test_frames_aggregation.py tests/test_frames_periods.py tests/test_labels.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/services backend/tests
git commit -m "refactor(backend): rename Team to Radar through the services"
```

---

### Task 3: Schemas and routers

**Files:**
- Modify: `backend/app/schemas.py:26-52,76-101,138-148,222-250`
- Rename: `backend/app/routers/teams.py` → `backend/app/routers/radars.py`
- Rename: `backend/app/routers/radar.py` → `backend/app/routers/frames.py` (via `git mv`; see Step 4)
- Modify: `backend/app/routers/notes.py`, `placements.py`, `practices.py`, `revisions.py`
- Modify: `backend/app/main.py` (router registration)
- Rename: `backend/tests/api/test_teams.py` → `backend/tests/api/test_radars.py`
- Modify: `backend/tests/api/test_radar.py`, `test_notes.py`, `test_placements.py`, `test_practice_usage.py`, `test_practices.py`, `test_revisions.py`, `backend/tests/test_openapi.py`

**Interfaces:**
- Consumes: everything from Tasks 1 and 2.
- Produces: `GET|POST /api/radars`, `GET|PATCH /api/radars/{radar_id}`, `POST /api/radars/{radar_id}/archive|restore`, `GET|PUT /api/radars/{radar_id}/notes/{practice_id}`, `GET /api/frames?scope=org|radar:{id}&step=&from=&to=`. Schemas `RadarOut`, `RadarCreate`, `RadarUpdate`, `RadarPositionOut`, `PracticeRadarUsage`. `PracticeDetail.radars`, `PracticeListItem.radars_count`, `PointOut.radars`, `PointOut.radar_positions`. No `slug` on any response.

- [ ] **Step 1: Write the failing API test**

Add to `backend/tests/api/test_radars.py` (after the `git mv` in Step 3):

```python
def test_create_radar_returns_no_slug(client):
    response = client.post("/api/radars", json={"name": "Platform"})
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Platform"
    assert "slug" not in body
```

And add to `backend/tests/api/test_radar.py`:

```python
def test_frames_endpoint_accepts_radar_scope(client):
    created = client.post("/api/radars", json={"name": "Payments"}).json()
    response = client.get("/api/frames", params={"scope": f"radar:{created['id']}"})
    assert response.status_code == 200
    assert response.json()["scope"] == f"radar:{created['id']}"


def test_frames_endpoint_rejects_team_scope(client):
    assert client.get("/api/frames", params={"scope": "team:1"}).status_code == 422
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd backend && uv run pytest tests/api/test_radars.py tests/api/test_radar.py -v`
Expected: FAIL with 404 — `/api/radars` and `/api/frames` do not exist yet.

- [ ] **Step 3: Rename the schema classes and fields**

In `backend/app/schemas.py`: `TeamOut` → `RadarOut` (delete its `slug: str`), `TeamCreate` → `RadarCreate`, `TeamUpdate` → `RadarUpdate`, `TeamPositionOut` → `RadarPositionOut` (field `team_id` → `radar_id`), `PracticeTeamUsage` → `PracticeRadarUsage` with fields `radar_id: int`, `radar_name: str`, `label: str`, `note_md: str | None` — its `team_slug` is deleted outright. Delete `slug: str` from `PracticeOut` and `PracticeListItem`. `PracticeListItem.teams_count` → `radars_count`. `PracticeDetail.teams` → `radars: list[PracticeRadarUsage]`. `PointOut.teams` → `radars`, `PointOut.team_positions` → `radar_positions`.

- [ ] **Step 4: Move the routers**

```bash
cd /Users/hans/dev/ai-radar
git mv backend/app/routers/teams.py backend/app/routers/radars.py
git mv backend/app/routers/radar.py backend/app/routers/frames.py
git mv backend/tests/api/test_teams.py backend/tests/api/test_radars.py
```

In `backend/app/routers/radars.py`: `router = APIRouter(prefix="/radars", tags=["radars"])`, `get_team_or_404` → `get_radar_or_404` (its 404 detail becomes `"Radar not found"`), `ensure_team_name_free` → `ensure_radar_name_free` (its conflict message becomes `"A radar with that name already exists"`), `list_teams` → `list_radars`, `create_team` → `create_radar`, `get_team` → `get_radar`, `update_team` → `update_radar`, `archive_team` → `archive_radar`, `restore_team` → `restore_radar`, every `team_id` path parameter → `radar_id`, and the `Team` import → `Radar`. Delete the `slugify` import and drop `slug=slugify(data.name)` from the constructor:

```python
radar = Radar(name=data.name, description=data.description)
```

In `backend/app/routers/frames.py`: `router = APIRouter(tags=["frames"])`, the route becomes `@router.get("/frames", ...)`, the scope pattern becomes `_SCOPE = re.compile(r"^(?:org|radar:(\d+))$")`, the 422 detail becomes `"scope must be 'org' or 'radar:<id>'"`, `team_id` → `radar_id`, the import becomes `from app.routers.radars import get_radar_or_404`, and `build_frames` is called with `scope_radar_id=radar_id, radars=load_radar_rows(session)`.

In `backend/app/main.py`, line 10 currently reads:

```python
from app.routers import health, notes, placements, practices, radar, revisions, teams
```

It becomes:

```python
from app.routers import frames, health, notes, placements, practices, radars, revisions
```

Update the corresponding entries in the list the file iterates when calling `app.include_router(router, prefix="/api")`, keeping the `/api` prefix exactly as it is applied today.

- [ ] **Step 5: Rename through the remaining routers**

In `notes.py`, `placements.py`, `practices.py` and `revisions.py`: every `team_id` → `radar_id`, `Team` → `Radar`, `TeamNote` → `RadarNote`, `get_team_or_404` → `get_radar_or_404`, `PracticeTeamUsage` → `PracticeRadarUsage`. In `practices.py`, the usage construction becomes:

```python
PracticeRadarUsage(
    radar_id=r.radar_id,
    radar_name=radars[r.radar_id].name,
    label=label,
    note_md=note_md,
)
```

and the `slugify` import plus both `slug=slugify(...)` assignments are deleted. `notes.py:12` currently reads `router = APIRouter(prefix="/teams/{team_id}/notes", tags=["notes"])`. It becomes:

```python
router = APIRouter(prefix="/radars/{radar_id}/notes", tags=["notes"])
```

Its two route decorators `@router.get("/{practice_id}")` and `@router.put("/{practice_id}")` are unchanged; only the path parameter name in the handler signatures moves to `radar_id`.

- [ ] **Step 6: Rename through the API tests**

Across `backend/tests/api/*.py` and `backend/tests/test_openapi.py`: `/api/teams` → `/api/radars`, `/api/radar/frames` → `/api/frames`, `scope=team:` → `scope=radar:`, `team_id` → `radar_id`, `teams_count` → `radars_count`, and any assertion on a `slug` response field is deleted rather than rewritten.

Two tests outside `tests/api/` also post to the old paths and are easy to miss:

- `backend/tests/test_middleware.py` lines 18, 23, 27, 30, 35 drive the rate limiter through `POST /api/teams` and `GET /api/teams`. Change those five paths to `/api/radars`; the rate-limit assertions themselves do not change.
- `backend/tests/test_spa.py:27` asserts the SPA fallback serves a client route: `client.get("/radar/team/3-platform")` becomes `client.get("/radar/3")`.

- [ ] **Step 7: Run the whole backend suite**

Run: `cd backend && uv run pytest -v`
Expected: PASS, all tests

- [ ] **Step 8: Commit**

```bash
git add backend/
git commit -m "refactor(backend): rename Team to Radar in schemas, routers and API paths"
```

---

### Task 4: Regenerate the API contract

**Files:**
- Modify: `frontend/openapi.json` (generated)
- Modify: `frontend/src/api/schema.d.ts` (generated)

**Interfaces:**
- Consumes: the routers from Task 3.
- Produces: `components['schemas']['RadarOut' | 'RadarCreate' | 'RadarUpdate' | 'PracticeRadarUsage' | 'RadarPositionOut']` and the `/api/radars*` and `/api/frames` path types.

- [ ] **Step 1: Regenerate**

```bash
cd frontend && npm run gen:api
```

- [ ] **Step 2: Confirm the contract moved**

```bash
cd frontend
grep -c '"/api/radars"' openapi.json          # expect >= 1
grep -c '"/api/frames"' openapi.json          # expect >= 1
grep -c '"/api/teams"' openapi.json           # expect 0
grep -ci 'slug' openapi.json                  # expect 0
```

If the last two are not zero, a router or schema in Task 3 was missed — go back rather than editing the generated files by hand.

- [ ] **Step 3: Commit**

```bash
git add frontend/openapi.json frontend/src/api/schema.d.ts
git commit -m "chore(frontend): regenerate API types for the Radar rename"
```

---

### Task 5: Frontend types, ids and hooks

**Files:**
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/api/hooks.ts`
- Delete: `frontend/src/lib/refs.ts`, `frontend/src/lib/refs.test.ts`
- Create: `frontend/src/lib/ids.ts`, `frontend/src/lib/ids.test.ts`
- Modify: `frontend/src/api/hooks.test.tsx`, `frontend/src/test/fixtures.ts`

**Interfaces:**
- Consumes: the generated types from Task 4.
- Produces: `parseId(raw: string | undefined): number | null`; types `Radar`, `RadarCreate`, `RadarUpdate`, `PracticeRadarUsage`; hooks `useRadars(includeArchived?)`, `useRadar(id)`, `useCreateRadar()`, `useUpdateRadar()`, `useSetRadarArchived()`, `useNote(radarId, practiceId)`, `usePutNote()`, `useFrames(scope, step)`; query keys `keys.radars(includeArchived)`, `keys.radar(id)`, `keys.note(radarId, practiceId)`.

- [ ] **Step 1: Write the failing id test**

Create `frontend/src/lib/ids.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { parseId } from './ids'

describe('parseId', () => {
  it('reads a bare positive integer', () => {
    expect(parseId('12')).toBe(12)
  })

  it('rejects a legacy id-slug ref', () => {
    expect(parseId('12-platform')).toBeNull()
  })

  it('rejects non-numeric, empty and undefined input', () => {
    expect(parseId('org')).toBeNull()
    expect(parseId('')).toBeNull()
    expect(parseId(undefined)).toBeNull()
  })

  it('rejects zero and negative ids', () => {
    expect(parseId('0')).toBeNull()
    expect(parseId('-3')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd frontend && npm test -- src/lib/ids.test.ts`
Expected: FAIL — cannot resolve `./ids`

- [ ] **Step 3: Write parseId and delete refs**

Create `frontend/src/lib/ids.ts`:

```typescript
/** Parses a bare positive integer id from a URL segment. Anything else is not an id. */
export function parseId(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null
  const id = Number(raw)
  return id > 0 ? id : null
}
```

```bash
cd /Users/hans/dev/ai-radar
git rm frontend/src/lib/refs.ts frontend/src/lib/refs.test.ts
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `cd frontend && npm test -- src/lib/ids.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Rename the types and hooks**

In `frontend/src/api/types.ts`: `Team` → `Radar` (`S['RadarOut']`), `TeamCreate` → `RadarCreate`, `TeamUpdate` → `RadarUpdate`, `PracticeTeamUsage` → `PracticeRadarUsage`. Delete any exported alias that referenced a removed `slug`.

In `frontend/src/api/hooks.ts`: `keys.teams` → `keys.radars` (key string `'radars'`), `keys.team` → `keys.radar` (key string `'radar'`), `keys.note(teamId, practiceId)` → `keys.note(radarId, practiceId)`; `useTeams` → `useRadars`, `useTeam` → `useRadar`, `useCreateTeam` → `useCreateRadar`, `useUpdateTeam` → `useUpdateRadar`, `useSetTeamArchived` → `useSetRadarArchived`; every path literal `/api/teams...` → `/api/radars...` with `team_id` → `radar_id`; the frames path → `/api/frames`; and every invalidation array `[['teams']]` → `[['radars']]`.

`usePutNote` additionally carries a `teamId` on its own argument object, which the path rename does not touch. Its signature becomes:

```typescript
export function usePutNote() {
  return useInvalidatingMutation(
    async (v: { radarId: number; practiceId: number; version: number; body_md: string }) =>
      unwrap(
        await api.PUT('/api/radars/{radar_id}/notes/{practice_id}', {
          params: { path: { radar_id: v.radarId, practice_id: v.practiceId } },
          body: { version: v.version, body_md: v.body_md },
        }),
      ),
    (v) => [keys.note(v.radarId, v.practiceId), keys.practice(v.practiceId), ['revisions']],
  )
}
```

`useNote`'s `teamId` parameter becomes `radarId` in the same way.

In `frontend/src/test/fixtures.ts`: the `team(...)` factory → `radar(...)` with no `slug` field, `teams_count` → `radars_count`, `teams: []` → `radars: []`, `team_id` → `radar_id`, and the frames fixture's `scope: 'team:1'` → `'radar:1'` with each point's `teams:` → `radars:`.

- [ ] **Step 6: Run the api tests**

Run: `cd frontend && npm test -- src/api src/lib`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/src
git commit -m "refactor(frontend): rename Team to Radar in types and hooks, replace refs with parseId"
```

---

### Task 6: Routes and the app shell

**Files:**
- Modify: `frontend/src/router.tsx`
- Modify: `frontend/src/components/AppShell.tsx`
- Rename: `frontend/src/pages/TeamsPage.tsx` → `frontend/src/pages/RadarListPage.tsx`
- Rename: `frontend/src/pages/TeamsPage.test.tsx` → `frontend/src/pages/RadarListPage.test.tsx`
- Modify: `frontend/src/components/AppShell.test.tsx`

**Interfaces:**
- Consumes: `parseId`, `useRadars` from Task 5.
- Produces: routes `/radar/org`, `/radar/:radarId`, `/practices`, `/practices/:practiceId`, `/radars`; `LAST_RADAR_KEY = 'aiRadar.lastRadar'`; default export `RadarListPage`.

- [ ] **Step 1: Write the failing route test**

Add to `frontend/src/components/AppShell.test.tsx`:

```typescript
it('navigates to a bare-id radar url', async () => {
  const { router } = renderRoutes('/radar/org')
  const select = await screen.findByRole('combobox', { name: 'Radar' })
  await userEvent.selectOptions(select, '1')
  await waitFor(() => expect(router.state.location.pathname).toBe('/radar/1'))
})
```

Ensure this file's MSW handler for `/api/radars` returns a radar with `id: 1`; if it currently returns `[]`, change it to return `[radar({ id: 1, name: 'Platform' })]` using the fixture from Task 5.

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd frontend && npm test -- src/components/AppShell.test.tsx`
Expected: FAIL — the option value is still `1-platform` and the path is `/radar/team/1-platform`

- [ ] **Step 3: Move the list page**

```bash
cd /Users/hans/dev/ai-radar
git mv frontend/src/pages/TeamsPage.tsx frontend/src/pages/RadarListPage.tsx
git mv frontend/src/pages/TeamsPage.test.tsx frontend/src/pages/RadarListPage.test.tsx
```

Rename the component in that file from `TeamsPage` to `RadarListPage`, switch it to `useRadars`/`useCreateRadar`/`useUpdateRadar`/`useSetRadarArchived`, change its heading to "Radars", and change its link construction from `` `/radar/team/${toRef(t.id, t.slug)}` `` to `` `/radar/${r.id}` ``.

- [ ] **Step 4: Update the router**

In `frontend/src/router.tsx`:

```typescript
export function HomeRedirect() {
  const lastRadar = readString(LAST_RADAR_KEY)
  return <Navigate replace to={lastRadar ? `/radar/${lastRadar}` : '/radar/org'} />
}

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: 'radar/org', element: <RadarPage /> },
      { path: 'radar/:radarId', element: <RadarPage /> },
      { path: 'practices', element: <CatalogPage /> },
      { path: 'practices/:practiceId', element: <PracticePage /> },
      { path: 'radars', element: <RadarListPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]
```

- [ ] **Step 5: Update the app shell**

In `frontend/src/components/AppShell.tsx`: `LAST_TEAM_KEY` → `LAST_RADAR_KEY` with value `'aiRadar.lastRadar'`; `useMatch('/radar/team/:teamRef')` → `useMatch('/radar/:radarId')`; the option value becomes `String(r.id)`; `onScopeChange` navigates to `/radar/${value}`; the nav link `<NavLink to="/teams">Teams</NavLink>` becomes `<NavLink to="/radars">Radars</NavLink>`. Note that `useMatch('/radar/:radarId')` also matches `/radar/org`; guard with `parseId` so the org scope is not treated as an id.

- [ ] **Step 6: Run the tests**

Run: `cd frontend && npm test -- src/components/AppShell.test.tsx src/pages/RadarListPage.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/src
git commit -m "refactor(frontend): bare-id radar routes and RadarListPage"
```

---

### Task 7: Radar page, drawer, tray and chart

**Files:**
- Modify: `frontend/src/pages/RadarPage.tsx`
- Modify: `frontend/src/components/Drawer.tsx`, `frontend/src/components/Tray.tsx`
- Modify: `frontend/src/chart/renderRadar.ts`, `frontend/src/chart/RadarChart.tsx`, `frontend/src/chart/frames.ts`
- Modify: the matching `.test.tsx` files for each of the above

**Interfaces:**
- Consumes: `parseId`, the renamed hooks, `LAST_RADAR_KEY`.
- Produces: `RadarDot = { radarId: number; radarName: string; adoption: number; value: number }`; `ChartBubble` with `radars: number` and `radarPositions?: RadarDot[]`.

- [ ] **Step 1: Write the failing drawer test**

Add to `frontend/src/components/Drawer.test.tsx`:

```typescript
it('lists who is using the practice in org scope', () => {
  render(
    <Drawer
      scope="org"
      practice={practice}
      label="Core"
      radars={[{ radarId: 3, radarName: 'Platform', label: 'Core' }]}
      canRemove={false}
      onRemove={() => {}}
      onClose={() => {}}
    />,
  )
  expect(screen.getByRole('heading', { name: 'Who’s using it' })).toBeInTheDocument()
  expect(screen.getByText('Platform')).toBeInTheDocument()
})
```

The apostrophe in `Who’s` is U+2019. Copy it; do not retype it as `'`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd frontend && npm test -- src/components/Drawer.test.tsx`
Expected: FAIL — the prop is still `teams` and the heading still reads "Teams using it"

- [ ] **Step 3: Rename through the chart modules**

In `frontend/src/chart/renderRadar.ts`: `TeamDot` → `RadarDot` with fields `radarId`, `radarName`; `ChartBubble.teams` → `radars`; `ChartBubble.teamPositions` → `radarPositions`. In `frontend/src/chart/frames.ts` and `RadarChart.tsx`, follow the same renames. The `PRACTICE_MIME` constant is unchanged.

- [ ] **Step 4: Rename through the page and panels**

In `frontend/src/pages/RadarPage.tsx`: `const { radarId: radarRef } = useParams()` with `const radarId = parseId(radarRef)`; `teamId` → `radarId`; `scopeKey` becomes `` radarId === null ? 'org' : `radar:${radarId}` ``; `teamName` → `radarName`; `teamWritable` → `radarWritable`; `team` → `radar`; `writeString(LAST_RADAR_KEY, String(radarId))`; the not-found copy becomes `This radar doesn’t exist.` linking to `/radars` with the text `See all radars`; the `team_positions` mapping becomes `radar_positions` producing `{ radarId, radarName, adoption, value }`; and the Drawer's `teams=` prop becomes `radars=`.

In `frontend/src/components/Drawer.tsx`: the prop `teams?: { teamId: number; teamName: string; label: PositionLabel }[]` becomes `radars?: { radarId: number; radarName: string; label: PositionLabel }[]`, the prop `teamId` becomes `radarId`, and `<h3>Teams using it</h3>` becomes `<h3>Who’s using it</h3>`.

In `frontend/src/components/Tray.tsx`, rename any `team`-named prop or variable; its practice list is unaffected.

- [ ] **Step 5: Run the chart and component tests**

Run: `cd frontend && npm test -- src/chart src/components src/pages/RadarPage.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src
git commit -m "refactor(frontend): rename Team to Radar on the radar screen and chart"
```

---

### Task 8: Catalog and practice page

**Files:**
- Modify: `frontend/src/pages/CatalogPage.tsx`, `frontend/src/pages/PracticePage.tsx`, `frontend/src/pages/NewPracticeForm.tsx`
- Modify: `frontend/src/pages/CatalogPage.test.tsx`, `frontend/src/pages/PracticePage.test.tsx`
- Modify: `frontend/src/pages/Pages.module.css`

**Interfaces:**
- Consumes: everything above.
- Produces: no new exports. `/practices/45` resolves; the practice aside is named `Who’s using it`.

- [ ] **Step 1: Write the failing practice page test**

Add to `frontend/src/pages/PracticePage.test.tsx`:

```typescript
it('opens a practice by bare id and names the usage aside', async () => {
  renderRoutes('/practices/10')
  expect(await screen.findByRole('complementary', { name: 'Who’s using it' })).toBeInTheDocument()
})
```

The apostrophe is U+2019.

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd frontend && npm test -- src/pages/PracticePage.test.tsx`
Expected: FAIL — the aside is still labelled "Teams using it"

- [ ] **Step 3: Update both pages**

In `frontend/src/pages/PracticePage.tsx`: `const { practiceId: practiceRef } = useParams()` with `parseId`; `practice.teams` → `practice.radars`; the aside's `aria-label` and `<h2>` both become `Who’s using it ({practice.radars.length})`; each row links to `` `/radar/${r.radar_id}` `` and shows `r.radar_name`; the `styles.teamRow` class is renamed to `styles.radarRow` in both the TSX and `Pages.module.css`.

In `frontend/src/pages/CatalogPage.tsx`: links become `` `/practices/${p.id}` ``; the count cell becomes `` aria-label={`${p.radars_count} radars`} `` with `{p.radars_count}` as its content.

In `frontend/src/pages/NewPracticeForm.tsx` and anywhere else, `open(...)` navigates to `` `/practices/${p.id}` `` and the `toRef` import is deleted.

- [ ] **Step 4: Run the page tests**

Run: `cd frontend && npm test -- src/pages`
Expected: PASS

- [ ] **Step 5: Run every gate**

```bash
cd frontend
npm run typecheck
npm test
npm run check:api
npm run build
```
Expected: typecheck silent, 126+ tests pass, `check:api` clean, build succeeds.

Then confirm nothing survived:

```bash
cd /Users/hans/dev/ai-radar
grep -rn "toRef\|idFromRef" frontend/src ; echo "--- expect no output above ---"
grep -rin "team" frontend/src backend/app ; echo "--- expect no output above ---"
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src
git commit -m "refactor(frontend): bare-id practice urls and the Who’s using it heading"
```

---

### Task 9: Documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-09-13-ai-radar-design.md` sections 3, 5, 6, 8
- Modify: `frontend/README.md`

**Interfaces:**
- Consumes: the finished rename.
- Produces: documentation that matches the code.

- [ ] **Step 1: Amend the original design spec by hand**

Edit, do not sweep. In `docs/superpowers/specs/2026-09-13-ai-radar-design.md`:

- §3 tables: `teams` → `radars`, `team_notes` → `radar_notes`, `team_id` → `radar_id`; delete `slug` from both table definitions; the URL sentence becomes "URLs have the form `/<kind>/<id>`, so renaming never affects a link."
- §3 rules: "Position of (radar, practice) as of date D", "Active radars at D", and the org aggregate wording — `count(active radars at D)`.
- §5 API table: every `/teams` path → `/radars`, and `GET /radar/frames` → `GET /api/frames` with `scope=org|radar:{id}`.
- §6 UI: the radar screen paths become `/radar/org` and `/radar/<id>`; the practice page becomes `/practices/<id>`; "Teams using it (N)" becomes "Who’s using it (N)"; the switcher is a radar switcher.
- §8 testing: `services/frames.py` bullets referring to teams become radars.

**Leave untouched** the purpose statement in §1 — "helps development teams in one organization discover, document and share the AI tools, skills, practices and workflows they use" — and the §2 audience row "Many teams in one org". Both mean human teams and both remain true.

- [ ] **Step 2: Update the frontend README**

Replace any `/radar/team/<id>-<slug>` or `/teams` reference with the new paths, and any "team" that means the entity with "radar".

- [ ] **Step 3: Verify the docs match the code**

```bash
cd /Users/hans/dev/ai-radar
grep -n "teams\|team_id\|team:" docs/superpowers/specs/2026-09-13-ai-radar-design.md
```
Expected: only the §1 purpose sentence and the §2 audience row, both about human teams.

- [ ] **Step 4: Commit**

```bash
git add docs frontend/README.md
git commit -m "docs: update the design spec and README for the Radar rename"
```

---

## Verification

The rename is done when all of these hold:

```bash
cd /Users/hans/dev/ai-radar/backend && uv run pytest
cd /Users/hans/dev/ai-radar/frontend && npm run typecheck && npm test && npm run check:api && npm run build
grep -rin "team" frontend/src backend/app backend/tests
grep -rin "slug" frontend/src backend/app          # no output
```

The `team` grep is scoped to source and tests (not just `backend/app`, since a rename that
never checked `backend/tests` can leave renamed identifiers' old names behind there
unnoticed) and is expected to return exactly four lines from three locations: two are
prose about a human team, not the renamed entity, and deliberately preserved (see Task 9's
brief, §1 Purpose in `docs/superpowers/specs/2026-09-13-ai-radar-design.md` for the same
distinction); the other two are the name and body of one deliberately preserved test that
asserts the OLD `team:1` scope string is now rejected:

```
frontend/src/lib/categories.ts:24:    description: 'a habit your team applies while working',
frontend/src/pages/CatalogPage.test.tsx:102:      /a habit your team applies while working/i,
backend/tests/api/test_radar.py:152:def test_frames_endpoint_rejects_team_scope(client):
backend/tests/api/test_radar.py:153:    assert client.get("/api/frames", params={"scope": "team:1"}).status_code == 422
```

Any other `team` hit is a real regression; a `grep` returning no output at all is not
achievable and was never the right bar.
