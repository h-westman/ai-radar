# AI Radar Plan 3: Delivery Implementation Plan (CI, Azure, Deploy, E2E)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put AI Radar under continuous integration, document the manual Azure setup, deploy every green `main` to Azure App Service through GitHub Actions with OIDC, and guard the main flow with a Playwright smoke test.

**Architecture:** Two workflows. `ci.yml` runs backend, frontend and end-to-end jobs on every PR and push. `deploy.yml` runs after CI succeeds on `main`: it builds the SPA into `backend/app/static`, exports `requirements.txt` for Azure's Oryx build, and zip-deploys `backend/` to the Web App. The App Service start command runs `backend/startup.sh`, which applies Alembic migrations and starts gunicorn.

**Tech Stack:** GitHub Actions, `astral-sh/setup-uv`, `actions/setup-node`, `azure/login@v2` (OIDC), `azure/webapps-deploy@v3`, Azure App Service (Linux, Python 3.12), Azure Database for PostgreSQL Flexible Server 16, Application Insights, Playwright, actionlint

**Spec:** `docs/superpowers/specs/2026-09-13-ai-radar-design.md`. Read §4 (architecture) and §9 (deployment).

**Series:** This is Plan 3 of 3. **Prerequisites: Plans 1 and 2 are complete.** Tasks 1–3 only need the npm and uv scripts that already exist. Task 4 (end-to-end) relies on the UI labels defined in Plan 2.

## Global Constraints

- Versions: Python 3.12, Node 22, and PostgreSQL 16 (CI service container `postgres:16`).
- **No stored secrets.** Azure access uses OIDC federated credentials. The repository **variables** (not secrets) are `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` and `AZURE_WEBAPP_NAME`.
- Deploys happen only from `main`, only after the `CI` workflow succeeds, and only for the commit CI tested (`workflow_run.head_sha`).
- App settings on the Web App:
  - `DATABASE_URL`, in the form `postgresql+psycopg://<user>:<url-encoded-password>@<server>.postgres.database.azure.com:5432/airadar?sslmode=require`
  - `SCM_DO_BUILD_DURING_DEPLOYMENT=true`
- The App Service startup command is `sh startup.sh`.
- There is a single production environment: App Service plan Linux **B1**, and PostgreSQL Flexible Server **Burstable B1ms**.
- Workflows must pass `actionlint`.

## File Structure

```
.github/workflows/ci.yml        backend + frontend (+ e2e after Task 4) on PR/push
.github/workflows/deploy.yml    build SPA, export requirements, OIDC login, zip deploy
backend/startup.sh              migrations + gunicorn (App Service start command)
docs/azure-setup.md             manual portal guide + verification + optional Entra auth
e2e/                            Playwright project (Task 4)
  package.json, playwright.config.ts, tests/smoke.spec.ts
```

---

### Task 1: CI workflow for backend and frontend

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes:
  - Backend: `uv run ruff check .`, `uv run ruff format --check .`, and `uv run pytest` with `TEST_DATABASE_URL`
  - Frontend: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run check:api`, which calls `uv` in `backend/`
- Produces: a workflow named **`CI`**, with job ids `backend` and `frontend`. Task 3's `deploy.yml` triggers on `workflows: [CI]`, and Task 4 adds an `e2e` job.

- [ ] **Step 1: Write the workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  backend:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: airadar
          POSTGRES_PASSWORD: airadar
          POSTGRES_DB: airadar_test
        ports:
          - 5433:5432
        options: >-
          --health-cmd "pg_isready -U airadar"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    defaults:
      run:
        working-directory: backend
    env:
      TEST_DATABASE_URL: postgresql+psycopg://airadar:airadar@localhost:5433/airadar_test
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v6
        with:
          python-version: "3.12"
          enable-cache: true
      - run: uv sync --locked
      - run: uv run ruff check .
      - run: uv run ruff format --check .
      - run: uv run pytest -q

  frontend:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v6
        with:
          python-version: "3.12"
          enable-cache: true
      - run: uv sync --locked
        working-directory: backend
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - name: Generated API types are up to date
        run: npm run check:api
```

