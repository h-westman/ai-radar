# AI Radar — Design Spec

- **Date:** 2026-09-13
- **Status:** Approved in brainstorming, pending written-spec review

## 1. Purpose

AI Radar is an interactive AI engineering practice tool. It helps development teams in one organization discover, document and share the AI **tools, skills, practices and workflows** they use.

It has two parts:

1. **A practices editor.** A shared, org-wide catalog of entries with structured fields and markdown guidance, plus each team's own "how we use it" notes.
2. **A radar.** A bubble chart with **Adoption / Usage** on the X axis and **Perceived Value** on the Y axis. There is one radar per team and one aggregated org radar, and both can be **animated over time**.

## 2. Decisions summary

| Topic | Decision |
|---|---|
| Audience | Many teams in one org |
| Positioning | **Team consensus.** A team agrees on and drags one position per practice. |
| Catalog | **Shared org catalog.** One entry per practice, with team-specific notes. |
| History | **Continuous.** Every placement is an append-only event. Backdating is supported through `effective_at`. |
| Entry content | Fixed fields plus a markdown body, and one team note per team per practice |
| Governance | Anyone can add or edit. Revisions, archiving and restore protect against mistakes and vandalism. |
| Access | **No login, unlisted public URL.** Entra sign-in can be added later through App Service authentication (a config change only). |
| Hosting | Azure App Service (Linux) and Azure Database for PostgreSQL Flexible Server, production only |
| Backend | Python 3.12, FastAPI, SQLAlchemy 2, Alembic, uv |
| Frontend | React, TypeScript, Vite, React Router, TanStack Query, D3 |
| Infrastructure | Created manually in the Azure portal and documented in `docs/azure-setup.md` |
| CI/CD | GitHub Actions, deploying to Azure through OIDC federated credentials |
| Scale | Small: up to about 10 teams and about 100 practices |

## 3. Domain and data model (PostgreSQL)

All tables use integer identity primary keys. Timestamps are `timestamptz` stored in UTC and displayed in the browser's local time. URLs have the form `/<kind>/<id>-<slug>`: the id is used for lookup and the slug is only cosmetic, so renaming never breaks a link.

### Tables

**`teams`**
- `id`, `name`, `slug`, `description` (text, nullable)
- `version` (int, starts at 1)
- `created_at`, `updated_at`, `archived_at` (nullable)
- Unique index on `lower(name)`

**`practices`** (the shared catalog)
- `id`, `name`, `slug`
- `category`: enum `tool | skill | practice | workflow`
- `summary`: text, at most 280 characters
- `body_md`: text, at most 100 KB
- `tags`: `text[]`
- `links`: `jsonb`, a list of `{label, url}` where each url is http or https
- `version`, `created_at`, `updated_at`, `archived_at`
- Unique index on `lower(name)`, which applies to archived rows too
- Trigram index on `name` (`pg_trgm`)

**`team_notes`**
- Primary key `(team_id, practice_id)`
- `body_md` (at most 100 KB), `version`, `updated_at`, `edited_by`

**`placements`** (append-only, never updated or deleted)
- `id`, `team_id`, `practice_id`
- `adoption`: smallint 0–100
- `value`: smallint 0–100
- `removed`: bool, default false
- `effective_at`: defaults to now and must not be in the future
- `recorded_at`: always now
- `edited_by`
- Index on `(team_id, practice_id, effective_at desc, recorded_at desc)`

**`revisions`**
- `id`
- `entity_type`: enum `team | practice | team_note`
- `entity_id`: text. Holds the id for teams and practices, and `"<team_id>:<practice_id>"` for notes.
- `action`: enum `create | update | archive | restore | revert`
- `snapshot`: `jsonb`, the full entity as it is after the change
- `edited_by`, `created_at`

`edited_by` is taken from the `X-Edited-By` request header. It is trimmed, limited to 100 characters, and stored as null (shown as "anonymous") when absent.

### Rules

**Position of (team, practice) as of date D**
- It is the placement with `effective_at <= D`, sorted by `effective_at desc`, then `recorded_at desc`, then `id desc`, with the first row winning.
- If that placement has `removed = true`, or there is none, the practice is not on the team's radar at D.
- The team's current radar is its position as of now.

