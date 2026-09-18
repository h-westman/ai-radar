# Renaming Team to Radar — Design Spec

- **Date:** 2026-09-17
- **Status:** Pending review
- **Amends:** `2026-09-13-ai-radar-design.md` (sections 3, 5, 6 and 8)

## 1. Purpose

The entity called **Team** is the owner of one radar's worth of placements and notes. It
carries no membership, no people and no permissions — only a name, a description and the
positions recorded against it. "Team" therefore overstates what it is, and it excludes a
legitimate use: one person keeping a radar of their own.

This spec renames that entity to **Radar** at every layer, and replaces the
`<id>-<slug>` URL form with a bare id.

Both changes are cheap today and expensive later. `.github/` is empty, `docs/azure-setup.md`
does not exist, and there is a single migration (`0001_initial`). Nothing is deployed, there
is no production data, and there are no external API consumers.

## 2. Decisions summary

| Topic | Decision |
|---|---|
| New noun | **Radar**. A radar is whatever owns a set of placements — a team, or one person. |
| Depth | Every layer: database, migration, API, generated types, URLs, UI copy, tests, docs. |
| Org scope | **Unchanged.** Still `scope=org`, still labelled "Whole organization". |
| URLs | Bare ids: `/radar/12`, `/practices/45`. No slugs anywhere. |
| Slug column | **Dropped** from `radars` and `practices`, along with `services/slugs.py`. |
| Migration | `0001_initial.py` is rewritten in place. No rename migration. |
| Personal radars | Out of scope. No new entity, no membership model, no grouped switcher. |

## 3. Vocabulary

| Now | Becomes |
|---|---|
| Team (entity) | Radar |
| Teams (nav item, list page) | Radars |
| `team_id` | `radar_id` |
| `team_positions` | `radar_positions` |
| `teams_count`, `teams` (bubble size) | `radars_count`, `radars` |
| "3 teams" (catalog count) | "3 radars" |
| "Teams using it" (sidebar heading) | "Who’s using it" — names no entity at all |
| Team note | Radar note |

The heading **"How we use it"** is kept as-is. It reads correctly for a team and is only
mildly odd for one person, and no shorter alternative was better.

The word "team" survives **only in prose where it means an actual human team** — for example
the purpose statement "helps development teams in one organization discover, document and
share the AI tools, skills, practices and workflows they use", which remains true and
remains as written. Documentation is hand-edited, never swept.

## 4. Data model

| Now | Becomes |
|---|---|
| table `teams` | `radars` |
| table `team_notes` | `radar_notes` |
| `team_notes.team_id`, `placements.team_id` | `radar_id` |
| index `uq_teams_name_lower` | `uq_radars_name_lower` |
| constraint `team_notes_pkey` | `radar_notes_pkey` |
| `revisions.entity_type` value `'team'` | `'radar'` |
| `revisions.entity_id` for notes, `"<team_id>:<practice_id>"` | `"<radar_id>:<practice_id>"` |

`revisions.entity_type` is a plain `String(20)`, not a PostgreSQL enum, so the value changes
without a type migration.

**The `slug` column is dropped** from both `radars` and `practices`. It was never used for
lookup — only written on create, update and revert, and read to build links. With bare-id
URLs nothing reads it. `app/services/slugs.py` and its tests are deleted; `slugify` is four
lines and recoverable from git history if readable URLs are ever wanted.

**Migration.** `0001_initial.py` is rewritten in place so the schema reads as though the
entity was always called a radar. A `0002_rename` migration would be permanent archaeology
of a name no database ever held. Local development requires `docker compose down -v` once.

## 5. API

| Now | Becomes |
|---|---|
| `GET /api/teams` | `GET /api/radars` |
| `POST /api/teams` | `POST /api/radars` |
| `PATCH /api/teams/{team_id}` | `PATCH /api/radars/{radar_id}` |
| `POST /api/teams/{team_id}/archive` \| `/restore` | `POST /api/radars/{radar_id}/archive` \| `/restore` |
| `GET`/`PUT /api/teams/{team_id}/notes/{practice_id}` | `GET`/`PUT /api/radars/{radar_id}/notes/{practice_id}` |
| `GET /api/radar/frames?scope=org\|team:{id}` | `GET /api/frames?scope=org\|radar:{id}` |

The frames endpoint moves from `/api/radar/frames` to **`/api/frames`**. Once the entity is
called a radar, `/api/radar/frames` sitting beside `/api/radars/{id}` invites the reading
that frames are a subresource of one radar, which they are not — they are computed for a
scope. This is the one path change not forced by the rename; reject it at review if you
would rather keep `/api/radar/frames`.

**Pydantic schemas** (`schemas.py`): `TeamOut` → `RadarOut`, `TeamCreate` → `RadarCreate`,
`TeamUpdate` → `RadarUpdate`, `TeamPositionOut` → `RadarPositionOut`, `PracticeTeamUsage` →
`PracticeRadarUsage`.

**Renamed response fields:** `PracticeDetail.teams` → `.radars`,
`PracticeListItem.teams_count` → `.radars_count`, `PointOut.teams` → `.radars`,
`PointOut.team_positions` → `.radar_positions`, and within the usage and position models
`team_id`/`team_name` → `radar_id`/`radar_name`.