- [ ] **Step 2: Lint the workflow**

Run: `docker run --rm -v "$PWD:/repo" --workdir /repo rhysd/actionlint:latest -color`
Expected: no output, exit code 0.

- [ ] **Step 3: Check the CI commands locally**

Run: `docker compose up -d db && (cd backend && uv sync --locked && uv run ruff check . && uv run ruff format --check . && uv run pytest -q) && (cd frontend && npm ci && npm run typecheck && npm test && npm run build && npm run check:api)`
Expected: every command succeeds, and `check:api` shows no diff. If `ruff format --check` fails, run `uv run ruff format .` and commit that first as `style: ruff format`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run backend and frontend checks on pull requests and main"
```

Once the repository is pushed to GitHub, open the Actions tab. Expected: the `CI` run shows green `backend` and `frontend` jobs.

---

### Task 2: App Service startup script and the Azure setup guide

**Files:**
- Create: `backend/startup.sh`, `docs/azure-setup.md`

**Interfaces:**
- Produces:
  - `backend/startup.sh`, used by the App Service startup command `sh startup.sh`
  - The repository variables and app settings listed in Global Constraints, which Task 3 consumes

- [ ] **Step 1: Write the startup script**

`backend/startup.sh`:
```sh
#!/bin/sh
# App Service (Linux, Python) start command: `sh startup.sh`
# `python -m` guarantees we use the interpreter of the virtualenv Oryx built.
set -e
python -m alembic upgrade head
exec python -m gunicorn app.main:app \
  --workers 2 \
  --worker-class uvicorn_worker.UvicornWorker \
  --bind "0.0.0.0:${PORT:-8000}" \
  --timeout 120 \
  --access-logfile -
```

Run: `chmod +x backend/startup.sh`

Smoke-test it locally against the dev database:

Run: `cd backend && DATABASE_URL=postgresql+psycopg://airadar:airadar@localhost:5433/airadar PORT=8010 uv run sh startup.sh` in one shell, then `curl -s localhost:8010/api/health` in another.
Expected: the log includes `Running upgrade` (or nothing if the database is already migrated) and `Booting worker`, and curl prints `{"status":"ok"}`. Stop the server with Ctrl+C.

- [ ] **Step 2: Write the Azure setup guide**

`docs/azure-setup.md`:
````markdown
# Azure setup (manual, portal)

One production environment. Estimated cost: about $25–30 a month
(App Service B1 about $13, PostgreSQL B1ms about $13–15, Application Insights mostly free tier).

Pick one short prefix and use it everywhere below, for example `airadar`.

## 1. Resource group
Portal → **Resource groups** → **Create**
- Name: `rg-airadar`, Region: e.g. *Sweden Central* (use the same region for everything).

## 2. PostgreSQL Flexible Server
Portal → **Azure Database for PostgreSQL flexible servers** → **Create**
- Server name: `psql-airadar`, Version: **16**
- Workload type: *Development* → Compute: **Burstable B1ms**, Storage 32 GiB
- Authentication: *PostgreSQL authentication only*. Admin user `airadar`, plus a strong password (store it in your password manager).
- Networking: **Public access**, tick **Allow public access from any Azure service within Azure to this server**. Add no other firewall rules, unless you want your own IP for occasional `psql`.
- Create.

After it's created:
1. **Server parameters** → search `azure.extensions` → tick **PG_TRGM** → **Save**.
   (Migrations run `CREATE EXTENSION IF NOT EXISTS pg_trgm` and fail without this.)
2. **Databases** → **Add** → name `airadar`.

## 3. App Service plan + Web App
Portal → **App Services** → **Create** → **Web App**
- Name: `app-airadar` (this becomes `https://app-airadar.azurewebsites.net`)
- Publish: **Code**, Runtime stack: **Python 3.12**, OS: **Linux**, Region: same as above
- Pricing plan: create a new plan **Basic B1**
- Monitoring: **Enable Application Insights → Yes** (creates a new resource)
- Create.