**Corner labels**
- The quadrants are split at 50.
- adoption ≥ 50 and value ≥ 50 → **Core**
- adoption < 50 and value ≥ 50 → **Hidden gems** (shown in the singular, "Hidden gem", for a single team's position)
- adoption ≥ 50 and value < 50 → **Question it**
- adoption < 50 and value < 50 → **Parked**
- The UI describes positions only by these labels. The axes are qualitative (low → high) and raw numbers are never shown.

**Active teams at D**
- Teams with `archived_at` null or later than D, that have at least one placement (for any practice) with `effective_at <= D`.
- A team created today that backdates placements to March therefore counts from March.

**Org aggregate for a practice at D**, where `U` is the set of active teams whose position as of D is on the radar:
- `adoption = sum(team adoption over U) / count(active teams at D)`. Active teams not in U count as 0.
- `value = mean(team value over U)`
- `teams = |U|`. This number sets the bubble size.
- A practice is shown only if `|U| ≥ 1`.

**Archived practices** are excluded from every radar and frame, current and historical. Restoring one brings its history back.

**Archived teams** are excluded from frames from their `archived_at` onwards, and hidden from the team switcher.

**Frames**
- Given a scope, a range `[from, to]` and a step (`week` or `month`), the frame dates are:
  - the end of each period in UTC (Sunday 23:59:59 for weeks, the last day of the month at 23:59:59 for months), from the period containing `from` to the period containing `to`,
  - with the last frame replaced by *now* when `to` is today.
- The default range runs from the earliest `effective_at` in the scope to now, with a monthly step.
- For a **team** scope, the default range always covers at least the last 12 months, so a new team has past months to backdate into during its first session.

**Backdated edits**
- A move made while the timeline is unlocked at frame date F is saved with `effective_at = F` and `recorded_at = now`.
- A later placement still wins for later dates.

**Removal** is a placement with `removed = true`, carrying the last adoption and value so the bubble can animate out. Undo writes a new placement with the previous position.

**Revisions**
- Every create, update, archive, restore or revert of a team, practice or team note writes one revision.
- A practice-page Save is one update, so it writes one revision.
- Reverting to an old revision writes that snapshot's editable fields back as the current state, increments `version`, and records a `revert` revision.

**Optimistic concurrency.** Updates to teams, practices and team notes must send the `version` they were based on. If it doesn't match the current version, the server returns 409 with the current entity. Placements never conflict.

**Duplicate suggestions.** `similar(name)` returns up to 5 practices, archived ones included, with trigram similarity ≥ 0.3, ordered by similarity.

## 4. Architecture

- **One App Service** on Linux with Python 3.12 runs gunicorn with uvicorn workers (2 workers).
  - FastAPI serves `/api/*` and the built React app from `backend/app/static/`.
  - Any path that isn't under `/api` and isn't a file falls back to `index.html`, so client-side routes work.
- **Startup command:** `alembic upgrade head && gunicorn -w 2 -k uvicorn_worker.UvicornWorker app.main:app`. Migrations run inside Azure, so the database never has to accept connections from CI.
- **PostgreSQL Flexible Server**, Burstable B1ms:
  - The `pg_trgm` extension is enabled through the `azure.extensions` server parameter.
  - Public access is limited to Azure services, and SSL is required.
- **Configuration** comes from App Service app settings: `DATABASE_URL`, and `SCM_DO_BUILD_DURING_DEPLOYMENT=true`.
- **Server-side frames.** All position and aggregation rules live in one Python module (`services/frames.py`). The browser only renders and animates the frames it receives.

### Repository layout

```
backend/
  pyproject.toml, uv.lock
  alembic.ini, migrations/
  app/
    main.py            app factory, static files + SPA fallback, rate limiting
    config.py, db.py
    models.py          SQLAlchemy models
    schemas.py         Pydantic request and response models
    routers/           teams.py, practices.py, notes.py, placements.py, revisions.py, radar.py, health.py
    services/          frames.py, revisions.py, similarity.py, labels.py
  tests/
frontend/
  package.json, vite.config.ts
  src/
    api/               generated OpenAPI types + typed fetch client
    chart/             pure logic (scales, frames, trails, labels) + D3 renderer + React wrapper
    editor/            Rich/Markdown editor component, sanitized markdown renderer
    pages/             Radar, PracticePage, Catalog, Teams
    components/        Drawer, Tray, Timeline, UnsavedChangesBar, NamePrompt, Toasts
  e2e/                 Playwright tests
docs/
  azure-setup.md
  superpowers/specs/
docker-compose.yml     local Postgres
.github/workflows/     ci.yml, deploy.yml
```

### Local development

- `docker compose up -d db` starts Postgres.
- `uv run alembic upgrade head` then `uv run fastapi dev` starts the backend.
- `npm run dev` starts the frontend, with Vite forwarding `/api` to the backend.

## 5. API

The API uses REST and JSON under `/api`. Every write accepts the `X-Edited-By` header. FastAPI generates the OpenAPI spec, and the frontend's TypeScript types are generated from it with `openapi-typescript`.

| Method and path | Purpose |
|---|---|
| `GET /teams?include_archived=` | List teams |
| `POST /teams` | Create a team → 201, or 409 if the name exists |
| `PATCH /teams/{id}` | Update the name or description (requires `version`) |
| `POST /teams/{id}/archive`, `POST /teams/{id}/restore` | Archive or restore a team |
| `GET /practices?q=&category=&tag=&include_archived=` | Catalog list, including how many teams use each practice |
| `GET /practices/similar?name=` | Duplicate suggestions |
| `POST /practices` | Create → 201, or 409 with the existing entry |
| `GET /practices/{id}` | Full entry, plus each team's current corner label and note |
| `PATCH /practices/{id}` | Partial update of the fields (requires `version`) |
| `POST /practices/{id}/archive`, `POST /practices/{id}/restore` | Archive or restore a practice |
| `GET /teams/{team_id}/notes/{practice_id}` | Read a team's note |
| `PUT /teams/{team_id}/notes/{practice_id}` | Create or update a note (requires `version`, or 0 to create) |
| `POST /placements` | Body `{team_id, practice_id, adoption, value, removed?, effective_at?}` → 201. When `removed` is true, `adoption` and `value` are optional and the server copies them from the position as of `effective_at`. Removing a practice that isn't on the radar returns 422. |
| `GET /revisions?entity_type=&entity_id=` | Revision history, newest first |
| `POST /revisions/{id}/revert` | Revert the entity to that revision |
| `GET /radar/frames?scope=org\|team:{id}&from=&to=&step=week\|month` | Animation frames (see below) |
| `GET /health` | 200 when the database is reachable |

**Frames response**

```json
{
  "scope": "org",
  "step": "month",
  "frames": [
    {
      "date": "2026-03-31T23:59:59Z",
      "points": [
        {
          "practice_id": 12,
          "adoption": 44,
          "value": 81,
          "teams": 4,
          "team_positions": [{"team_id": 3, "adoption": 70, "value": 90}]
        }
      ]
    }
  ],
  "practices": {"12": {"name": "Claude Code", "category": "tool"}}
}
```

- `team_positions` is present only for the org scope. It drives the spread shown when an org bubble is selected.
- In the team scope, `teams` is always 1.
- The API returns adoption and value as numbers, because the chart needs them. The UI simply never displays them.

## 6. UI

### Radar screen (`/radar/org`, `/radar/team/<id>-<slug>`)

**Top bar**
- Team/org switcher (the last team is remembered in localStorage)
- Category filter and search
- "+ New practice"
- A chip showing "your name"

**Left tray** (team scope only)
- Catalog practices that are not on the radar at the displayed date, with a text filter.
- Drag an item onto the chart to place it where you drop it.
- Each item also has a "Place" button that puts it at the centre, for keyboard users and as a fallback.

**Chart** (SVG rendered by D3)
- The axes read "Adoption / usage →" and "Perceived value →", with no numbers.
- Dashed midlines, and faint corner labels *Hidden gems* (top-left), *Core* (top-right), *Question it* (bottom-right) and *Parked* (bottom-left).
- Colour shows the category: tool, skill, practice or workflow.
- In the team scope:
  - Every bubble is the same size.
  - Dragging a bubble writes a placement when it is dropped. The bubble moves immediately and snaps back with a toast if the save fails.
  - A selected bubble can be nudged with the arrow keys, and the new position is saved after a short pause.
  - Dropping a bubble outside the plot area removes the practice, and a toast offers Undo.
- In the org scope:
  - The chart is read-only.
  - Bubble size scales with `teams`.
  - Selecting a bubble fans out one small dot per team at that team's position, each with a thin line to the org bubble and the team's name. Everything else is dimmed.

**Detail drawer** (right side, opens when a bubble is clicked)
- Category chip, name and summary.
- The position as a corner label.
- Team scope: the team's "how we use it" note, which can be edited in place using the same editor.
- Org scope: a list of the teams using the practice, with their corner labels.
- Actions: Open page, History, and (team scope only) Remove from radar.

**Timeline** (under the chart)
- ▶ play and pause, a scrubber over the frame dates, and a week/month step selector.
- A large, faint label shows the current frame date behind the chart.
- During playback bubbles glide between frames (about 800 ms per frame), and bubbles that enter or leave fade in and out.
- Selected bubbles (shift-click selects several) show a trail: a polyline through their earlier frame positions, with date labels.
- Editing is locked when the scrubber is not at the latest frame. In the team scope an **"Edit here"** control unlocks it:
  - the chart gets an amber border and a banner reads "Editing <period>";
  - placements are saved with `effective_at` set to that frame date;
  - it stays unlocked while you scrub, until you lock it again or return to the latest frame.

### Practice page (`/practices/<id>-<slug>`)

- **Main column:** category chip, name, summary, tags, links and the guidance body.
- **Inline editing:** clicking any field turns it into an inline editor. Changes are only staged, and a sticky bar shows "N unsaved changes · Discard · Save".
  - Save sends a single `PATCH`, which writes one revision.
  - Leaving the page with staged changes triggers an in-app confirmation (and `beforeunload` for tab closes).
- **Side column:** "Teams using it (N)", listing each team with its corner label and the first lines of its note.
- **History tab:** revisions with their time, author and action. Selecting one shows that snapshot rendered, with a "Revert to this" button.
- **Archive and restore** controls are shown.

### Editor component (guidance body and team notes)

- A **Rich / Markdown** toggle. The chosen mode is remembered in localStorage.
- **Rich** mode is a markdown-native WYSIWYG editor.
- **Markdown** mode has Write and Preview tabs, with a toolbar for bold, heading, list, link and code that inserts markdown.
- Content is always stored as GFM markdown.
- All rendering goes through `react-markdown`, `remark-gfm` and `rehype-sanitize`.
- **Library choice** (Milkdown or TipTap with markdown support) is settled by a short spike during implementation. The deciding factor is how faithfully each converts to and from markdown for headings, lists, links, code blocks and GFM tables.

### Other pages

- **Catalog (`/practices`):** a table with name, category, tags and the number of teams using each practice. It has search, category and tag filters, and a "show archived" toggle.
  - "+ New practice" opens a form. After a short pause while you type the name, it shows "Did you mean…" suggestions.
  - A 409 response offers to open the existing entry, or to restore it if it is archived.
- **Teams (`/teams`):** list, create, rename, archive and restore teams.
- **Name prompt:** a modal shown before the first write in a browser. It stores `aiRadar.editedBy` in localStorage.
  - "Skip" stores an empty value, so the person is not asked again and edits are shown as anonymous.
  - Clicking the top-bar chip changes the name.

## 7. Error handling and safety

**Validation**
- Pydantic returns 422 errors, and the UI shows them next to the relevant fields.
- Enforced on the server:
  - adoption and value are within 0–100
  - `effective_at` is not in the future
  - links use http or https
  - `summary` is at most 280 characters, and `body_md` and notes are at most 100 KB
  - no more than 20 tags, each at most 40 characters

**Conflicts**
- A duplicate name returns 409 with the existing entity.
- A version mismatch returns 409 with the current entity. The UI says "Someone else saved changes", keeps your staged edits, and lets you review and re-apply them against the new version.

**Not found.** Unknown ids return 404. Archived entities are still returned by `GET` with `archived_at` set, and the UI shows an "Archived · Restore" banner.

**Client behaviour**
- Queries are retried with backoff.
- Failed writes show a toast.
- Drags are applied optimistically and roll back if the save fails.

**Protection for the public URL**
- All markdown is sanitized when rendered. No raw HTML passes through.
- Request bodies are limited to 256 KB.
- Writes are rate-limited per client IP (the first hop of `X-Forwarded-For`) at 60 per minute, using slowapi with in-memory storage. The counter is kept per worker process, so the effective limit is approximate (up to 120 per minute with 2 workers). That is acceptable, since the goal is to slow down abuse, not to meter usage precisely.
- Nothing is ever hard-deleted.

**Operations**
- `/api/health` is configured as the App Service health check.
- Structured logs go to the App Service log stream.
- Application Insights is turned on through the portal with automatic instrumentation and no code changes (see the setup guide).

## 8. Testing

**Backend** (pytest)
- Tests run against real PostgreSQL: Docker Compose locally and a service container in CI.
- Each test runs inside a transaction that is rolled back afterwards.
- `services/frames.py` gets the most thorough unit tests:
  - "as of" logic, including the `effective_at`/`recorded_at`/`id` tie-break
  - removed placements, and undo after a removal
  - which teams count as active: backdated teams, archived teams
  - the org average counting non-users as 0, and team counts
  - week and month boundaries, and the final "now" frame
  - archived practices being excluded
- Also covered:
  - revision writing and revert
  - version conflicts
  - duplicate suggestions
  - validation limits
  - rate limiting, with a test override
  - API tests through `httpx.AsyncClient`

**Frontend** (vitest and Testing Library)
- Pure chart logic is unit-tested: scales, frame interpolation, trail building and corner labels.
- Component tests cover the Drawer, the UnsavedChangesBar, the Rich/Markdown toggle, the NamePrompt and the Timeline lock/unlock.
- D3 rendering is only smoke-tested.

**End-to-end** (Playwright smoke test in CI)
1. Create a team.
2. Create a practice, and check that a duplicate suggestion appears.
3. Place it from the tray.
4. Unlock a past month and backdate a move.
5. Play the animation.
6. Edit the practice inline and save.
7. Revert to the earlier revision.

**CI** also runs ruff, `tsc --noEmit`, and a check that the generated OpenAPI types are up to date.

Implementation follows TDD.

## 9. Deployment

### `.github/workflows/ci.yml` (pull requests and pushes)
1. Backend: `uv sync`, ruff, then pytest with a Postgres 16 service container.
2. Frontend: `npm ci`, `tsc`, vitest, and the check for stale generated types.
3. End-to-end: start the stack and run Playwright.

### `.github/workflows/deploy.yml` (push to `main`, after CI passes)
1. Build the frontend and copy `dist/` into `backend/app/static/`.
2. Run `uv export --no-dev > backend/requirements.txt` so Oryx can install the Python packages.
3. Log in with `azure/login` (OIDC). The `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` and `AZURE_SUBSCRIPTION_ID` values are stored as repository variables.
4. Package `backend/` with `azure/webapps-deploy`.

### `docs/azure-setup.md` (manual portal steps)

**Resources**
- Resource group
- App Service plan: Linux, Basic B1
- Web App: Python 3.12, with the startup command, health check path `/api/health`, and "Always On" enabled
- PostgreSQL Flexible Server: Burstable B1ms and PostgreSQL 16, with `pg_trgm` allowed, the firewall set to allow Azure services, and a database called `airadar`
- App settings: `DATABASE_URL` and `SCM_DO_BUILD_DURING_DEPLOYMENT`
- Application Insights

**GitHub OIDC**
- An Entra app registration with a federated credential for `repo:<org>/<repo>:ref:refs/heads/main`.
- The *Website Contributor* role on the Web App.

**Other**
- Cost estimate: about $25–30 a month.
- Optional: turning on Entra ID sign-in later through App Service Authentication.

## 10. Out of scope (YAGNI)

- Authentication, user accounts and roles (Entra sign-in can be added at the edge later)
- Individual ratings and voting, and telemetry-driven adoption
- Comments, notifications and email digests
- Import and export (a CSV export is a likely first addition)
- Multiple organizations or tenants
- Staging environments, deployment slots and infrastructure as code
- Comparing teams side by side as small multiples

## 11. Open items for implementation planning

- An editor library spike (Milkdown or TipTap), using the criteria in §6.
- Confirming how App Service's Oryx build interacts with the startup command, specifically that the virtual environment is active when `alembic` runs. This is checked on the first deploy.