**Removed response fields:** `slug` from `RadarOut`, `PracticeOut` and `PracticeListItem`
(`PracticeDetail` inherits the removal from `PracticeOut`), and `team_slug` from the practice
usage list. They existed only to build links.

**SQLAlchemy models** (`models.py`): `Team` → `Radar`, `TeamNote` → `RadarNote`.

**Service types** (`services/frames.py`): `TeamRow` → `RadarRow`, `TeamPosition` →
`RadarPosition`; `active_team_ids` → `active_radar_ids`, `load_team_rows` →
`load_radar_rows`, `scope_team_id` → `scope_radar_id`.

`openapi.json` and `src/api/schema.d.ts` are regenerated with `npm run gen:api`, after which
the TypeScript compiler enumerates every frontend break.

## 6. URLs and routing

| Now | Becomes |
|---|---|
| `/radar/team/12-platform` | `/radar/12` |
| `/radar/org` | unchanged |
| `/practices/45-claude-code` | `/practices/45` |
| `/teams` | `/radars` |

`/radar/org` cannot collide with `/radar/12`: React Router ranks the static `/radar/org`
segment above the dynamic `/radar/:radarId`, and `parseId` returns null for `'org'` (the
route itself matches any single segment, not digits only - do not simplify `parseId` away
on the assumption that the router alone protects this).

`src/lib/refs.ts` is replaced by `src/lib/ids.ts` exporting a single
`parseId(raw: string | undefined): number | null` that returns null unless the value is a
positive integer. `toRef` disappears entirely, along with every call site that built a
display slug for a link.

The localStorage key `aiRadar.lastTeam` becomes `aiRadar.lastRadar`. A stale value under the
old key is ignored, and the app falls back to the org radar. `aiRadar.editedBy` and the
editor-mode key are untouched.

## 7. Frontend

Renamed symbols: `useTeams`/`useTeam`/`useCreateTeam`/`useUpdateTeam`/`useSetTeamArchived`
→ the `Radar` equivalents; `TeamDot` → `RadarDot`; `teamPositions` → `radarPositions`;
`teamWritable` → `radarWritable`; `teamRef` → `radarId`; `LAST_TEAM_KEY` → `LAST_RADAR_KEY`.

**`TeamsPage.tsx` becomes `RadarListPage.tsx`**, not `RadarsPage.tsx`. The codebase already
has `RadarPage` (one radar), `RadarChart`, `renderRadar.ts` and `radar.css`, all meaning the
visualization; `RadarsPage` sits one character from `RadarPage` and would be misread.

### UI copy

The nav item "Teams" becomes "Radars". The switcher's `aria-label` is already "Radar" and
needs no change.

**"Teams using it" becomes "Who’s using it"** — with a typographic apostrophe (U+2019),
matching `doesn’t` and `Can’t` elsewhere in the codebase. It changes in both places the
string appears:

| File | Now | Becomes |
|---|---|---|
| `PracticePage.tsx:328` | `Teams using it (3)` | `Who’s using it (3)` |
| `PracticePage.tsx:327` | `aria-label="Teams using it"` | `aria-label="Who’s using it"` |
| `Drawer.tsx:49` | `<h3>Teams using it</h3>` | `<h3>Who’s using it</h3>` |

The heading deliberately names no entity. "Who’s using it" reads correctly whether a radar
belongs to a team or to one person, which is exactly the assertion this rename exists to
stop making — so it is better copy than either "Teams using it" or "On N radars".

The `aria-label` and the visible heading must stay identical, because
`PracticePage.test.tsx:84` selects the aside by that accessible name.

Counts that do name the entity keep it: `CatalogPage.tsx:79`'s per-row
`aria-label="3 teams"` becomes `"3 radars"`.

## 8. Out of scope, and one known consideration

Not in this work: personal radars as a distinct type, any ownership or membership model, and
the grouped switcher that would separate team radars from personal ones. Each needs a
distinction that will not exist after this change.

**Known consideration — the org average.** `services/frames.py` computes org adoption as
`sum(adoption over radars on the radar) / count(active radars)`, so a radar that has not
placed a practice counts as zero. Renaming does not change this: the set of active radars
today is exactly the set of active teams. It becomes a real decision only if personal radars
are added later, because one person's radar would then dilute org adoption as much as a
twenty-person team's. Recorded here so the next person does not have to rediscover it.

## 9. Execution order and verification

Bottom-up, each layer verified before the next. Replacement is scripted per layer and
case-aware, never one sweep across the repo.

1. `models.py`, then rewrite `0001_initial.py`; drop `slug` and `services/slugs.py`.
2. `services/` — `frames.py`, `positions.py`, `revisions.py`.
3. `schemas.py`, then `routers/`.
4. **Gate:** `uv run pytest` green.
5. `npm run gen:api`.
6. `src/api/` types and hooks, then `src/lib/ids.ts`, then components and pages.
7. Test files and fixtures.
8. **Gate:** `npm run typecheck`, `npm test` (125 tests), `npm run check:api`, `npm run build`.
9. Hand-edit `2026-09-13-ai-radar-design.md` sections 3, 5, 6 and 8, plus `frontend/README.md`.

Existing test assertions that encode URLs (`/practices/10-claude-code`,
`/radar/team/...`) change with their routes. No test is deleted to make the rename pass:
a test that no longer compiles is rewritten against the new names, not dropped.