Then open the Web App:
1. **Settings → Environment variables → App settings**. Add:
   - `DATABASE_URL` = `postgresql+psycopg://airadar:<URL-ENCODED-PASSWORD>@psql-airadar.postgres.database.azure.com:5432/airadar?sslmode=require`
     (URL-encode the password: `python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1], safe=''))" 'your-password'`)
   - `SCM_DO_BUILD_DURING_DEPLOYMENT` = `true`
   → **Apply**.
2. **Settings → Configuration → General settings**
   - Startup Command: `sh startup.sh`
   - **Always on: On**
   → **Save**.
3. **Monitoring → Health check** → Enable, Path: `/api/health` → **Save**.

## 4. GitHub → Azure (OIDC, no secrets)
1. Portal → **Microsoft Entra ID → App registrations → New registration** → name `gh-airadar-deploy` → Register.
   Note the **Application (client) ID** and **Directory (tenant) ID**.
2. In that app registration: **Certificates & secrets → Federated credentials → Add credential**
   - Scenario: **GitHub Actions deploying Azure resources**
   - Organization / Repository: your GitHub org and repo
   - Entity type: **Branch**, Branch: `main`
   - Name: `main-branch` → Add.
3. Web App → **Access control (IAM) → Add role assignment** → Role **Website Contributor** →
   Members: *User, group, or service principal* → select `gh-airadar-deploy` → Review + assign.
4. GitHub repo → **Settings → Secrets and variables → Actions → Variables** → add:
   - `AZURE_CLIENT_ID` = application (client) ID
   - `AZURE_TENANT_ID` = directory (tenant) ID
   - `AZURE_SUBSCRIPTION_ID` = your subscription ID (Portal → Subscriptions)
   - `AZURE_WEBAPP_NAME` = `app-airadar`

## 5. First deploy and verification
1. Merge to `main`. `CI` runs, then `Deploy` runs.
2. Web App → **Monitoring → Log stream**. Expect:
   - Oryx: `Running pip install...` during deployment
   - At start: `Running upgrade  -> 0001, initial schema`, then gunicorn `Booting worker` twice.
   If you see `alembic: not found` or `No module named alembic`, the virtualenv wasn't active.
   Confirm the startup command is exactly `sh startup.sh`. It uses `python -m`, which resolves to the venv's Python.
3. `curl https://app-airadar.azurewebsites.net/api/health` → `{"status":"ok"}`
4. Open `https://app-airadar.azurewebsites.net/`. The app loads and redirects to `/radar/org`.

## 6. Optional later: require company sign-in (Entra ID)
Web App → **Settings → Authentication → Add identity provider → Microsoft**
- Create a new app registration, supported account types: *Current tenant – Single tenant*
- Restrict access: **Require authentication**, unauthenticated requests: **HTTP 302 redirect**
No code changes are needed. Every page and `/api/*` call then requires an employee login.
(Also exclude `/api/health` from authentication if the health check starts failing:
Authentication → edit → *Excluded paths*, if your portal offers it. Otherwise point the health check at a path the platform allows.)
````

- [ ] **Step 3: Review the guide against the spec**

Check `docs/azure-setup.md` against spec §4 and §9. It must cover the resource group, the B1 plan, a Python 3.12 Web App with the startup command, the health check, Always On, PostgreSQL 16 B1ms with PG_TRGM and Azure-services firewall access, the `airadar` database, both app settings, Application Insights, the OIDC federated credential for `main`, Website Contributor, the four repository variables, the cost estimate, and optional Entra sign-in.
Expected: every item is present.

- [ ] **Step 4: Commit**

```bash
git add backend/startup.sh docs/azure-setup.md
git commit -m "docs: add Azure setup guide and App Service startup script"
```

---

### Task 3: Deploy workflow (after CI on main, OIDC, zip deploy)

**Files:**
- Create: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: the `CI` workflow name (Task 1), `backend/startup.sh` (Task 2), and the repository variables from `docs/azure-setup.md` §4
- Produces: a workflow named **`Deploy`**

- [ ] **Step 1: Write the workflow**

`.github/workflows/deploy.yml`:
```yaml
name: Deploy

on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]

permissions:
  contents: read
  id-token: write

concurrency:
  group: deploy-production
  cancel-in-progress: false

jobs:
  deploy:
    if: github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push'
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://${{ vars.AZURE_WEBAPP_NAME }}.azurewebsites.net
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.workflow_run.head_sha }}

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: frontend/package-lock.json

      - name: Build SPA into backend/app/static
        run: |
          cd frontend
          npm ci
          npm run build
          rm -rf ../backend/app/static
          cp -r dist ../backend/app/static

      - uses: astral-sh/setup-uv@v6
        with:
          python-version: "3.12"

      - name: Export requirements.txt for Oryx
        working-directory: backend
        run: uv export --locked --no-dev --no-hashes --no-emit-project --format requirements-txt > requirements.txt

      - uses: azure/login@v2
        with:
          client-id: ${{ vars.AZURE_CLIENT_ID }}
          tenant-id: ${{ vars.AZURE_TENANT_ID }}
          subscription-id: ${{ vars.AZURE_SUBSCRIPTION_ID }}

      - uses: azure/webapps-deploy@v3
        with:
          app-name: ${{ vars.AZURE_WEBAPP_NAME }}
          package: backend

      - name: Smoke check
        run: |
          for i in $(seq 1 30); do
            if curl -fsS "https://${{ vars.AZURE_WEBAPP_NAME }}.azurewebsites.net/api/health"; then exit 0; fi
            sleep 10
          done
          echo "Health check did not pass within 5 minutes" >&2
          exit 1
```

- [ ] **Step 2: Lint the workflow**

Run: `docker run --rm -v "$PWD:/repo" --workdir /repo rhysd/actionlint:latest -color`
Expected: no output, exit code 0.

- [ ] **Step 3: Dry-run the build and export steps locally**

Run:
```bash
(cd frontend && npm ci && npm run build && rm -rf ../backend/app/static && cp -r dist ../backend/app/static)
(cd backend && uv export --locked --no-dev --no-hashes --no-emit-project --format requirements-txt > requirements.txt && grep -E '^(fastapi|alembic|gunicorn|uvicorn-worker|psycopg)' requirements.txt)
(cd backend && uv run python -c "from app.main import create_app; from fastapi.testclient import TestClient; print(TestClient(create_app()).get('/radar/org').text[:15])")
```
Expected: `requirements.txt` lists fastapi, alembic, gunicorn, uvicorn-worker and psycopg. The last command prints the start of the built `index.html` (`<!doctype html>`).

Then remove the local artifacts: `rm -rf backend/app/static backend/requirements.txt`. Both are ignored or generated. Add `backend/requirements.txt` to `.gitignore` if it isn't already listed.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy.yml .gitignore
git commit -m "ci: deploy main to Azure App Service after CI passes"
```

After the Azure setup from Task 2 exists and this is merged to `main`, check the Actions tab. Expected: `Deploy` succeeds, including its smoke check, and `docs/azure-setup.md` §5 verifies cleanly.

---

### Task 4: Playwright smoke test and the CI `e2e` job

This task implements spec §8's end-to-end flow against the real stack: FastAPI serving the built SPA, on a dedicated `airadar_e2e` database.

**Files:**
- Create: `e2e/package.json`, `e2e/playwright.config.ts`, `e2e/tests/smoke.spec.ts`
- Modify: `docker/initdb/01-test-db.sql`, `.github/workflows/ci.yml` (add the `e2e` job)

**Interfaces:**
- Consumes:
  - The accessible names defined in Plan 2, Tasks 3 and 7–11: "Team name", "Create team", "Who is editing?", "Your name", "+ New practice", "Name", "Summary", "Create practice", "Did you mean…", `Place <name>`, the bubble `aria-label` `"<name>, Core"`, "Timeline", "Edit here", "Lock", "Play", "Pause", "Open page", "Edit summary", "Done", "1 unsaved change", "Save", "History", "Revisions", "Created by …", "Revert to this" and "Overview"
  - Plan 1, Task 13: a team timeline covers at least 12 months, so a new team has past frames to backdate into
- Produces:
  - `npm run build:app` and `npm test` in `e2e/`
  - The CI job `e2e`, which needs `backend` and `frontend`

- [ ] **Step 1: Create the e2e database**

Append to `docker/initdb/01-test-db.sql`:
```sql
CREATE DATABASE airadar_e2e;
```
Init scripts run only when the volume is first created, so for an existing local volume also run:
`docker compose exec db psql -U airadar -c 'CREATE DATABASE airadar_e2e;'`
Expected: `CREATE DATABASE`, or an "already exists" error, which is fine.

- [ ] **Step 2: Create the Playwright project**

`e2e/package.json`:
```json
{
  "name": "ai-radar-e2e",
  "private": true,
  "scripts": {
    "build:app": "cd ../frontend && npm run build && rm -rf ../backend/app/static && cp -r dist ../backend/app/static",
    "test": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "^1.48.0"
  }
}
```

`e2e/playwright.config.ts`:
```ts
import { defineConfig, devices } from '@playwright/test'

const databaseUrl =
  process.env.E2E_DATABASE_URL ?? 'postgresql+psycopg://airadar:airadar@localhost:5433/airadar_e2e'

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://localhost:8000', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'cd ../backend && uv run alembic upgrade head && uv run uvicorn app.main:app --port 8000',
    url: 'http://localhost:8000/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { DATABASE_URL: databaseUrl },
  },
})
```

Run: `cd e2e && npm install && npx playwright install chromium`
Expected: this creates `e2e/package-lock.json` and downloads Chromium.

- [ ] **Step 3: Write the smoke test**

`e2e/tests/smoke.spec.ts`:
```ts
import { expect, test } from '@playwright/test'

// Unique names per run so a reused database never hits duplicate-name conflicts.
const run = Date.now().toString(36)
const TEAM = `E2E Team ${run}`
const PRACTICE = `E2E Practice ${run}`

test('create, place, backdate, play, edit and revert', async ({ page }) => {
  // 1. Create a team. The first write asks who is editing.
  await page.goto('/teams')
  await page.getByRole('textbox', { name: 'Team name' }).fill(TEAM)
  await page.getByRole('button', { name: 'Create team' }).click()
  const namePrompt = page.getByRole('dialog', { name: 'Who is editing?' })
  await namePrompt.getByLabel('Your name').fill('E2E Bot')
  await namePrompt.getByRole('button', { name: 'Save' }).click()
  const teamLink = page.getByRole('list', { name: 'Teams' }).getByRole('link', { name: TEAM })
  await expect(teamLink).toBeVisible()

  // 2. Create a practice, then see it suggested when typing a similar name.
  await page.goto('/practices')
  await page.getByRole('button', { name: '+ New practice' }).click()
  await page.getByRole('textbox', { name: 'Name' }).fill(PRACTICE)
  await page.getByRole('textbox', { name: 'Summary' }).fill('Created by the smoke test')
  await page.getByRole('button', { name: 'Create practice' }).click()
  await expect(page).toHaveURL(/\/practices\/\d+-e2e-practice-/)
  await page.goto('/practices')
  await page.getByRole('button', { name: '+ New practice' }).click()
  await page.getByRole('textbox', { name: 'Name' }).fill(`${PRACTICE} again`)
  await expect(page.getByText('Did you mean…')).toBeVisible()

  // 3. Place it on the team radar from the tray (centre = Core).
  await page.goto('/teams')
  await teamLink.click()
  const bubble = page.locator(`[aria-label="${PRACTICE}, Core"]`)
  await page.getByRole('button', { name: `Place ${PRACTICE}` }).click()
  await expect(bubble).toBeVisible()

  // 4. Backdate: jump to the first month, unlock, and place it there too.
  await page.getByRole('slider', { name: 'Timeline' }).focus()
  await page.keyboard.press('Home')
  await page.getByRole('button', { name: 'Edit here' }).click()
  await expect(page.getByText(/Changes are recorded for that date/)).toBeVisible()
  await page.getByRole('button', { name: `Place ${PRACTICE}` }).click()
  await expect(bubble).toBeVisible()
  await page.getByRole('button', { name: 'Lock' }).click()

  // 5. Play the animation through to the end.
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible({ timeout: 30_000 })

  // 6. Open the practice from the drawer, edit it inline and save.
  await bubble.click()
  await page
    .getByRole('complementary', { name: `Details for ${PRACTICE}` })
    .getByRole('link', { name: 'Open page' })
    .click()
  await page.getByRole('button', { name: 'Edit summary' }).click()
  await page.getByRole('textbox', { name: 'Summary' }).fill('Edited by the smoke test')
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText('1 unsaved change')).toBeVisible()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('1 unsaved change')).toBeHidden()
  await expect(page.getByText('Edited by the smoke test')).toBeVisible()

  // 7. Revert to the first revision.
  await page.getByRole('tab', { name: 'History' }).click()
  await page.getByRole('list', { name: 'Revisions' }).getByRole('button', { name: /^Created by/ }).click()
  await page.getByRole('button', { name: 'Revert to this' }).click()
  await expect(page.getByText('Reverted to the selected version.')).toBeVisible()
  await page.getByRole('tab', { name: 'Overview' }).click()
  await expect(page.getByText('Created by the smoke test')).toBeVisible()
})
```

- [ ] **Step 4: Build the app and run the test**

Run: `cd e2e && npm run build:app && npm test`
Expected: `1 passed`. A failure here is a real integration bug. Open `npx playwright show-report` and the trace, fix the underlying cause in the backend or frontend (with a unit test that reproduces it), then re-run. Don't loosen the end-to-end assertions to get a pass.

If Plan 2 Task 6's Crepe round-trip test was skipped because jsdom couldn't run it, raise that with the user now instead of adding browser-only editor checks here.

- [ ] **Step 5: Add the CI job**

Append this job under `jobs:` in `.github/workflows/ci.yml`:
```yaml
  e2e:
    runs-on: ubuntu-latest
    needs: [backend, frontend]
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: airadar
          POSTGRES_PASSWORD: airadar
          POSTGRES_DB: airadar_e2e
        ports:
          - 5433:5432
        options: >-
          --health-cmd "pg_isready -U airadar"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      E2E_DATABASE_URL: postgresql+psycopg://airadar:airadar@localhost:5433/airadar_e2e
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v6
        with:
          python-version: "3.12"
          enable-cache: true
      - run: uv sync --locked
        working-directory: backend
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: |
            frontend/package-lock.json
            e2e/package-lock.json
      - run: npm ci
        working-directory: frontend
      - run: npm ci
        working-directory: e2e
      - run: npx playwright install --with-deps chromium
        working-directory: e2e
      - run: npm run build:app
        working-directory: e2e
      - run: npm test
        working-directory: e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: e2e/playwright-report
          retention-days: 7
```

Run: `docker run --rm -v "$PWD:/repo" --workdir /repo rhysd/actionlint:latest -color`
Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add e2e docker/initdb/01-test-db.sql .github/workflows/ci.yml
git commit -m "test(e2e): add Playwright smoke test for the main flow and run it in CI"
```

---

## Plan 3 completion check

- [ ] `actionlint` passes on both workflows.
- [ ] CI is green on a PR: `backend`, `frontend` and `e2e`.
- [ ] After merging to `main`, `Deploy` succeeds and its smoke check passes.
- [ ] `docs/azure-setup.md` §5 verification passes against the live site: health returns ok, the app loads, and the log stream shows migrations and gunicorn workers.
- [ ] Spec §11's open item is settled: the log stream confirms `startup.sh` ran Alembic inside the Oryx virtualenv.
