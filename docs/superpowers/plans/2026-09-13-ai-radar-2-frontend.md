# AI Radar Plan 2: Frontend Implementation Plan

*Historical record, superseded by the Team->Radar rename of 2026-09-17. Current API paths
live in `docs/superpowers/specs/2026-09-17-radar-rename-design.md`.*

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the React app. It has team and org radars (a draggable, animated D3 bubble chart with tray, drawer and timeline), the practice page with inline editing and a Rich/Markdown editor, the catalog, and the teams page, all running against the Plan 1 API.

**Architecture:** A Vite single-page app. Server state goes through TanStack Query hooks built on a typed `openapi-fetch` client, whose types are generated from the backend's OpenAPI spec. The chart is split into pure geometry and frame functions (unit-tested) and a D3 renderer driven by a thin React wrapper. The pages compose small, focused components, and CSS Modules sit on shared design tokens.

**Tech Stack:** React 19, TypeScript, Vite, React Router 7 (data router), TanStack Query 5, D3 7, openapi-fetch and openapi-typescript, react-markdown with remark-gfm and rehype-sanitize, Milkdown Crepe, Vitest with Testing Library, jsdom and MSW 2

**Spec:** `docs/superpowers/specs/2026-09-13-ai-radar-design.md`. Read §6 (UI) and §7 (errors) first.

**Series:** This is Plan 2 of 3. **Prerequisite: Plan 1 is complete**, meaning the backend runs and `uv run python -m scripts.export_openapi` works. Plan 3 adds end-to-end tests, CI/CD and Azure.

## Global Constraints

- All frontend commands run from `frontend/`. Node 22 LTS, npm.
- All API calls go through `src/api/client.ts` (`api`), which uses the generated `paths` types. Never hand-write request or response types that the OpenAPI spec already covers.
- The `X-Edited-By` header is sent on non-GET requests as `encodeURIComponent(name)`, and omitted when the name is empty or missing.
- localStorage keys are `aiRadar.editedBy`, `aiRadar.lastTeam` and `aiRadar.editorMode`. Every access is wrapped in try/catch.
- **The axes are qualitative.** Raw adoption or value numbers are never shown in the UI. Axis titles read "Adoption / usage →" and "Perceived value →".
- Chart corner labels are *Hidden gems* (top-left), *Core* (top-right), *Question it* (bottom-right) and *Parked* (bottom-left). Per-team labels come from the API in singular form ("Hidden gem").
- There is one colour per category: tool, skill, practice and workflow. The "editing past" state uses its own colour, distinct from every category colour.
- Playback glides about **800 ms per frame**, and bubbles fade in and out when they enter or leave.
- Markdown is rendered **only** through `MarkdownView` (react-markdown + remark-gfm + rehype-sanitize). No `dangerouslySetInnerHTML` anywhere.
- No `window.alert`, `window.confirm` or `window.prompt`. Use the in-app `ConfirmDialog`. The one exception is `beforeunload`.
- Routes:
  - `/` redirects to the last team or `/radar/org`
  - `/radar/org`
  - `/radar/team/:teamRef`
  - `/practices`
  - `/practices/:practiceRef`
  - `/teams`
  - Refs take the form `<id>-<slug>`, and only the id is used for lookup.
- Tests use Vitest, Testing Library and MSW, and API mocks are defined through MSW handlers. Don't mock `fetch` directly.
- **Deliberate deviation from spec §6:** the global top bar holds only the scope switcher, the Catalog and Teams links, and the name chip.
  - The category filter and "Highlight practice" search live in the radar page's own toolbar, because they only apply there.
  - "+ New practice" lives on the catalog page. The tray's empty state links to it.

## File Structure

```
frontend/
  package.json, vite.config.ts, tsconfig*.json, index.html
  openapi.json                    generated from backend; committed
  src/
    main.tsx                      QueryClientProvider + RouterProvider + ToastProvider
    router.tsx                    route table (createBrowserRouter)
    api/
      schema.d.ts                 generated (openapi-typescript); committed
      client.ts                   api client, edited-by middleware, ApiError, unwrap, isConflict
      types.ts                    friendly aliases over components["schemas"]
      hooks.ts                    query keys, queries, mutations
    lib/
      storage.ts                  safe localStorage get/set
      editedBy.ts                 name for X-Edited-By
      refs.ts                     toRef(id, slug) / idFromRef(ref)
      useDebounced.ts
    styles/tokens.css, styles/global.css
    components/
      AppShell.tsx/.module.css    top bar (scope switcher, name chip) + <Outlet/>
      NamePrompt.tsx              first-write modal + useEnsureName()
      Toasts.tsx                  ToastProvider + useToast()
      ConfirmDialog.tsx
      CategoryChip.tsx
      Drawer.tsx, Tray.tsx, Timeline.tsx, UnsavedChangesBar.tsx
    chart/
      geometry.ts                 plot box, scales, radius, corner labels
      frames.ts                   frame lookup, interpolation, trails, off-radar list
      renderRadar.ts              D3 renderer (no React)
      RadarChart.tsx              React wrapper
    editor/
      MarkdownView.tsx, MarkdownEditor.tsx, RichEditor.tsx, Editor.tsx
    pages/
      RadarPage.tsx, PracticePage.tsx, CatalogPage.tsx, TeamsPage.tsx, NotFound.tsx
    test/
      setup.ts, server.ts, render.tsx, fixtures.ts
```

---

### Task 1: Frontend scaffold, generated API types and the typed client

**Files:**
- Create: `frontend/` (Vite react-ts template), `frontend/openapi.json` (generated), `frontend/src/api/schema.d.ts` (generated)
- Create: `frontend/src/api/client.ts`, `frontend/src/lib/storage.ts`, `frontend/src/lib/editedBy.ts`, `frontend/src/lib/refs.ts`, `frontend/src/test/setup.ts`, `frontend/src/test/server.ts`
- Modify: `frontend/vite.config.ts`, `frontend/package.json` (scripts), `frontend/src/App.tsx`, `frontend/src/main.tsx`
- Delete: `frontend/src/App.css`, `frontend/src/index.css`, `frontend/src/assets/react.svg`, `frontend/public/vite.svg`
- Test: `frontend/src/api/client.test.ts`, `frontend/src/lib/refs.test.ts`

**Interfaces:**
- Produces:
  - `api`: an `openapi-fetch` client typed with `paths`, whose base URL is `window.location.origin`
  - `editedByMiddleware`
  - `class ApiError extends Error { status: number; body: unknown }`
  - `unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T`, which throws `ApiError` when the response isn't ok
  - `isConflict(e: unknown): e is ApiError` (status 409)
  - `conflictCurrent<T>(e: ApiError): T | null`
  - `readString(key: string): string | null` and `writeString(key: string, value: string): void`, both safe
  - `getEditedBy(): string | null`, `setEditedBy(name: string): void` and `hasChosenName(): boolean`. An empty string counts as chosen.
  - `toRef(id: number, slug: string): string` and `idFromRef(ref: string | undefined): number | null`
  - npm scripts: `dev`, `build`, `test`, `typecheck`, `gen:api`, `check:api`

- [ ] **Step 1: Scaffold the app and install dependencies**

Run from the repo root:
```bash
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
npm install react-router @tanstack/react-query d3 openapi-fetch react-markdown remark-gfm rehype-sanitize @milkdown/crepe
npm install -D openapi-typescript vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom msw @types/d3
rm -f src/App.css src/index.css src/assets/react.svg public/vite.svg
```

Set the scripts:
```bash
npm pkg set scripts.test="vitest run"
npm pkg set scripts.typecheck="tsc -b"
npm pkg set scripts.gen:api="cd ../backend && uv run python -m scripts.export_openapi > ../frontend/openapi.json && cd ../frontend && openapi-typescript openapi.json -o src/api/schema.d.ts"
npm pkg set scripts.check:api="npm run gen:api && git diff --exit-code -- openapi.json src/api/schema.d.ts"
```

Run: `npm run gen:api`
Expected: `frontend/openapi.json` and `frontend/src/api/schema.d.ts` are created, and `grep -c '"/api/radar/frames"' src/api/schema.d.ts` prints `1`.

- [ ] **Step 2: Configure Vite and the test setup**

`frontend/vite.config.ts`:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8000' } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
  },
})
```

`frontend/src/test/server.ts`:
```ts
import { setupServer } from 'msw/node'

export const server = setupServer()
```

`frontend/src/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './server'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
  localStorage.clear()
})
afterAll(() => server.close())
```

- [ ] **Step 3: Write the failing tests**

`frontend/src/lib/refs.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { idFromRef, toRef } from './refs'

describe('refs', () => {
  it('formats id-slug refs', () => {
    expect(toRef(12, 'claude-code')).toBe('12-claude-code')
  })

  it('parses the id and ignores the slug', () => {
    expect(idFromRef('12-claude-code')).toBe(12)
    expect(idFromRef('12-renamed-since')).toBe(12)
    expect(idFromRef('12')).toBe(12)
  })

  it('returns null for garbage', () => {
    expect(idFromRef(undefined)).toBeNull()
    expect(idFromRef('abc')).toBeNull()
    expect(idFromRef('-3-x')).toBeNull()
  })
})
```

`frontend/src/api/client.test.ts`:
```ts
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../test/server'
import { setEditedBy } from '../lib/editedBy'
import { api, ApiError, conflictCurrent, isConflict, unwrap } from './client'

function captureEditedBy() {
  const seen: (string | null)[] = []
  server.use(
    http.post('/api/teams', ({ request }) => {
      seen.push(request.headers.get('x-edited-by'))
      return HttpResponse.json({ id: 1 }, { status: 201 })
    }),
    http.get('/api/teams', ({ request }) => {
      seen.push(request.headers.get('x-edited-by'))
      return HttpResponse.json([])
    }),
  )
  return seen
}

describe('api client', () => {
  it('sends the URL-encoded name on writes only', async () => {
    const seen = captureEditedBy()
    setEditedBy('Åsa Lind')
    await api.POST('/api/teams', { body: { name: 'X' } })
    await api.GET('/api/teams')
    expect(seen).toEqual(['%C3%85sa%20Lind', null])
  })

  it('omits the header when the name was skipped', async () => {
    const seen = captureEditedBy()
    setEditedBy('')
    await api.POST('/api/teams', { body: { name: 'X' } })
    expect(seen).toEqual([null])
  })

  it('unwrap throws ApiError with the body for conflicts', async () => {
    server.use(
      http.post('/api/teams', () =>
        HttpResponse.json({ detail: 'exists', current: { id: 7 } }, { status: 409 }),
      ),
    )
    const error = await Promise.resolve(api.POST('/api/teams', { body: { name: 'X' } }))
      .then(unwrap)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(isConflict(error)).toBe(true)
    expect(conflictCurrent<{ id: number }>(error as ApiError)).toEqual({ id: 7 })
  })

  it('unwrap returns data for ok responses', async () => {
    server.use(http.get('/api/teams', () => HttpResponse.json([{ id: 1 }])))
    expect(unwrap(await api.GET('/api/teams'))).toEqual([{ id: 1 }])
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL, `Failed to resolve import "./refs"` and `"./client"`.

- [ ] **Step 5: Implement the lib modules and the client**

`frontend/src/lib/storage.ts`:
```ts
export function readString(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable: private mode, blocked, etc. */
  }
}
```

`frontend/src/lib/editedBy.ts`:
```ts
import { readString, writeString } from './storage'

const KEY = 'aiRadar.editedBy'

export function getEditedBy(): string | null {
  return readString(KEY)
}

export function setEditedBy(name: string): void {
  writeString(KEY, name.trim())
}

/** True once the person has entered a name OR explicitly skipped (empty string). */
export function hasChosenName(): boolean {
  return getEditedBy() !== null
}
```

`frontend/src/lib/refs.ts`:
```ts
export function toRef(id: number, slug: string): string {
  return `${id}-${slug}`
}

export function idFromRef(ref: string | undefined): number | null {
  const match = ref?.match(/^(\d+)(?:-|$)/)
  return match ? Number(match[1]) : null
}
```

`frontend/src/api/client.ts`:
```ts
import createClient, { type Middleware } from 'openapi-fetch'
import { getEditedBy } from '../lib/editedBy'
import type { paths } from './schema'

export const editedByMiddleware: Middleware = {
  onRequest({ request }) {
    const name = getEditedBy()
    if (name && request.method !== 'GET') {
      request.headers.set('X-Edited-By', encodeURIComponent(name))
    }
    return request
  },
}

export const api = createClient<paths>({ baseUrl: window.location.origin })
api.use(editedByMiddleware)

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API request failed with status ${status}`)
  }
}

export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (!result.response.ok) throw new ApiError(result.response.status, result.error)
  return result.data as T
}

export function isConflict(e: unknown): e is ApiError {
  return e instanceof ApiError && e.status === 409
}

export function conflictCurrent<T>(e: ApiError): T | null {
  const body = e.body as { current?: T | null } | undefined
  return body?.current ?? null
}
```

Replace `frontend/src/App.tsx` with a placeholder. Task 3 replaces it with the router.
```tsx
export default function App() {
  return <h1>AI Radar</h1>
}
```

Replace `frontend/src/main.tsx`:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 6: Run the tests, typecheck and build**

Run: `npm test && npm run typecheck && npm run build`
Expected: 7 tests pass, `tsc` reports no errors, and `vite build` writes `dist/`.

- [ ] **Step 7: Commit**

```bash
git add frontend
git commit -m "feat(frontend): scaffold Vite app with generated API types and typed client"
```

### Task 2: API type aliases, query hooks and test fixtures

**Files:**
- Create: `frontend/src/api/types.ts`, `frontend/src/api/hooks.ts`, `frontend/src/test/render.tsx`, `frontend/src/test/fixtures.ts`
- Test: `frontend/src/api/hooks.test.tsx`

**Interfaces:**
- Consumes: `api`, `unwrap`, `ApiError` from Task 1
- Produces:
  - `src/api/types.ts` exports these types: `Team`, `TeamCreate`, `TeamUpdate`, `Practice`, `PracticeDetail`, `PracticeListItem`, `PracticeCreate`, `PracticeUpdate`, `PracticeTeamUsage`, `Category`, `Link`, `Note`, `Placement`, `PlacementCreate`, `Revision`, `EntityType`, `FramesResponse`, `Frame`, `Point`, `Step`. It also exports the constant `CATEGORIES: Category[]`.
  - `src/api/hooks.ts` exports:
    - `keys`, the query-key factory
    - `type PracticeFilters = { q?: string; category?: Category; tag?: string; includeArchived?: boolean }`
    - Queries:
      - `useTeams(includeArchived?)`
      - `useTeam(id | null)`
      - `usePractices(filters)`
      - `usePractice(id | null)`
      - `useSimilar(name)`
      - `useNote(teamId | null, practiceId | null)`, which returns `Note | null` and treats a 404 as null
      - `useRevisions(type, entityId | null)`
      - `useFrames(scope: string, step: Step)`
    - Mutations:
      - `useCreateTeam()`
      - `useUpdateTeam()` with variables `{ id, body }`
      - `useSetTeamArchived()` with variables `{ id, archived }`
      - `useCreatePractice()`
      - `useUpdatePractice()` with variables `{ id, body }`
      - `useSetPracticeArchived()` with variables `{ id, archived }`
      - `usePlace()` with a `PlacementCreate`
      - `usePutNote()` with variables `{ teamId, practiceId, version, body_md }`
      - `useRevert()` with a `revisionId`
  - `src/test/render.tsx` exports `createTestQueryClient()` and `queryWrapper(client?)`. Task 3 adds `renderRoutes`.
  - `src/test/fixtures.ts` exports `team(over?)`, `practice(over?)`, `listItem(over?)`, `detail(over?)`, `note(over?)`, `revision(over?)` and `framesResponse(over?)`

- [ ] **Step 1: Write the type aliases**

`frontend/src/api/types.ts`:
```ts
import type { components } from './schema'

type S = components['schemas']

export type Team = S['TeamOut']
export type TeamCreate = S['TeamCreate']
export type TeamUpdate = S['TeamUpdate']
export type Practice = S['PracticeOut']
export type PracticeDetail = S['PracticeDetail']
export type PracticeListItem = S['PracticeListItem']
export type PracticeCreate = S['PracticeCreate']
export type PracticeUpdate = S['PracticeUpdate']
export type PracticeTeamUsage = S['PracticeTeamUsage']
export type Category = Practice['category']
export type Link = Practice['links'][number]
export type Note = S['NoteOut']
export type Placement = S['PlacementOut']
export type PlacementCreate = S['PlacementCreate']
export type Revision = S['RevisionOut']
export type EntityType = Revision['entity_type']
export type FramesResponse = S['FramesOut']
export type Frame = FramesResponse['frames'][number]
export type Point = Frame['points'][number]
export type Step = FramesResponse['step']

export const CATEGORIES: Category[] = ['tool', 'skill', 'practice', 'workflow']
```

Run: `npx tsc -b`
Expected: no errors. If a schema name is missing, open `src/api/schema.d.ts` and search `schemas: {` to find the exact generated names. FastAPI may suffix shared models with `-Input` or `-Output`. Adjust **only this file** to match.

- [ ] **Step 2: Write the test helpers and fixtures**

`frontend/src/test/render.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  })
}

export function queryWrapper(client = createTestQueryClient()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}
```

`frontend/src/test/fixtures.ts`:
```ts
import type {
  FramesResponse,
  Note,
  Practice,
  PracticeDetail,
  PracticeListItem,
  Revision,
  Team,
} from '../api/types'

const T0 = '2026-01-01T00:00:00Z'

export const team = (over: Partial<Team> = {}): Team => ({
  id: 1,
  name: 'Platform',
  slug: 'platform',
  description: null,
  version: 1,
  created_at: T0,
  updated_at: T0,
  archived_at: null,
  ...over,
})

export const practice = (over: Partial<Practice> = {}): Practice => ({
  id: 10,
  name: 'Claude Code',
  slug: 'claude-code',
  category: 'tool',
  summary: 'Agentic coding assistant.',
  body_md: '## Getting started\n\nInstall it.',
  tags: ['agentic'],
  links: [],
  version: 1,
  created_at: T0,
  updated_at: T0,
  archived_at: null,
  ...over,
})

export const listItem = (over: Partial<PracticeListItem> = {}): PracticeListItem => ({
  id: 10,
  name: 'Claude Code',
  slug: 'claude-code',
  category: 'tool',
  summary: 'Agentic coding assistant.',
  tags: ['agentic'],
  archived_at: null,
  teams_count: 0,
  ...over,
})

export const detail = (over: Partial<PracticeDetail> = {}): PracticeDetail => ({
  ...practice(),
  teams: [],
  ...over,
})

export const note = (over: Partial<Note> = {}): Note => ({
  team_id: 1,
  practice_id: 10,
  body_md: 'We use it for refactors.',
  version: 1,
  updated_at: T0,
  edited_by: null,
  ...over,
})

export const revision = (over: Partial<Revision> = {}): Revision => ({
  id: 100,
  entity_type: 'practice',
  entity_id: '10',
  action: 'create',
  snapshot: { summary: 'Agentic coding assistant.' },
  edited_by: null,
  created_at: T0,
  ...over,
})

export const framesResponse = (over: Partial<FramesResponse> = {}): FramesResponse => ({
  scope: 'team:1',
  step: 'month',
  frames: [
    {
      date: '2026-01-31T23:59:59Z',
      points: [{ practice_id: 10, adoption: 70, value: 80, teams: 1 }],
    },
    {
      date: '2026-02-28T23:59:59Z',
      points: [
        { practice_id: 10, adoption: 75, value: 85, teams: 1 },
        { practice_id: 11, adoption: 20, value: 60, teams: 1 },
      ],
    },
  ],
  practices: {
    '10': { name: 'Claude Code', category: 'tool' },
    '11': { name: 'Spec-driven dev', category: 'practice' },
  },
  ...over,
})
```

- [ ] **Step 3: Write the failing hook tests**

`frontend/src/api/hooks.test.tsx`:
```tsx
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { framesResponse, note, team } from '../test/fixtures'
import { createTestQueryClient, queryWrapper } from '../test/render'
import { server } from '../test/server'
import { isConflict } from './client'
import { useFrames, useNote, usePlace, useTeams, useUpdatePractice } from './hooks'

describe('query hooks', () => {
  it('useTeams loads teams', async () => {
    server.use(http.get('/api/teams', () => HttpResponse.json([team()])))
    const { result } = renderHook(() => useTeams(), { wrapper: queryWrapper() })
    await waitFor(() => expect(result.current.data).toEqual([team()]))
  })

  it('useNote resolves to null on 404', async () => {
    server.use(
      http.get('/api/teams/1/notes/10', () =>
        HttpResponse.json({ detail: 'Note not found' }, { status: 404 }),
      ),
    )
    const { result } = renderHook(() => useNote(1, 10), { wrapper: queryWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
  })

  it('useNote returns the note', async () => {
    server.use(http.get('/api/teams/1/notes/10', () => HttpResponse.json(note())))
    const { result } = renderHook(() => useNote(1, 10), { wrapper: queryWrapper() })
    await waitFor(() => expect(result.current.data).toEqual(note()))
  })

  it('usePlace refetches frames', async () => {
    let frameCalls = 0
    server.use(
      http.get('/api/radar/frames', () => {
        frameCalls += 1
        return HttpResponse.json(framesResponse())
      }),
      http.post('/api/placements', () => HttpResponse.json({ id: 1 }, { status: 201 })),
    )
    const client = createTestQueryClient()
    const { result } = renderHook(
      () => ({ frames: useFrames('team:1', 'month'), place: usePlace() }),
      { wrapper: queryWrapper(client) },
    )
    await waitFor(() => expect(result.current.frames.isSuccess).toBe(true))
    await act(() =>
      result.current.place.mutateAsync({ team_id: 1, practice_id: 10, adoption: 5, value: 5 }),
    )
    await waitFor(() => expect(frameCalls).toBe(2))
  })

  it('useUpdatePractice surfaces conflicts as ApiError', async () => {
    server.use(
      http.patch('/api/practices/10', () =>
        HttpResponse.json({ detail: 'changed', current: { version: 3 } }, { status: 409 }),
      ),
    )
    const { result } = renderHook(() => useUpdatePractice(), { wrapper: queryWrapper() })
    const error = await result.current
      .mutateAsync({ id: 10, body: { version: 1, summary: 'x' } })
      .catch((e: unknown) => e)
    expect(isConflict(error)).toBe(true)
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm test -- src/api/hooks.test.tsx`
Expected: FAIL, `Failed to resolve import "./hooks"`.

- [ ] **Step 5: Implement the hooks**

`frontend/src/api/hooks.ts`:
```ts
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import { api, unwrap } from './client'
import type {
  Category,
  EntityType,
  PlacementCreate,
  PracticeCreate,
  PracticeUpdate,
  Step,
  TeamCreate,
  TeamUpdate,
} from './types'

export type PracticeFilters = {
  q?: string
  category?: Category
  tag?: string
  includeArchived?: boolean
}

export const keys = {
  teams: (includeArchived = false) => ['teams', { includeArchived }] as const,
  team: (id: number) => ['team', id] as const,
  practices: (filters: PracticeFilters = {}) => ['practices', filters] as const,
  practice: (id: number) => ['practice', id] as const,
  similar: (name: string) => ['similar', name] as const,
  note: (teamId: number, practiceId: number) => ['note', teamId, practiceId] as const,
  revisions: (type: EntityType, entityId: string) => ['revisions', type, entityId] as const,
  frames: (scope: string, step: Step) => ['frames', scope, step] as const,
}

// --- Queries -------------------------------------------------------------------

export function useTeams(includeArchived = false) {
  return useQuery({
    queryKey: keys.teams(includeArchived),
    queryFn: async () =>
      unwrap(
        await api.GET('/api/teams', { params: { query: { include_archived: includeArchived } } }),
      ),
  })
}

export function useTeam(id: number | null) {
  return useQuery({
    queryKey: keys.team(id ?? -1),
    enabled: id !== null,
    queryFn: async () =>
      unwrap(await api.GET('/api/teams/{team_id}', { params: { path: { team_id: id! } } })),
  })
}

export function usePractices(filters: PracticeFilters = {}) {
  return useQuery({
    queryKey: keys.practices(filters),
    placeholderData: keepPreviousData,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/practices', {
          params: {
            query: {
              q: filters.q || undefined,
              category: filters.category,
              tag: filters.tag || undefined,
              include_archived: filters.includeArchived ?? false,
            },
          },
        }),
      ),
  })
}

export function usePractice(id: number | null) {
  return useQuery({
    queryKey: keys.practice(id ?? -1),
    enabled: id !== null,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/practices/{practice_id}', { params: { path: { practice_id: id! } } }),
      ),
  })
}

export function useSimilar(name: string) {
  const trimmed = name.trim()
  return useQuery({
    queryKey: keys.similar(trimmed),
    enabled: trimmed.length >= 2,
    queryFn: async () =>
      unwrap(await api.GET('/api/practices/similar', { params: { query: { name: trimmed } } })),
  })
}

export function useNote(teamId: number | null, practiceId: number | null) {
  return useQuery({
    queryKey: keys.note(teamId ?? -1, practiceId ?? -1),
    enabled: teamId !== null && practiceId !== null,
    queryFn: async () => {
      const result = await api.GET('/api/teams/{team_id}/notes/{practice_id}', {
        params: { path: { team_id: teamId!, practice_id: practiceId! } },
      })
      if (result.response.status === 404) return null
      return unwrap(result)
    },
  })
}

export function useRevisions(type: EntityType, entityId: string | null) {
  return useQuery({
    queryKey: keys.revisions(type, entityId ?? ''),
    enabled: entityId !== null,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/revisions', {
          params: { query: { entity_type: type, entity_id: entityId! } },
        }),
      ),
  })
}

export function useFrames(scope: string, step: Step) {
  return useQuery({
    queryKey: keys.frames(scope, step),
    placeholderData: keepPreviousData,
    queryFn: async () =>
      unwrap(await api.GET('/api/radar/frames', { params: { query: { scope, step } } })),
  })
}

// --- Mutations -----------------------------------------------------------------

function useInvalidatingMutation<TVars, TData>(
  mutationFn: (vars: TVars) => Promise<TData>,
  invalidate: (vars: TVars) => QueryKey[],
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: async (_data, vars) => {
      await Promise.all(
        invalidate(vars).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      )
    },
  })
}

export function useCreateTeam() {
  return useInvalidatingMutation(
    async (body: TeamCreate) => unwrap(await api.POST('/api/teams', { body })),
    () => [['teams']],
  )
}

export function useUpdateTeam() {
  return useInvalidatingMutation(
    async ({ id, body }: { id: number; body: TeamUpdate }) =>
      unwrap(await api.PATCH('/api/teams/{team_id}', { params: { path: { team_id: id } }, body })),
    ({ id }) => [['teams'], keys.team(id)],
  )
}

export function useSetTeamArchived() {
  return useInvalidatingMutation(
    async ({ id, archived }: { id: number; archived: boolean }) => {
      const params = { params: { path: { team_id: id } } }
      return unwrap(
        archived
          ? await api.POST('/api/teams/{team_id}/archive', params)
          : await api.POST('/api/teams/{team_id}/restore', params),
      )
    },
    ({ id }) => [['teams'], keys.team(id), ['frames']],
  )
}

export function useCreatePractice() {
  return useInvalidatingMutation(
    async (body: PracticeCreate) => unwrap(await api.POST('/api/practices', { body })),
    () => [['practices'], ['similar']],
  )
}

export function useUpdatePractice() {
  return useInvalidatingMutation(
    async ({ id, body }: { id: number; body: PracticeUpdate }) =>
      unwrap(
        await api.PATCH('/api/practices/{practice_id}', {
          params: { path: { practice_id: id } },
          body,
        }),
      ),
    ({ id }) => [['practices'], keys.practice(id), ['frames'], ['revisions']],
  )
}

export function useSetPracticeArchived() {
  return useInvalidatingMutation(
    async ({ id, archived }: { id: number; archived: boolean }) => {
      const params = { params: { path: { practice_id: id } } }
      return unwrap(
        archived
          ? await api.POST('/api/practices/{practice_id}/archive', params)
          : await api.POST('/api/practices/{practice_id}/restore', params),
      )
    },
    ({ id }) => [['practices'], keys.practice(id), ['frames'], ['revisions']],
  )
}

export function usePlace() {
  return useInvalidatingMutation(
    async (body: PlacementCreate) => unwrap(await api.POST('/api/placements', { body })),
    ({ practice_id }) => [['frames'], ['practices'], keys.practice(practice_id)],
  )
}

export function usePutNote() {
  return useInvalidatingMutation(
    async (v: { teamId: number; practiceId: number; version: number; body_md: string }) =>
      unwrap(
        await api.PUT('/api/teams/{team_id}/notes/{practice_id}', {
          params: { path: { team_id: v.teamId, practice_id: v.practiceId } },
          body: { version: v.version, body_md: v.body_md },
        }),
      ),
    (v) => [keys.note(v.teamId, v.practiceId), keys.practice(v.practiceId), ['revisions']],
  )
}

export function useRevert() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (revisionId: number) =>
      unwrap(
        await api.POST('/api/revisions/{revision_id}/revert', {
          params: { path: { revision_id: revisionId } },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries(),
  })
}
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests pass (12), and tsc reports no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api frontend/src/test
git commit -m "feat(frontend): add API type aliases, query hooks and test fixtures"
```

---

### Task 3: Design tokens, app shell, routing, toasts, name prompt and confirm dialog

**REQUIRED SKILL:** Invoke the **frontend-design** skill before Step 5. The token *names* in `tokens.css` are the contract later tasks rely on. The skill may refine *values* (palette, type scale, spacing, shadows) and `global.css`, but must keep every name, keep light and dark variants, and keep `--edit-past` distinct from all four `--cat-*` colours.

**Files:**
- Create: `frontend/src/styles/tokens.css`, `frontend/src/styles/global.css`
- Create: `frontend/src/components/Toasts.tsx`, `Toasts.module.css`, `NamePrompt.tsx`, `ConfirmDialog.tsx`, `Modal.module.css`, `CategoryChip.tsx`, `CategoryChip.module.css`, `AppShell.tsx`, `AppShell.module.css`
- Create: `frontend/src/router.tsx`, `frontend/src/pages/RadarPage.tsx`, `CatalogPage.tsx`, `PracticePage.tsx`, `TeamsPage.tsx`, `NotFound.tsx` (pages start as headings, and later tasks replace them)
- Modify: `frontend/src/main.tsx`, `frontend/src/test/render.tsx` (add `renderRoutes`)
- Delete: `frontend/src/App.tsx`
- Test: `frontend/src/components/AppShell.test.tsx`, `frontend/src/components/NamePrompt.test.tsx`, `frontend/src/components/Toasts.test.tsx`

**Interfaces:**
- Consumes: `useTeams`, `readString` / `writeString`, `getEditedBy` / `setEditedBy` / `hasChosenName`, `toRef` / `idFromRef`
- Produces:
  - `ToastProvider` and `useToast(): (toast: { message: string; tone?: 'info' | 'error'; action?: { label: string; onClick: () => void } }) => void`. Toasts auto-dismiss after 6 s.
  - `NamePromptProvider` and `useNamePrompt(): { ensureName: () => Promise<void>; changeName: () => void }`
  - `ConfirmDialog({ open, title, message, confirmLabel, onConfirm, onCancel })`
  - `CategoryChip({ category })`
  - `AppShell` (header with the scope switcher, Catalog and Teams links and the name chip, plus an `<Outlet/>`)
  - `routes: RouteObject[]`, `router`, and `HomeRedirect`. `LAST_TEAM_KEY = 'aiRadar.lastTeam'` is exported from `AppShell.tsx`.
  - `renderRoutes(initialPath: string, extraRoutes?: RouteObject[])` in `src/test/render.tsx`. It renders the app's `routes` inside a memory router with every provider, and returns `{ router, ...renderResult }`.
  - CSS tokens:
    - `--font-sans`, `--font-mono`
    - `--bg`, `--surface`, `--surface-2`, `--border`, `--text`, `--text-muted`
    - `--accent`, `--accent-contrast`, `--danger`, `--success`
    - `--cat-tool`, `--cat-skill`, `--cat-practice`, `--cat-workflow`, `--edit-past`
    - `--radius-sm`, `--radius`
    - `--space-1` through `--space-6`
    - `--shadow`

- [ ] **Step 1: Write the page stubs and the router**

`frontend/src/pages/RadarPage.tsx`:
```tsx
export default function RadarPage() {
  return <h1>Radar</h1>
}
```
Create `CatalogPage.tsx`, `PracticePage.tsx`, `TeamsPage.tsx` and `NotFound.tsx` the same way, rendering `<h1>Catalog</h1>`, `<h1>Practice</h1>`, `<h1>Teams</h1>` and `<h1>Page not found</h1>` respectively.

`frontend/src/router.tsx`:
```tsx
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import AppShell, { LAST_TEAM_KEY } from './components/AppShell'
import { readString } from './lib/storage'
import CatalogPage from './pages/CatalogPage'
import NotFound from './pages/NotFound'
import PracticePage from './pages/PracticePage'
import RadarPage from './pages/RadarPage'
import TeamsPage from './pages/TeamsPage'

export function HomeRedirect() {
  const lastTeam = readString(LAST_TEAM_KEY)
  return <Navigate replace to={lastTeam ? `/radar/team/${lastTeam}` : '/radar/org'} />
}

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: 'radar/org', element: <RadarPage /> },
      { path: 'radar/team/:teamRef', element: <RadarPage /> },
      { path: 'practices', element: <CatalogPage /> },
      { path: 'practices/:practiceRef', element: <PracticePage /> },
      { path: 'teams', element: <TeamsPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]

export const router = createBrowserRouter(routes)
```

- [ ] **Step 2: Add `renderRoutes` to the test helpers**

Append to `frontend/src/test/render.tsx`:
```tsx
import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router'
import { NamePromptProvider } from '../components/NamePrompt'
import { ToastProvider } from '../components/Toasts'
import { routes } from '../router'

export function renderRoutes(initialPath: string, extraRoutes: RouteObject[] = []) {
  const router = createMemoryRouter([...extraRoutes, ...routes], {
    initialEntries: [initialPath],
  })
  const client = createTestQueryClient()
  const result = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <NamePromptProvider>
          <RouterProvider router={router} />
        </NamePromptProvider>
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { router, client, ...result }
}
```
Move these imports to the top of the file together with the existing ones.

- [ ] **Step 3: Write the failing tests**

`frontend/src/components/Toasts.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ToastProvider, useToast } from './Toasts'

function Trigger({ onUndo }: { onUndo: () => void }) {
  const toast = useToast()
  return (
    <button onClick={() => toast({ message: 'Moved', action: { label: 'Undo', onClick: onUndo } })}>
      go
    </button>
  )
}

describe('toasts', () => {
  it('shows a message with an action', async () => {
    const onUndo = vi.fn()
    render(
      <ToastProvider>
        <Trigger onUndo={onUndo} />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByText('go'))
    expect(screen.getByRole('status')).toHaveTextContent('Moved')
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalledOnce()
    expect(screen.queryByText('Moved')).not.toBeInTheDocument()
  })
})
```

`frontend/src/components/NamePrompt.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { getEditedBy, setEditedBy } from '../lib/editedBy'
import { NamePromptProvider, useNamePrompt } from './NamePrompt'

function Writer({ onReady }: { onReady: () => void }) {
  const { ensureName } = useNamePrompt()
  return <button onClick={() => ensureName().then(onReady)}>write</button>
}

function setup() {
  const onReady = vi.fn()
  render(
    <NamePromptProvider>
      <Writer onReady={onReady} />
    </NamePromptProvider>,
  )
  return onReady
}

describe('name prompt', () => {
  it('asks for a name before the first write and stores it', async () => {
    const onReady = setup()
    await userEvent.click(screen.getByText('write'))
    const dialog = screen.getByRole('dialog', { name: /who is editing/i })
    await userEvent.type(screen.getByLabelText('Your name'), '  Kim  ')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(getEditedBy()).toBe('Kim')
    expect(onReady).toHaveBeenCalledOnce()
    expect(dialog).not.toBeInTheDocument()
  })

  it('skip stores an empty name and does not ask again', async () => {
    const onReady = setup()
    await userEvent.click(screen.getByText('write'))
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(getEditedBy()).toBe('')
    await userEvent.click(screen.getByText('write'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onReady).toHaveBeenCalledTimes(2)
  })

  it('does not ask when a name is already stored', async () => {
    setEditedBy('Kim')
    const onReady = setup()
    await userEvent.click(screen.getByText('write'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onReady).toHaveBeenCalledOnce()
  })
})
```

`frontend/src/components/AppShell.test.tsx`:
```tsx
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { writeString } from '../lib/storage'
import { team } from '../test/fixtures'
import { renderRoutes } from '../test/render'
import { server } from '../test/server'
import { LAST_TEAM_KEY } from './AppShell'

beforeEach(() => {
  server.use(
    http.get('/api/teams', () =>
      HttpResponse.json([team(), team({ id: 2, name: 'Payments', slug: 'payments' })]),
    ),
  )
})

describe('app shell', () => {
  it('redirects home to the org radar by default', async () => {
    const { router } = renderRoutes('/')
    await waitFor(() => expect(router.state.location.pathname).toBe('/radar/org'))
  })

  it('redirects home to the last team', async () => {
    writeString(LAST_TEAM_KEY, '2-payments')
    const { router } = renderRoutes('/')
    await waitFor(() => expect(router.state.location.pathname).toBe('/radar/team/2-payments'))
  })

  it('switches scope and remembers the team', async () => {
    const { router } = renderRoutes('/radar/org')
    const select = await screen.findByRole('combobox', { name: 'Radar' })
    await screen.findByRole('option', { name: 'Payments' })
    await userEvent.selectOptions(select, '2-payments')
    expect(router.state.location.pathname).toBe('/radar/team/2-payments')
    expect(localStorage.getItem(LAST_TEAM_KEY)).toBe('2-payments')
    await userEvent.selectOptions(select, 'org')
    expect(router.state.location.pathname).toBe('/radar/org')
  })

  it('shows the name chip and lets you change it', async () => {
    renderRoutes('/radar/org')
    await userEvent.click(await screen.findByRole('button', { name: /anonymous/i }))
    await userEvent.type(screen.getByLabelText('Your name'), 'Kim')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('button', { name: /Kim/ })).toBeInTheDocument()
  })

  it('renders not found for unknown paths', async () => {
    renderRoutes('/nope')
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL, `Failed to resolve import "./Toasts"` and similar.

- [ ] **Step 5: Invoke the frontend-design skill, then write the tokens and global styles**

Start from this baseline and let the skill refine the values:

`frontend/src/styles/tokens.css`:
```css
:root {
  --font-sans: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-mono: ui-monospace, 'SF Mono', Menlo, monospace;
  --bg: #f6f7f9;
  --surface: #ffffff;
  --surface-2: #eef0f4;
  --border: #d9dde5;
  --text: #1b1f27;
  --text-muted: #5f6878;
  --accent: #2f5bea;
  --accent-contrast: #ffffff;
  --danger: #d63b3b;
  --success: #1f9d61;
  --cat-tool: #2f7ae5;
  --cat-skill: #1a9c6b;
  --cat-practice: #e08a1e;
  --cat-workflow: #8b5cf6;
  --edit-past: #e0457b;
  --radius-sm: 6px;
  --radius: 10px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --shadow: 0 8px 24px rgb(16 24 40 / 0.12);
  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111318;
    --surface: #1a1d24;
    --surface-2: #232733;
    --border: #333a48;
    --text: #e8ebf1;
    --text-muted: #9aa3b2;
    --accent: #6c8cff;
    --cat-tool: #5b9bf0;
    --cat-skill: #3cc28f;
    --cat-practice: #f0a445;
    --cat-workflow: #a78bfa;
    --edit-past: #f06b9a;
    --shadow: 0 8px 24px rgb(0 0 0 / 0.4);
    color-scheme: dark;
  }
}
```

`frontend/src/styles/global.css`:
```css
@import './tokens.css';

*, *::before, *::after { box-sizing: border-box; }
html, body, #root { height: 100%; }
body {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.5;
  background: var(--bg);
  color: var(--text);
}
button, input, select, textarea { font: inherit; color: inherit; }
button {
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-3);
}
button.primary { background: var(--accent); color: var(--accent-contrast); border-color: var(--accent); }
button:disabled { opacity: 0.5; cursor: not-allowed; }
input, select, textarea {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-2);
}
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
a { color: var(--accent); }
.visually-hidden {
  position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap;
}
```

- [ ] **Step 6: Implement the components**

`frontend/src/components/Toasts.tsx`:
```tsx
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import styles from './Toasts.module.css'

type ToastInput = {
  message: string
  tone?: 'info' | 'error'
  action?: { label: string; onClick: () => void }
}
type Toast = ToastInput & { id: number }

const ToastContext = createContext<(toast: ToastInput) => void>(() => {})
let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const dismiss = useCallback((id: number) => {
    setToasts((all) => all.filter((t) => t.id !== id))
  }, [])
  const push = useCallback(
    (toast: ToastInput) => {
      const id = nextId++
      setToasts((all) => [...all, { ...toast, id }])
      window.setTimeout(() => dismiss(id), 6000)
    },
    [dismiss],
  )
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className={styles.region} role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`${styles.toast} ${t.tone === 'error' ? styles.error : ''}`}>
            <span>{t.message}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.onClick()
                  dismiss(t.id)
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
```

`frontend/src/components/Toasts.module.css`:
```css
.region {
  position: fixed; bottom: var(--space-6); left: 50%; transform: translateX(-50%);
  display: flex; flex-direction: column; gap: var(--space-2); z-index: 50;
}
.toast {
  display: flex; align-items: center; gap: var(--space-3);
  background: var(--text); color: var(--bg);
  padding: var(--space-2) var(--space-4); border-radius: var(--radius); box-shadow: var(--shadow);
}
.toast button { background: transparent; color: inherit; border-color: currentColor; }
.error { background: var(--danger); color: #fff; }
```

`frontend/src/components/Modal.module.css`:
```css
.backdrop {
  position: fixed; inset: 0; background: rgb(0 0 0 / 0.35);
  display: grid; place-items: center; z-index: 40;
}
.dialog {
  background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow);
  padding: var(--space-6); width: min(420px, calc(100vw - 32px));
  display: flex; flex-direction: column; gap: var(--space-3);
}
.dialog h2 { margin: 0; font-size: 18px; }
.actions { display: flex; justify-content: flex-end; gap: var(--space-2); }
```

`frontend/src/components/ConfirmDialog.tsx`:
```tsx
import styles from './Modal.module.css'

type Props = {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({ open, title, message, confirmLabel, onConfirm, onCancel }: Props) {
  if (!open) return null
  return (
    <div className={styles.backdrop}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">{title}</h2>
        <p>{message}</p>
        <div className={styles.actions}>
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
```

`frontend/src/components/NamePrompt.tsx`:
```tsx
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { getEditedBy, hasChosenName, setEditedBy } from '../lib/editedBy'
import styles from './Modal.module.css'

type NamePromptApi = { ensureName: () => Promise<void>; changeName: () => void }

const NamePromptContext = createContext<NamePromptApi>({
  ensureName: async () => {},
  changeName: () => {},
})

export function NamePromptProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [resolvers, setResolvers] = useState<(() => void)[]>([])

  const ensureName = useCallback(() => {
    if (hasChosenName()) return Promise.resolve()
    return new Promise<void>((resolve) => {
      setResolvers((all) => [...all, resolve])
      setDraft('')
      setOpen(true)
    })
  }, [])

  const changeName = useCallback(() => {
    setDraft(getEditedBy() ?? '')
    setOpen(true)
  }, [])

  const finish = (value: string) => {
    setEditedBy(value)
    setOpen(false)
    resolvers.forEach((resolve) => resolve())
    setResolvers([])
  }

  return (
    <NamePromptContext.Provider value={{ ensureName, changeName }}>
      {children}
      {open && (
        <div className={styles.backdrop}>
          <form
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="name-title"
            onSubmit={(e) => {
              e.preventDefault()
              if (draft.trim()) finish(draft)
            }}
          >
            <h2 id="name-title">Who is editing?</h2>
            <p>Your name is saved with your changes so others can see who made them.</p>
            <label>
              <span className="visually-hidden">Your name</span>
              <input
                aria-label="Your name"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="e.g. Kim Andersson"
              />
            </label>
            <div className={styles.actions}>
              <button type="button" onClick={() => finish('')}>
                Skip
              </button>
              <button type="submit" className="primary" disabled={!draft.trim()}>
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </NamePromptContext.Provider>
  )
}

export function useNamePrompt() {
  return useContext(NamePromptContext)
}
```

`frontend/src/components/CategoryChip.tsx`:
```tsx
import type { Category } from '../api/types'
import styles from './CategoryChip.module.css'

const LABELS: Record<Category, string> = {
  tool: 'Tool',
  skill: 'Skill',
  practice: 'Practice',
  workflow: 'Workflow',
}

export default function CategoryChip({ category }: { category: Category }) {
  return (
    <span className={styles.chip} style={{ ['--chip' as string]: `var(--cat-${category})` }}>
      <span className={styles.dot} aria-hidden="true" />
      {LABELS[category]}
    </span>
  )
}
```

`frontend/src/components/CategoryChip.module.css`:
```css
.chip {
  display: inline-flex; align-items: center; gap: var(--space-1);
  border: 1px solid var(--border); border-radius: 999px;
  padding: 0 var(--space-2); font-size: 12px;
}
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--chip); }
```

`frontend/src/components/AppShell.tsx`:
```tsx
import { Link, NavLink, Outlet, useMatch, useNavigate } from 'react-router'
import { useTeams } from '../api/hooks'
import { getEditedBy } from '../lib/editedBy'
import { toRef } from '../lib/refs'
import { writeString } from '../lib/storage'
import styles from './AppShell.module.css'
import { useNamePrompt } from './NamePrompt'

export const LAST_TEAM_KEY = 'aiRadar.lastTeam'

export default function AppShell() {
  const navigate = useNavigate()
  const teamMatch = useMatch('/radar/team/:teamRef')
  const orgMatch = useMatch('/radar/org')
  const { data: teams = [] } = useTeams()
  const { changeName } = useNamePrompt()
  const name = getEditedBy()

  const current = teamMatch?.params.teamRef ?? (orgMatch ? 'org' : '')

  function onScopeChange(value: string) {
    if (value === 'org') {
      navigate('/radar/org')
    } else {
      writeString(LAST_TEAM_KEY, value)
      navigate(`/radar/team/${value}`)
    }
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>
          AI Radar
        </Link>
        <label className={styles.scope}>
          <span className="visually-hidden">Radar</span>
          <select aria-label="Radar" value={current} onChange={(e) => onScopeChange(e.target.value)}>
            {current === '' && <option value="">Choose a radar…</option>}
            <option value="org">Whole organization</option>
            {teams.map((t) => (
              <option key={t.id} value={toRef(t.id, t.slug)}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <nav className={styles.nav}>
          <NavLink to="/practices">Catalog</NavLink>
          <NavLink to="/teams">Teams</NavLink>
        </nav>
        <button className={styles.nameChip} onClick={changeName} title="Change your name">
          ✎ {name ? name : 'anonymous'}
        </button>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}
```

`frontend/src/components/AppShell.module.css`:
```css
.shell { display: flex; flex-direction: column; min-height: 100%; }
.header {
  display: flex; align-items: center; gap: var(--space-4);
  padding: var(--space-2) var(--space-4);
  background: var(--surface); border-bottom: 1px solid var(--border);
}
.brand { font-weight: 700; color: var(--text); text-decoration: none; }
.nav { display: flex; gap: var(--space-3); }
.nav a { color: var(--text-muted); text-decoration: none; }
.nav a[aria-current='page'] { color: var(--text); font-weight: 600; }
.nameChip { margin-left: auto; border-radius: 999px; }
.main { flex: 1; min-height: 0; display: flex; flex-direction: column; }
```

The name chip re-reads `getEditedBy()` on every render. After `changeName` saves, the provider's state change re-renders the tree, so the chip updates.

`frontend/src/main.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { NamePromptProvider } from './components/NamePrompt'
import { ToastProvider } from './components/Toasts'
import { router } from './router'
import './styles/global.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 2 } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <NamePromptProvider>
          <RouterProvider router={router} />
        </NamePromptProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
)
```

Delete `frontend/src/App.tsx`.

- [ ] **Step 7: Run the tests, typecheck and build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all tests pass (21), there are no type errors, and the build succeeds.

Manual check: run the backend (`cd backend && uv run fastapi dev app/main.py`) and `npm run dev`. Opening `http://localhost:5173/` should redirect to `/radar/org`, and the header should list the teams created in the Plan 1 smoke test.

- [ ] **Step 8: Commit**

```bash
git add frontend
git commit -m "feat(frontend): add design tokens, app shell, routing, toasts and name prompt"
```

### Task 4: Chart geometry and frame helpers (pure)

**Files:**
- Create: `frontend/src/chart/geometry.ts`, `frontend/src/chart/frames.ts`
- Test: `frontend/src/chart/geometry.test.ts`, `frontend/src/chart/frames.test.ts`

**Interfaces:**
- Consumes: `Frame`, `Point`, `PracticeListItem`, `Category`, `Step`
- Produces (`chart/geometry.ts`):
  - `type Size = { width: number; height: number }` and `type PlotBox = { left: number; top: number; width: number; height: number }`
  - `MARGIN` and `plotBox(size): PlotBox`
  - `toPixel(box, adoption, value): { x: number; y: number }`
  - `fromPixel(box, x, y): { adoption: number; value: number; inside: boolean }`, where the scores are clamped and rounded to 0–100
  - `clampScore(n): number`
  - `TEAM_RADIUS = 10`
  - `bubbleRadius(teams, maxTeams, scope: 'team' | 'org'): number`, which returns 8–22 in the org scope
  - `CORNER_LABELS = { topLeft: 'Hidden gems', topRight: 'Core', bottomRight: 'Question it', bottomLeft: 'Parked' }`
  - `categoryColor(category): string`, which returns `var(--cat-<category>)`. Use it with `.style('fill', …)`, never as an SVG attribute.
- Produces (`chart/frames.ts`):
  - `type TrailPoint = { date: string; adoption: number; value: number }`
  - `pointMap(frame: Frame | undefined): Map<number, Point>`
  - `trail(frames, practiceId, uptoIndex): TrailPoint[]`, covering frames 0 through `uptoIndex` inclusive where the practice is present
  - `offRadar(practices: PracticeListItem[], frame: Frame | undefined): PracticeListItem[]`: non-archived practices not in the frame, sorted by name
  - `formatFrameDate(date: string, step: Step): string` in UTC: `"Mar 2026"` for months and `"w/e 15 Mar 2026"` for weeks
  - `NUDGE_STEP = 2`
  - `nudge(point: { adoption: number; value: number }, key: string, shift = false): { adoption: number; value: number } | null`, which handles the arrow keys and moves by `NUDGE_STEP` (×5 with `shift`)

- [ ] **Step 1: Write the failing tests**

`frontend/src/chart/geometry.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import {
  bubbleRadius,
  categoryColor,
  clampScore,
  fromPixel,
  plotBox,
  TEAM_RADIUS,
  toPixel,
} from './geometry'

const box = plotBox({ width: 452, height: 252 }) // plot area 400 x 200 at (36, 16)

describe('geometry', () => {
  it('computes the plot box inside margins', () => {
    expect(box).toEqual({ left: 36, top: 16, width: 400, height: 200 })
    expect(plotBox({ width: 10, height: 10 }).width).toBe(0)
  })

  it('maps scores to pixels with value growing upwards', () => {
    expect(toPixel(box, 0, 0)).toEqual({ x: 36, y: 216 })
    expect(toPixel(box, 100, 100)).toEqual({ x: 436, y: 16 })
    expect(toPixel(box, 50, 50)).toEqual({ x: 236, y: 116 })
  })

  it('maps pixels back to rounded scores', () => {
    expect(fromPixel(box, 236, 116)).toEqual({ adoption: 50, value: 50, inside: true })
    expect(fromPixel(box, 137, 66)).toEqual({ adoption: 25, value: 75, inside: true })
  })

  it('flags and clamps points outside the plot', () => {
    expect(fromPixel(box, 10, 116)).toEqual({ adoption: 0, value: 50, inside: false })
    expect(fromPixel(box, 236, 300)).toEqual({ adoption: 50, value: 0, inside: false })
  })

  it('clamps scores', () => {
    expect([clampScore(-3), clampScore(49.6), clampScore(140)]).toEqual([0, 50, 100])
  })

  it('sizes bubbles', () => {
    expect(bubbleRadius(1, 9, 'team')).toBe(TEAM_RADIUS)
    expect(bubbleRadius(0, 9, 'org')).toBe(8)
    expect(bubbleRadius(9, 9, 'org')).toBe(22)
    expect(bubbleRadius(4, 9, 'org')).toBeGreaterThan(bubbleRadius(1, 9, 'org'))
  })

  it('uses category tokens', () => {
    expect(categoryColor('workflow')).toBe('var(--cat-workflow)')
  })
})
```

`frontend/src/chart/frames.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { framesResponse, listItem } from '../test/fixtures'
import { formatFrameDate, nudge, offRadar, pointMap, trail } from './frames'

const { frames } = framesResponse()

describe('frame helpers', () => {
  it('indexes points by practice id', () => {
    expect(pointMap(frames[1]).get(11)?.value).toBe(60)
    expect(pointMap(undefined).size).toBe(0)
  })

  it('builds a trail up to the current frame', () => {
    expect(trail(frames, 10, 1)).toEqual([
      { date: '2026-01-31T23:59:59Z', adoption: 70, value: 80 },
      { date: '2026-02-28T23:59:59Z', adoption: 75, value: 85 },
    ])
    expect(trail(frames, 10, 0)).toHaveLength(1)
    expect(trail(frames, 11, 1)).toEqual([
      { date: '2026-02-28T23:59:59Z', adoption: 20, value: 60 },
    ])
  })

  it('lists catalog practices not on the radar at a frame', () => {
    const practices = [
      listItem({ id: 12, name: 'Prompt library' }),
      listItem({ id: 10, name: 'Claude Code' }),
      listItem({ id: 13, name: 'Archived thing', archived_at: '2026-01-01T00:00:00Z' }),
      listItem({ id: 11, name: 'Spec-driven dev' }),
    ]
    expect(offRadar(practices, frames[0]).map((p) => p.id)).toEqual([12, 11])
    expect(offRadar(practices, undefined).map((p) => p.name)).toEqual([
      'Claude Code',
      'Prompt library',
      'Spec-driven dev',
    ])
  })

  it('formats frame dates in UTC', () => {
    expect(formatFrameDate('2026-03-31T23:59:59Z', 'month')).toBe('Mar 2026')
    expect(formatFrameDate('2026-03-15T23:59:59Z', 'week')).toBe('w/e 15 Mar 2026')
  })

  it('nudges with arrow keys', () => {
    const p = { adoption: 50, value: 50 }
    expect(nudge(p, 'ArrowRight')).toEqual({ adoption: 52, value: 50 })
    expect(nudge(p, 'ArrowUp')).toEqual({ adoption: 50, value: 52 })
    expect(nudge(p, 'ArrowLeft', true)).toEqual({ adoption: 40, value: 50 })
    expect(nudge({ adoption: 99, value: 1 }, 'ArrowRight', true)).toEqual({ adoption: 100, value: 1 })
    expect(nudge(p, 'Enter')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/chart`
Expected: FAIL, `Failed to resolve import "./geometry"` and `"./frames"`.

- [ ] **Step 3: Implement**

`frontend/src/chart/geometry.ts`:
```ts
import type { Category } from '../api/types'

export type Size = { width: number; height: number }
export type PlotBox = { left: number; top: number; width: number; height: number }

export const MARGIN = { top: 16, right: 16, bottom: 36, left: 36 }

export function plotBox(size: Size): PlotBox {
  return {
    left: MARGIN.left,
    top: MARGIN.top,
    width: Math.max(0, size.width - MARGIN.left - MARGIN.right),
    height: Math.max(0, size.height - MARGIN.top - MARGIN.bottom),
  }
}

export function clampScore(n: number): number {
  return Math.min(100, Math.max(0, Math.round(n)))
}

export function toPixel(box: PlotBox, adoption: number, value: number) {
  return {
    x: box.left + (adoption / 100) * box.width,
    y: box.top + (1 - value / 100) * box.height,
  }
}

export function fromPixel(box: PlotBox, x: number, y: number) {
  const adoption = ((x - box.left) / box.width) * 100
  const value = (1 - (y - box.top) / box.height) * 100
  const inside = adoption >= 0 && adoption <= 100 && value >= 0 && value <= 100
  return { adoption: clampScore(adoption), value: clampScore(value), inside }
}

export const TEAM_RADIUS = 10

export function bubbleRadius(teams: number, maxTeams: number, scope: 'team' | 'org'): number {
  if (scope === 'team') return TEAM_RADIUS
  return 8 + 14 * Math.sqrt(teams / Math.max(1, maxTeams))
}

export const CORNER_LABELS = {
  topLeft: 'Hidden gems',
  topRight: 'Core',
  bottomRight: 'Question it',
  bottomLeft: 'Parked',
} as const

export function categoryColor(category: Category): string {
  return `var(--cat-${category})`
}
```

`frontend/src/chart/frames.ts`:
```ts
import type { Frame, Point, PracticeListItem, Step } from '../api/types'
import { clampScore } from './geometry'

export type TrailPoint = { date: string; adoption: number; value: number }

export function pointMap(frame: Frame | undefined): Map<number, Point> {
  return new Map((frame?.points ?? []).map((p) => [p.practice_id, p]))
}

export function trail(frames: Frame[], practiceId: number, uptoIndex: number): TrailPoint[] {
  const result: TrailPoint[] = []
  for (const frame of frames.slice(0, uptoIndex + 1)) {
    const point = frame.points.find((p) => p.practice_id === practiceId)
    if (point) result.push({ date: frame.date, adoption: point.adoption, value: point.value })
  }
  return result
}

export function offRadar(
  practices: PracticeListItem[],
  frame: Frame | undefined,
): PracticeListItem[] {
  const onRadar = pointMap(frame)
  return practices
    .filter((p) => p.archived_at === null && !onRadar.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name))
}

const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const DAY = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

export function formatFrameDate(date: string, step: Step): string {
  const d = new Date(date)
  return step === 'month' ? MONTH.format(d) : `w/e ${DAY.format(d)}`
}

export const NUDGE_STEP = 2

const DIRECTIONS: Record<string, [number, number]> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
}

export function nudge(
  point: { adoption: number; value: number },
  key: string,
  shift = false,
): { adoption: number; value: number } | null {
  const direction = DIRECTIONS[key]
  if (!direction) return null
  const step = NUDGE_STEP * (shift ? 5 : 1)
  return {
    adoption: clampScore(point.adoption + direction[0] * step),
    value: clampScore(point.value + direction[1] * step),
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/chart && npm run typecheck`
Expected: 12 tests pass, and there are no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/chart
git commit -m "feat(frontend): add chart geometry and frame helpers"
```

### Task 5: D3 radar renderer and the `RadarChart` wrapper

The renderer is plain TypeScript and D3 with no React. It owns the SVG and exposes `update(state)`. `RadarChart` is a thin React wrapper that sizes the SVG, forwards callbacks, and accepts HTML5 drops from the tray. When `duration` is 0, attributes are applied synchronously and nothing is transitioned, which keeps tests deterministic.

**Files:**
- Create: `frontend/src/chart/renderRadar.ts`, `frontend/src/chart/radar.css`, `frontend/src/chart/RadarChart.tsx`, `frontend/src/lib/useElementSize.ts`
- Modify: `frontend/src/chart/geometry.ts` (add `positionLabel`)
- Test: `frontend/src/chart/renderRadar.test.ts`, `frontend/src/chart/RadarChart.test.tsx`, plus a `positionLabel` case in `frontend/src/chart/geometry.test.ts`

**Interfaces:**
- Consumes: `plotBox`, `toPixel`, `fromPixel`, `bubbleRadius`, `categoryColor`, `CORNER_LABELS`, `nudge`
- Produces:
  - `positionLabel(adoption, value): 'Core' | 'Hidden gem' | 'Question it' | 'Parked'` in `geometry.ts`, using the same rules as the backend
  - `type TeamDot = { teamId: number; teamName: string; adoption: number; value: number }`
  - `type ChartBubble = { practiceId: number; name: string; category: Category; adoption: number; value: number; teams: number; teamPositions?: TeamDot[] }`
  - `type LabelledPoint = { adoption: number; value: number; label: string }`
  - `type ChartState`, with these fields:
    - `size: Size`
    - `scope: 'team' | 'org'`
    - `bubbles: ChartBubble[]`
    - `dateLabel: string`
    - `selected: number[]`
    - `trails: Record<number, LabelledPoint[]>`
    - `editable: boolean`
    - `editingPast: boolean`
    - `highlight: string`
    - `duration: number`
  - `type ChartCallbacks`, with these handlers:
    - `onSelect(id: number | null, additive: boolean)`
    - `onMove(id, adoption, value)`
    - `onRemove(id)`
    - `onNudge(id, adoption, value)`
  - `resolveDrop(box, x, y): { type: 'move'; adoption: number; value: number } | { type: 'remove' }`
  - `createRadar(svg: SVGSVGElement, callbacks: ChartCallbacks): { update(state: ChartState): void; destroy(): void }`
  - `PRACTICE_MIME = 'application/x-ai-radar-practice'`, the data type the tray sets when a practice is dragged
  - `RadarChart` props: `Omit<ChartState, 'size'> & ChartCallbacks & { onDropPractice?: (practiceId: number, adoption: number, value: number) => void }`
  - `useElementSize(ref, fallback = { width: 640, height: 480 }): Size`

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/chart/geometry.test.ts`, with `positionLabel` added to the import list:
```ts
it('labels positions like the backend', () => {
  expect(positionLabel(80, 90)).toBe('Core')
  expect(positionLabel(49, 50)).toBe('Hidden gem')
  expect(positionLabel(50, 49)).toBe('Question it')
  expect(positionLabel(0, 0)).toBe('Parked')
})
```

`frontend/src/chart/renderRadar.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { plotBox } from './geometry'
import { createRadar, resolveDrop, type ChartBubble, type ChartState } from './renderRadar'

const bubble = (
  practiceId: number,
  name: string,
  category: ChartBubble['category'],
  adoption: number,
  value: number,
  extra: Partial<ChartBubble> = {},
): ChartBubble => ({ practiceId, name, category, adoption, value, teams: 1, ...extra })

function setup(overrides: Partial<ChartState> = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  document.body.appendChild(svg)
  const callbacks = { onSelect: vi.fn(), onMove: vi.fn(), onRemove: vi.fn(), onNudge: vi.fn() }
  const radar = createRadar(svg, callbacks)
  const state: ChartState = {
    size: { width: 452, height: 252 },
    scope: 'team',
    bubbles: [bubble(10, 'Claude Code', 'tool', 70, 80), bubble(11, 'Spec-driven dev', 'practice', 20, 60)],
    dateLabel: 'Feb 2026',
    selected: [],
    trails: {},
    editable: true,
    editingPast: false,
    highlight: '',
    duration: 0,
    ...overrides,
  }
  radar.update(state)
  const bubbleEl = (id: number) =>
    [...svg.querySelectorAll<SVGGElement>('g.radar-bubble')].find((g) =>
      g.getAttribute('aria-label')?.startsWith(id === 10 ? 'Claude Code' : 'Spec-driven dev'),
    )!
  return { svg, callbacks, radar, state, bubbleEl }
}

describe('renderRadar', () => {
  it('renders bubbles with names, positions and accessible labels', () => {
    const { svg, bubbleEl } = setup()
    expect(svg.querySelectorAll('g.radar-bubble')).toHaveLength(2)
    expect(bubbleEl(10).getAttribute('aria-label')).toBe('Claude Code, Core')
    expect(bubbleEl(11).getAttribute('aria-label')).toBe('Spec-driven dev, Hidden gem')
    expect(bubbleEl(10).getAttribute('transform')).toBe('translate(316,56)')
    expect(svg.querySelector('.radar-date')?.textContent).toBe('Feb 2026')
    expect(svg.textContent).toContain('Hidden gems')
    expect(svg.textContent).toContain('Perceived value →')
  })

  it('removes bubbles that leave the frame', () => {
    const { svg, radar, state } = setup()
    radar.update({ ...state, bubbles: [state.bubbles[0]] })
    expect(svg.querySelectorAll('g.radar-bubble')).toHaveLength(1)
  })

  it('marks selection and draws a labelled trail', () => {
    const { svg, bubbleEl } = setup({
      selected: [10],
      trails: {
        10: [
          { adoption: 60, value: 70, label: 'Jan 2026' },
          { adoption: 70, value: 80, label: 'Feb 2026' },
        ],
      },
    })
    expect(bubbleEl(10).classList.contains('is-selected')).toBe(true)
    expect(svg.querySelector('.radar-trail path')).not.toBeNull()
    expect(svg.querySelector('.radar-trail')?.textContent).toContain('Jan 2026')
  })

  it('selects on click, adds with shift, clears on background', () => {
    const { svg, callbacks, bubbleEl } = setup()
    bubbleEl(10).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    bubbleEl(11).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
    svg.querySelector('.radar-bg')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(callbacks.onSelect.mock.calls).toEqual([
      [10, false],
      [11, true],
      [null, false],
    ])
  })

  it('nudges with arrow keys only when editable', () => {
    const { callbacks, bubbleEl, radar, state } = setup()
    bubbleEl(10).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(callbacks.onNudge).toHaveBeenCalledWith(10, 72, 80)
    radar.update({ ...state, editable: false })
    bubbleEl(10).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(callbacks.onNudge).toHaveBeenCalledTimes(1)
  })

  it('fans out team positions for a selected org bubble and dims the rest', () => {
    const { svg, bubbleEl } = setup({
      scope: 'org',
      editable: false,
      selected: [10],
      bubbles: [
        bubble(10, 'Claude Code', 'tool', 60, 80, {
          teams: 2,
          teamPositions: [
            { teamId: 1, teamName: 'Platform', adoption: 80, value: 90 },
            { teamId: 2, teamName: 'Payments', adoption: 40, value: 70 },
          ],
        }),
        bubble(11, 'Spec-driven dev', 'practice', 20, 60),
      ],
    })
    expect(svg.querySelectorAll('.radar-spread circle')).toHaveLength(2)
    expect(svg.querySelector('.radar-spread')?.textContent).toContain('Payments')
    expect(bubbleEl(11).classList.contains('is-dim')).toBe(true)
  })

  it('reflects editing-past and search highlight', () => {
    const { svg, bubbleEl } = setup({ editingPast: true, highlight: 'spec' })
    expect(svg.classList.contains('editing-past')).toBe(true)
    expect(bubbleEl(10).classList.contains('is-dim')).toBe(true)
    expect(bubbleEl(11).classList.contains('is-dim')).toBe(false)
  })

  it('resolves drops inside and outside the plot', () => {
    const box = plotBox({ width: 452, height: 252 })
    expect(resolveDrop(box, 236, 116)).toEqual({ type: 'move', adoption: 50, value: 50 })
    expect(resolveDrop(box, 5, 116)).toEqual({ type: 'remove' })
  })
})
```

`frontend/src/chart/RadarChart.test.tsx`:
```tsx
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import RadarChart from './RadarChart'
import { PRACTICE_MIME } from './renderRadar'

const noop = () => {}

describe('RadarChart', () => {
  it('renders bubbles and accepts practice drops inside the plot', () => {
    const onDropPractice = vi.fn()
    const { container } = render(
      <RadarChart
        scope="team"
        bubbles={[{ practiceId: 10, name: 'Claude Code', category: 'tool', adoption: 70, value: 80, teams: 1 }]}
        dateLabel="Feb 2026"
        selected={[]}
        trails={{}}
        editable
        editingPast={false}
        highlight=""
        duration={0}
        onSelect={noop}
        onMove={noop}
        onRemove={noop}
        onNudge={noop}
        onDropPractice={onDropPractice}
      />,
    )
    expect(container.querySelectorAll('g.radar-bubble')).toHaveLength(1)
    // jsdom: no ResizeObserver, so the fallback 640x480 applies and the plot box is (36,16,588,428)
    const target = container.firstElementChild!
    fireEvent.drop(target, {
      clientX: 36 + 294,
      clientY: 16 + 214,
      dataTransfer: { types: [PRACTICE_MIME], getData: () => '12' },
    })
    expect(onDropPractice).toHaveBeenCalledWith(12, 50, 50)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/chart`
Expected: FAIL, `Failed to resolve import "./renderRadar"` and `positionLabel is not a function`.

- [ ] **Step 3: Add `positionLabel` to `geometry.ts`**

Append to `frontend/src/chart/geometry.ts`:
```ts
export type PositionLabel = 'Core' | 'Hidden gem' | 'Question it' | 'Parked'

export function positionLabel(adoption: number, value: number): PositionLabel {
  const highAdoption = adoption >= 50
  if (value >= 50) return highAdoption ? 'Core' : 'Hidden gem'
  return highAdoption ? 'Question it' : 'Parked'
}
```

- [ ] **Step 4: Implement the renderer**

`frontend/src/chart/renderRadar.ts`:
```ts
import * as d3 from 'd3'
import type { Category } from '../api/types'
import { nudge } from './frames'
import {
  bubbleRadius,
  categoryColor,
  CORNER_LABELS,
  fromPixel,
  plotBox,
  positionLabel,
  toPixel,
  type PlotBox,
  type Size,
} from './geometry'

export type TeamDot = { teamId: number; teamName: string; adoption: number; value: number }
export type ChartBubble = {
  practiceId: number
  name: string
  category: Category
  adoption: number
  value: number
  teams: number
  teamPositions?: TeamDot[]
}
export type LabelledPoint = { adoption: number; value: number; label: string }
export type ChartState = {
  size: Size
  scope: 'team' | 'org'
  bubbles: ChartBubble[]
  dateLabel: string
  selected: number[]
  trails: Record<number, LabelledPoint[]>
  editable: boolean
  editingPast: boolean
  highlight: string
  duration: number
}
export type ChartCallbacks = {
  onSelect: (id: number | null, additive: boolean) => void
  onMove: (id: number, adoption: number, value: number) => void
  onRemove: (id: number) => void
  onNudge: (id: number, adoption: number, value: number) => void
}
export type Drop = { type: 'move'; adoption: number; value: number } | { type: 'remove' }

export const PRACTICE_MIME = 'application/x-ai-radar-practice'

export function resolveDrop(box: PlotBox, x: number, y: number): Drop {
  const p = fromPixel(box, x, y)
  return p.inside ? { type: 'move', adoption: p.adoption, value: p.value } : { type: 'remove' }
}

export function createRadar(svgEl: SVGSVGElement, callbacks: ChartCallbacks) {
  const svg = d3.select(svgEl).classed('radar', true)
  svg.selectAll('*').remove()
  const background = svg
    .append('rect')
    .attr('class', 'radar-bg')
    .on('click', () => callbacks.onSelect(null, false))
  const frame = svg.append('rect').attr('class', 'radar-frame')
  const midX = svg.append('line').attr('class', 'radar-mid')
  const midY = svg.append('line').attr('class', 'radar-mid')
  const dateText = svg.append('text').attr('class', 'radar-date')
  const corners = svg.append('g').attr('class', 'radar-corners')
  const axes = svg.append('g').attr('class', 'radar-axes')
  const trailLayer = svg.append('g').attr('class', 'radar-trails')
  const spreadLayer = svg.append('g').attr('class', 'radar-spreads')
  const bubbleLayer = svg.append('g').attr('class', 'radar-bubbles')

  let state: ChartState | null = null
  let box: PlotBox = plotBox({ width: 0, height: 0 })
  const at = (d: { adoption: number; value: number }) => toPixel(box, d.adoption, d.value)
  const translate = (d: { adoption: number; value: number }) => {
    const p = at(d)
    return `translate(${p.x},${p.y})`
  }
  // Apply attributes through a transition only when animating (duration 0 = synchronous, for tests).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx = (sel: any) =>
    state && state.duration > 0
      ? sel.transition().duration(state.duration).ease(d3.easeCubicInOut)
      : sel

  const drag = d3
    .drag<SVGGElement, ChartBubble>()
    .clickDistance(4)
    .filter(() => state?.editable === true)
    .subject((_event, d) => at(d))
    .on('drag', function (event) {
      d3.select(this)
        .attr('transform', `translate(${event.x},${event.y})`)
        .classed('is-outside', !fromPixel(box, event.x, event.y).inside)
    })
    .on('end', function (event, d) {
      d3.select(this).classed('is-outside', false)
      if (Math.hypot(event.x - event.subject.x, event.y - event.subject.y) < 4) return
      const drop = resolveDrop(box, event.x, event.y)
      if (drop.type === 'remove') callbacks.onRemove(d.practiceId)
      else callbacks.onMove(d.practiceId, drop.adoption, drop.value)
    })

  function renderStatic(next: ChartState) {
    const { width, height } = next.size
    svg
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`)
      .classed('editing-past', next.editingPast)
    background.attr('width', width).attr('height', height)
    frame.attr('x', box.left).attr('y', box.top).attr('width', box.width).attr('height', box.height)
    const cx = box.left + box.width / 2
    const cy = box.top + box.height / 2
    midX.attr('x1', cx).attr('x2', cx).attr('y1', box.top).attr('y2', box.top + box.height)
    midY.attr('x1', box.left).attr('x2', box.left + box.width).attr('y1', cy).attr('y2', cy)
    dateText.attr('x', cx).attr('y', cy).text(next.dateLabel)

    const pad = 8
    const cornerData = [
      { text: CORNER_LABELS.topLeft, x: box.left + pad, y: box.top + 16, anchor: 'start' },
      { text: CORNER_LABELS.topRight, x: box.left + box.width - pad, y: box.top + 16, anchor: 'end' },
      { text: CORNER_LABELS.bottomRight, x: box.left + box.width - pad, y: box.top + box.height - pad, anchor: 'end' },
      { text: CORNER_LABELS.bottomLeft, x: box.left + pad, y: box.top + box.height - pad, anchor: 'start' },
    ]
    corners
      .selectAll('text')
      .data(cornerData)
      .join('text')
      .attr('x', (d) => d.x)
      .attr('y', (d) => d.y)
      .attr('text-anchor', (d) => d.anchor)
      .text((d) => d.text)

    axes
      .selectAll('text')
      .data([
        { text: 'Adoption / usage →', x: cx, y: box.top + box.height + 24, rotate: 0 },
        { text: 'Perceived value →', x: box.left - 14, y: cy, rotate: -90 },
      ])
      .join('text')
      .attr('text-anchor', 'middle')
      .attr('transform', (d) => `translate(${d.x},${d.y}) rotate(${d.rotate})`)
      .text((d) => d.text)
  }

  function renderTrails(next: ChartState) {
    const categoryOf = new Map(next.bubbles.map((b) => [b.practiceId, b.category]))
    const data = next.selected
      .filter((id) => (next.trails[id]?.length ?? 0) > 1 && categoryOf.has(id))
      .map((id) => ({ id, points: next.trails[id], category: categoryOf.get(id)! }))
    const line = d3.line<LabelledPoint>((p) => at(p).x, (p) => at(p).y)
    trailLayer
      .selectAll<SVGGElement, (typeof data)[number]>('g.radar-trail')
      .data(data, (d) => String(d.id))
      .join('g')
      .attr('class', 'radar-trail')
      .each(function (d) {
        const g = d3.select(this)
        g.selectAll('path')
          .data([d])
          .join('path')
          .attr('d', line(d.points))
          .style('stroke', categoryColor(d.category))
        const history = d.points.slice(0, -1)
        g.selectAll('circle')
          .data(history)
          .join('circle')
          .attr('r', 3)
          .attr('cx', (p) => at(p).x)
          .attr('cy', (p) => at(p).y)
        g.selectAll('text')
          .data(history)
          .join('text')
          .attr('x', (p) => at(p).x)
          .attr('y', (p) => at(p).y - 7)
          .text((p) => p.label)
      })
  }

  function renderSpread(next: ChartState, selected: Set<number>) {
    const data =
      next.scope === 'org'
        ? next.bubbles.filter((b) => selected.has(b.practiceId) && b.teamPositions?.length)
        : []
    spreadLayer
      .selectAll<SVGGElement, ChartBubble>('g.radar-spread')
      .data(data, (d) => String(d.practiceId))
      .join('g')
      .attr('class', 'radar-spread')
      .each(function (b) {
        const g = d3.select(this)
        const center = at(b)
        const dots = b.teamPositions ?? []
        g.selectAll('line')
          .data(dots)
          .join('line')
          .attr('x1', center.x)
          .attr('y1', center.y)
          .attr('x2', (t) => at(t).x)
          .attr('y2', (t) => at(t).y)
        g.selectAll('circle')
          .data(dots)
          .join('circle')
          .attr('r', 4)
          .attr('cx', (t) => at(t).x)
          .attr('cy', (t) => at(t).y)
        g.selectAll('text')
          .data(dots)
          .join('text')
          .attr('x', (t) => at(t).x + 6)
          .attr('y', (t) => at(t).y + 3)
          .text((t) => t.teamName)
      })
    return data.length > 0
  }

  function renderBubbles(next: ChartState, selected: Set<number>, spreading: boolean) {
    const maxTeams = d3.max(next.bubbles, (b) => b.teams) ?? 1
    const radius = (d: ChartBubble) => bubbleRadius(d.teams, maxTeams, next.scope)
    const query = next.highlight.trim().toLowerCase()

    const join = bubbleLayer
      .selectAll<SVGGElement, ChartBubble>('g.radar-bubble')
      .data(next.bubbles, (d) => String(d.practiceId))

    const entered = join
      .enter()
      .append('g')
      .attr('class', 'radar-bubble')
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('transform', translate)
      .style('opacity', next.duration > 0 ? 0 : 1)
    entered.append('circle')
    entered.append('text').attr('class', 'radar-label')
    entered
      .on('click', (event: MouseEvent, d) => {
        event.stopPropagation()
        callbacks.onSelect(d.practiceId, event.shiftKey)
      })
      .on('keydown', (event: KeyboardEvent, d) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          callbacks.onSelect(d.practiceId, event.shiftKey)
          return
        }
        if (!state?.editable) return
        const moved = nudge(d, event.key, event.shiftKey)
        if (moved) {
          event.preventDefault()
          callbacks.onNudge(d.practiceId, moved.adoption, moved.value)
        }
      })
      .call(drag)

    const merged = entered.merge(join)
    merged
      .attr('aria-label', (d) => `${d.name}, ${positionLabel(d.adoption, d.value)}`)
      .classed('is-selected', (d) => selected.has(d.practiceId))
      .classed(
        'is-dim',
        (d) =>
          (query !== '' && !d.name.toLowerCase().includes(query)) ||
          (spreading && !selected.has(d.practiceId)),
      )
    merged
      .select<SVGCircleElement>('circle')
      .attr('r', radius)
      .style('fill', (d) => categoryColor(d.category))
    merged
      .select<SVGTextElement>('text')
      .attr('y', (d) => radius(d) + 12)
      .text((d) => d.name)
    tx(merged).attr('transform', translate).style('opacity', 1)

    const exit = join.exit()
    if (next.duration > 0) exit.transition().duration(next.duration).style('opacity', 0).remove()
    else exit.remove()
  }

  return {
    update(next: ChartState) {
      state = next
      box = plotBox(next.size)
      const selected = new Set(next.selected)
      renderStatic(next)
      renderTrails(next)
      const spreading = renderSpread(next, selected)
      renderBubbles(next, selected, spreading)
    },
    destroy() {
      svg.selectAll('*').interrupt().remove()
    },
  }
}
```

`frontend/src/chart/radar.css`:
```css
.radar { display: block; user-select: none; }
.radar-bg { fill: transparent; }
.radar-frame { fill: var(--surface); stroke: var(--border); }
.radar.editing-past .radar-frame { stroke: var(--edit-past); stroke-width: 3; }
.radar-mid { stroke: var(--border); stroke-dasharray: 4 4; }
.radar-corners text { fill: var(--text-muted); font-size: 12px; opacity: 0.8; }
.radar-axes text { fill: var(--text-muted); font-size: 12px; }
.radar-date {
  fill: var(--text); opacity: 0.06; font-size: 88px; font-weight: 800;
  text-anchor: middle; dominant-baseline: middle; pointer-events: none; text-transform: uppercase;
}
.radar-bubble { cursor: pointer; outline: none; }
.radar-bubble circle { stroke: var(--surface); stroke-width: 2; opacity: 0.92; }
.radar-bubble.is-selected circle,
.radar-bubble:focus-visible circle { stroke: var(--accent); stroke-width: 3; }
.radar-bubble.is-dim circle,
.radar-bubble.is-dim text { opacity: 0.2; }
.radar-bubble.is-outside circle { stroke: var(--danger); stroke-dasharray: 3 2; }
.radar-label { fill: var(--text); font-size: 11px; text-anchor: middle; pointer-events: none; }
.radar-trail path { fill: none; stroke-width: 1.5; opacity: 0.7; }
.radar-trail circle { fill: var(--text-muted); opacity: 0.7; }
.radar-trail text { fill: var(--text-muted); font-size: 10px; text-anchor: middle; }
.radar-spread line { stroke: var(--text-muted); opacity: 0.5; }
.radar-spread circle { fill: var(--text-muted); }
.radar-spread text { fill: var(--text-muted); font-size: 10px; }
```

- [ ] **Step 5: Implement the size hook and the React wrapper**

`frontend/src/lib/useElementSize.ts`:
```ts
import { useEffect, useState, type RefObject } from 'react'
import type { Size } from '../chart/geometry'

export function useElementSize(
  ref: RefObject<HTMLElement | null>,
  fallback: Size = { width: 640, height: 480 },
): Size {
  const [size, setSize] = useState<Size>(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setSize({ width, height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return size
}
```

`frontend/src/chart/RadarChart.tsx`:
```tsx
import { useEffect, useRef, type DragEvent } from 'react'
import { useElementSize } from '../lib/useElementSize'
import { fromPixel, plotBox } from './geometry'
import './radar.css'
import {
  createRadar,
  PRACTICE_MIME,
  type ChartCallbacks,
  type ChartState,
} from './renderRadar'

type Props = Omit<ChartState, 'size'> &
  ChartCallbacks & {
    onDropPractice?: (practiceId: number, adoption: number, value: number) => void
  }

export default function RadarChart(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const radarRef = useRef<ReturnType<typeof createRadar> | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const size = useElementSize(containerRef)

  useEffect(() => {
    const radar = createRadar(svgRef.current!, {
      onSelect: (...args) => propsRef.current.onSelect(...args),
      onMove: (...args) => propsRef.current.onMove(...args),
      onRemove: (...args) => propsRef.current.onRemove(...args),
      onNudge: (...args) => propsRef.current.onNudge(...args),
    })
    radarRef.current = radar
    return () => radar.destroy()
  }, [])

  const { scope, bubbles, dateLabel, selected, trails, editable, editingPast, highlight, duration } =
    props
  useEffect(() => {
    radarRef.current?.update({
      size,
      scope,
      bubbles,
      dateLabel,
      selected,
      trails,
      editable,
      editingPast,
      highlight,
      duration,
    })
  }, [size, scope, bubbles, dateLabel, selected, trails, editable, editingPast, highlight, duration])

  function onDragOver(event: DragEvent) {
    if (props.editable && Array.from(event.dataTransfer.types).includes(PRACTICE_MIME)) {
      event.preventDefault()
    }
  }

  function onDrop(event: DragEvent) {
    const id = Number(event.dataTransfer.getData(PRACTICE_MIME))
    if (!id || !props.onDropPractice) return
    event.preventDefault()
    const rect = svgRef.current!.getBoundingClientRect()
    const point = fromPixel(plotBox(size), event.clientX - rect.left, event.clientY - rect.top)
    if (point.inside) props.onDropPractice(id, point.adoption, point.value)
  }

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', flex: 1, minHeight: 360 }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <svg ref={svgRef} role="group" aria-label="Radar chart" />
    </div>
  )
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- src/chart && npm run typecheck`
Expected: every chart test passes (21: 8 geometry, 5 frames, 8 renderer), plus the 1 RadarChart test. There are no type errors. If the drop test fails because jsdom's `DataTransfer` doesn't match, check that `fireEvent.drop` receives the `dataTransfer` object exactly as written. Testing Library assigns it to the event.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/chart frontend/src/lib/useElementSize.ts
git commit -m "feat(frontend): add D3 radar renderer with drag, trails and org spread"
```

### Task 6: Editor (sanitized view, markdown editor, Milkdown rich editor, mode toggle)

This task settles the spec's open item: **Milkdown Crepe** is the rich editor. The spike in Step 1 is a round-trip test over the spec's criteria (headings, lists, links, code blocks, GFM tables). It compares the *rendered HTML* of the original markdown with Crepe's output, so harmless re-formatting (`*` vs `-` bullets) doesn't count as a failure.

**Files:**
- Create: `frontend/src/editor/MarkdownView.tsx`, `frontend/src/editor/Markdown.module.css`, `frontend/src/editor/markdownActions.ts`, `frontend/src/editor/MarkdownEditor.tsx`, `frontend/src/editor/RichEditor.tsx`, `frontend/src/editor/Editor.tsx`, `frontend/src/editor/Editor.module.css`
- Test: `frontend/src/editor/roundtrip.test.tsx` (the spike), `markdownActions.test.ts`, `MarkdownView.test.tsx`, `MarkdownEditor.test.tsx` and `Editor.test.tsx`, all in `frontend/src/editor/`

**Interfaces:**
- Consumes: `readString` / `writeString`
- Produces:
  - `MarkdownView({ source }: { source: string })`, the **only** markdown renderer in the app
  - `type ToolbarAction = 'bold' | 'heading' | 'list' | 'link' | 'code'`
  - `applyMarkdownAction(text, start, end, action): { value: string; selectionStart: number; selectionEnd: number }`
  - `MarkdownEditor({ value, onChange, label })`, a controlled component with Write/Preview tabs
  - `RichEditor({ value, onChange, label })`, which is **uncontrolled after mount**. Change its `key` to load a different value.
  - `EDITOR_MODE_KEY = 'aiRadar.editorMode'` and `type EditorMode = 'rich' | 'markdown'`
  - `Editor({ value, onChange, label })`, a Rich/Markdown toggle that defaults to `rich` and remembers the choice

- [ ] **Step 1: Spike: write the round-trip test for Crepe**

`frontend/src/editor/roundtrip.test.tsx`:
```tsx
import { Crepe } from '@milkdown/crepe'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import MarkdownView from './MarkdownView'

const FIXTURE = `## Getting started

Install with \`npm i -g tool\` and read the [docs](https://example.com/docs).

- Spec first
- Then plan
  - nested item

1. One
2. Two

\`\`\`ts
const x = 1
\`\`\`

| Tool | Use |
| ---- | --- |
| Claude Code | Refactors |
`

beforeAll(() => {
  // Minimal browser APIs ProseMirror/Crepe touch that jsdom lacks.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  window.matchMedia ??= (() => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia
  const rect = { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }
  Range.prototype.getBoundingClientRect ??= () => ({ ...rect, toJSON() {} }) as DOMRect
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList
  document.elementFromPoint ??= () => null
})

const html = (md: string) => renderToStaticMarkup(<MarkdownView source={md} />)

describe('Milkdown Crepe markdown round-trip (spec §6 criteria)', () => {
  it('preserves headings, lists, links, code blocks and GFM tables', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const crepe = new Crepe({ root, defaultValue: FIXTURE })
    await crepe.create()
    const output = crepe.getMarkdown()
    await crepe.destroy()
    expect(html(output)).toBe(html(FIXTURE))
  })
})
```

Before the implementation exists, this test only fails on the missing `MarkdownView`. Do Step 4 (`MarkdownView`) first, then run:

Run: `npm test -- src/editor/roundtrip.test.tsx`
Expected: PASS.

**What to do if it fails:**
- If the only difference is cosmetic in the HTML (for example, whitespace inside `<code>`), normalize by collapsing whitespace in `html()` and re-run.
- If Crepe cannot initialise in jsdom even with the polyfills above, move this exact check into Plan 3's Playwright suite, mark this test `it.skip` with a comment pointing there, and continue.
- If content is actually **lost or changed** (table dropped, nesting flattened, link removed), **stop and report back**. Don't swap editor libraries without a decision from the user.

- [ ] **Step 2: Write the failing unit tests**

`frontend/src/editor/markdownActions.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { applyMarkdownAction } from './markdownActions'

describe('applyMarkdownAction', () => {
  it('wraps the selection in bold', () => {
    expect(applyMarkdownAction('make this bold', 5, 9, 'bold')).toEqual({
      value: 'make **this** bold',
      selectionStart: 7,
      selectionEnd: 11,
    })
  })

  it('inserts and selects a placeholder when nothing is selected', () => {
    expect(applyMarkdownAction('ab', 1, 1, 'bold')).toEqual({
      value: 'a**bold text**b',
      selectionStart: 3,
      selectionEnd: 12,
    })
  })

  it('turns the current line into a heading', () => {
    expect(applyMarkdownAction('one\ntwo', 5, 5, 'heading').value).toBe('one\n## two')
  })

  it('prefixes every selected line with a bullet', () => {
    expect(applyMarkdownAction('a\nb\nc', 0, 3, 'list').value).toBe('- a\n- b\nc')
  })

  it('wraps the selection in a link and selects the url', () => {
    const result = applyMarkdownAction('see docs', 4, 8, 'link')
    expect(result.value).toBe('see [docs](https://)')
    expect(result.value.slice(result.selectionStart, result.selectionEnd)).toBe('https://')
  })

  it('uses inline code for one line and a fence for several', () => {
    expect(applyMarkdownAction('run npm', 4, 7, 'code').value).toBe('run `npm`')
    expect(applyMarkdownAction('a\nb', 0, 3, 'code').value).toBe('```\na\nb\n```')
  })
})
```

`frontend/src/editor/MarkdownView.test.tsx`:
```tsx
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import MarkdownView from './MarkdownView'

describe('MarkdownView', () => {
  it('renders GFM tables', () => {
    const { container } = render(<MarkdownView source={'| a | b |\n| - | - |\n| 1 | 2 |'} />)
    expect(container.querySelector('table td')?.textContent).toBe('1')
  })

  it('never renders raw HTML or script URLs', () => {
    const { container } = render(
      <MarkdownView
        source={'<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[x](javascript:alert(1))'}
      />,
    )
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('a')?.getAttribute('href') ?? '').not.toContain('javascript:')
  })
})
```

`frontend/src/editor/MarkdownEditor.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import MarkdownEditor from './MarkdownEditor'

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <MarkdownEditor value={value} onChange={setValue} label="Guidance" />
      <output data-testid="value">{value}</output>
    </>
  )
}

describe('MarkdownEditor', () => {
  it('edits text and applies toolbar actions', async () => {
    render(<Harness />)
    const textarea = screen.getByRole('textbox', { name: 'Guidance' })
    await userEvent.type(textarea, 'hello')
    textarea.setSelectionRange(0, 5)
    await userEvent.click(screen.getByRole('button', { name: 'Bold' }))
    expect(screen.getByTestId('value')).toHaveTextContent('**hello**')
  })

  it('shows a rendered preview', async () => {
    render(<Harness initial="## Title" />)
    await userEvent.click(screen.getByRole('tab', { name: 'Preview' }))
    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument()
  })
})
```

`frontend/src/editor/Editor.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import Editor, { EDITOR_MODE_KEY } from './Editor'

vi.mock('./RichEditor', () => ({
  default: ({ label }: { label: string }) => <div data-testid="rich" aria-label={label} />,
}))

describe('Editor', () => {
  it('defaults to rich mode', () => {
    render(<Editor value="x" onChange={() => {}} label="Guidance" />)
    expect(screen.getByTestId('rich')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Rich' })).toHaveAttribute('aria-checked', 'true')
  })

  it('switches to markdown and remembers the choice', async () => {
    const { unmount } = render(<Editor value="x" onChange={() => {}} label="Guidance" />)
    await userEvent.click(screen.getByRole('radio', { name: 'Markdown' }))
    expect(screen.getByRole('textbox', { name: 'Guidance' })).toBeInTheDocument()
    expect(localStorage.getItem(EDITOR_MODE_KEY)).toBe('markdown')
    unmount()
    render(<Editor value="x" onChange={() => {}} label="Guidance" />)
    expect(screen.getByRole('textbox', { name: 'Guidance' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- src/editor`
Expected: FAIL, because the modules can't be resolved yet.

- [ ] **Step 4: Implement `MarkdownView` and the markdown actions**

`frontend/src/editor/MarkdownView.tsx`:
```tsx
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import styles from './Markdown.module.css'

export default function MarkdownView({ source }: { source: string }) {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {source}
      </ReactMarkdown>
    </div>
  )
}
```

`frontend/src/editor/Markdown.module.css`:
```css
.markdown { line-height: 1.6; overflow-wrap: anywhere; }
.markdown h1, .markdown h2, .markdown h3 { margin: 1.2em 0 0.4em; line-height: 1.25; }
.markdown pre { background: var(--surface-2); padding: var(--space-3); border-radius: var(--radius-sm); overflow-x: auto; }
.markdown code { font-family: var(--font-mono); font-size: 0.92em; }
.markdown table { border-collapse: collapse; display: block; overflow-x: auto; }
.markdown th, .markdown td { border: 1px solid var(--border); padding: var(--space-1) var(--space-2); }
```

`frontend/src/editor/markdownActions.ts`:
```ts
export type ToolbarAction = 'bold' | 'heading' | 'list' | 'link' | 'code'

type Result = { value: string; selectionStart: number; selectionEnd: number }

function wrap(text: string, start: number, end: number, before: string, after: string, placeholder: string): Result {
  const selected = text.slice(start, end) || placeholder
  const value = text.slice(0, start) + before + selected + after + text.slice(end)
  return { value, selectionStart: start + before.length, selectionEnd: start + before.length + selected.length }
}

function prefixLines(text: string, start: number, end: number, prefix: string): Result {
  const lineStart = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1
  const endIndex = text.indexOf('\n', end)
  const lineEnd = endIndex === -1 ? text.length : endIndex
  const block = text.slice(lineStart, lineEnd)
  const prefixed = block
    .split('\n')
    .map((line) => prefix + line)
    .join('\n')
  const value = text.slice(0, lineStart) + prefixed + text.slice(lineEnd)
  return { value, selectionStart: lineStart, selectionEnd: lineStart + prefixed.length }
}

export function applyMarkdownAction(text: string, start: number, end: number, action: ToolbarAction): Result {
  switch (action) {
    case 'bold':
      return wrap(text, start, end, '**', '**', 'bold text')
    case 'heading':
      return prefixLines(text, start, start, '## ')
    case 'list': {
      // A selection ending exactly after a newline should not bullet the next line.
      const effectiveEnd = end > start && text[end - 1] === '\n' ? end - 1 : end
      return prefixLines(text, start, effectiveEnd, '- ')
    }
    case 'link': {
      const label = text.slice(start, end) || 'link text'
      const value = text.slice(0, start) + `[${label}](https://)` + text.slice(end)
      const urlStart = start + label.length + 3
      return { value, selectionStart: urlStart, selectionEnd: urlStart + 'https://'.length }
    }
    case 'code':
      return text.slice(start, end).includes('\n')
        ? wrap(text, start, end, '```\n', '\n```', '')
        : wrap(text, start, end, '`', '`', 'code')
  }
}
```

- [ ] **Step 5: Implement the editors and the toggle**

`frontend/src/editor/MarkdownEditor.tsx`:
```tsx
import { useRef, useState } from 'react'
import styles from './Editor.module.css'
import { applyMarkdownAction, type ToolbarAction } from './markdownActions'
import MarkdownView from './MarkdownView'

type Props = { value: string; onChange: (value: string) => void; label: string }

const TOOLBAR: { action: ToolbarAction; label: string; glyph: string }[] = [
  { action: 'bold', label: 'Bold', glyph: 'B' },
  { action: 'heading', label: 'Heading', glyph: 'H' },
  { action: 'list', label: 'Bulleted list', glyph: '•' },
  { action: 'link', label: 'Link', glyph: '🔗' },
  { action: 'code', label: 'Code', glyph: '</>' },
]

export default function MarkdownEditor({ value, onChange, label }: Props) {
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function apply(action: ToolbarAction) {
    const el = textareaRef.current!
    const result = applyMarkdownAction(value, el.selectionStart, el.selectionEnd, action)
    onChange(result.value)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(result.selectionStart, result.selectionEnd)
    })
  }

  return (
    <div className={styles.markdownEditor}>
      <div role="tablist" className={styles.tabs}>
        <button role="tab" aria-selected={tab === 'write'} onClick={() => setTab('write')}>
          Write
        </button>
        <button role="tab" aria-selected={tab === 'preview'} onClick={() => setTab('preview')}>
          Preview
        </button>
      </div>
      {tab === 'write' ? (
        <>
          <div className={styles.toolbar} role="toolbar" aria-label="Formatting">
            {TOOLBAR.map((t) => (
              <button key={t.action} type="button" aria-label={t.label} title={t.label} onClick={() => apply(t.action)}>
                {t.glyph}
              </button>
            ))}
          </div>
          <textarea
            ref={textareaRef}
            aria-label={label}
            className={styles.textarea}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={12}
          />
        </>
      ) : (
        <div className={styles.preview}>
          <MarkdownView source={value || '_Nothing to preview._'} />
        </div>
      )}
    </div>
  )
}
```

`frontend/src/editor/RichEditor.tsx`:
```tsx
import { Crepe } from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import { useEffect, useRef } from 'react'
import styles from './Editor.module.css'

type Props = { value: string; onChange: (value: string) => void; label: string }

/** Uncontrolled after mount: change `key` to load a different value. */
export default function RichEditor({ value, onChange, label }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const initialValue = useRef(value)

  useEffect(() => {
    const crepe = new Crepe({ root: rootRef.current!, defaultValue: initialValue.current })
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => onChangeRef.current(markdown))
    })
    void crepe.create()
    return () => {
      void crepe.destroy()
    }
  }, [])

  return <div ref={rootRef} role="group" aria-label={label} className={styles.rich} />
}
```

`frontend/src/editor/Editor.tsx`:
```tsx
import { useState } from 'react'
import { readString, writeString } from '../lib/storage'
import styles from './Editor.module.css'
import MarkdownEditor from './MarkdownEditor'
import RichEditor from './RichEditor'

export const EDITOR_MODE_KEY = 'aiRadar.editorMode'
export type EditorMode = 'rich' | 'markdown'

function readMode(): EditorMode {
  return readString(EDITOR_MODE_KEY) === 'markdown' ? 'markdown' : 'rich'
}

type Props = { value: string; onChange: (value: string) => void; label: string }

export default function Editor({ value, onChange, label }: Props) {
  const [mode, setMode] = useState<EditorMode>(readMode)

  function switchTo(next: EditorMode) {
    writeString(EDITOR_MODE_KEY, next)
    setMode(next)
  }

  return (
    <div className={styles.editor}>
      <div role="radiogroup" aria-label="Editor mode" className={styles.modes}>
        {(['rich', 'markdown'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => switchTo(m)}
          >
            {m === 'rich' ? 'Rich' : 'Markdown'}
          </button>
        ))}
      </div>
      {mode === 'rich' ? (
        <RichEditor value={value} onChange={onChange} label={label} />
      ) : (
        <MarkdownEditor value={value} onChange={onChange} label={label} />
      )}
    </div>
  )
}
```

`frontend/src/editor/Editor.module.css`:
```css
.editor { display: flex; flex-direction: column; gap: var(--space-2); }
.modes { display: inline-flex; align-self: flex-end; }
.modes button { border-radius: 0; }
.modes button:first-child { border-radius: var(--radius-sm) 0 0 var(--radius-sm); }
.modes button:last-child { border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
.modes button[aria-checked='true'] { background: var(--accent); color: var(--accent-contrast); }
.markdownEditor { display: flex; flex-direction: column; }
.tabs { display: flex; gap: var(--space-1); }
.tabs button[aria-selected='true'] { font-weight: 600; background: var(--surface-2); }
.toolbar { display: flex; gap: var(--space-1); padding: var(--space-1) 0; }
.textarea { width: 100%; font-family: var(--font-mono); min-height: 200px; resize: vertical; }
.preview { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: var(--space-3); min-height: 200px; }
.rich { border: 1px solid var(--border); border-radius: var(--radius-sm); min-height: 200px; background: var(--surface); }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- src/editor && npm run typecheck && npm run build`
Expected: all editor tests pass (1 round-trip, 6 action, 2 view, 2 markdown editor and 2 editor tests), there are no type errors, and the build succeeds. The Crepe CSS is bundled.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/editor
git commit -m "feat(frontend): add sanitized markdown view and Rich/Markdown editor"
```

### Task 7: Radar side components (Timeline, Tray, Drawer with team note, UnsavedChangesBar)

**Files:**
- Create: `frontend/src/components/Timeline.tsx`, `Tray.tsx`, `Drawer.tsx`, `UnsavedChangesBar.tsx`, `Panels.module.css`
- Modify: `frontend/src/test/render.tsx` (add `renderWithProviders`)
- Test: `frontend/src/components/Timeline.test.tsx`, `Tray.test.tsx`, `Drawer.test.tsx`, `UnsavedChangesBar.test.tsx`

**Interfaces:**
- Consumes: `formatFrameDate`, `PRACTICE_MIME`, `positionLabel` / `PositionLabel`, `useNote`, `usePutNote`, `keys`, `isConflict`, `conflictCurrent`, `useToast`, `useNamePrompt`, `Editor`, `MarkdownView`, `CategoryChip` and `toRef`
- Produces:
  - `FRAME_MS = 800`
  - `Timeline` props:
    - `dates: string[]`, `index: number`, `step: Step`
    - `playing: boolean`, `canEdit: boolean`, `unlocked: boolean`
    - `onIndexChange(i)`, `onPlayingChange(p)`, `onStepChange(s)`, `onUnlockedChange(u)`
  - The last date is labelled **"Now"**. "Edit here" appears only when `canEdit` is true and the index isn't the last one.
  - `Tray({ practices: PracticeListItem[]; editable: boolean; onPlace(practiceId: number): void })`
  - `DrawerPractice = { id: number; name: string; slug: string; category: Category; summary: string }`
  - `Drawer` props:
    - `scope: 'team' | 'org'`, `practice: DrawerPractice`, `label: PositionLabel`
    - `teamId?: number` (team scope, used for the note)
    - `teams?: { teamId: number; teamName: string; label: PositionLabel }[]` (org scope)
    - `canRemove: boolean`, `onRemove(): void`, `onClose(): void`
  - `UnsavedChangesBar({ count, saving, onSave, onDiscard })` renders nothing when `count` is 0
  - `renderWithProviders(ui: ReactElement)` in `src/test/render.tsx`

- [ ] **Step 1: Add `renderWithProviders`**

Append to `frontend/src/test/render.tsx`, merging the imports at the top:
```tsx
import type { ReactElement } from 'react'

export function renderWithProviders(ui: ReactElement) {
  const router = createMemoryRouter([{ path: '*', element: ui }], { initialEntries: ['/'] })
  const client = createTestQueryClient()
  const result = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <NamePromptProvider>
          <RouterProvider router={router} />
        </NamePromptProvider>
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { router, client, ...result }
}
```

- [ ] **Step 2: Write the failing tests**

`frontend/src/components/Timeline.test.tsx`:
```tsx
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Step } from '../api/types'
import Timeline, { FRAME_MS } from './Timeline'

const DATES = ['2026-01-31T23:59:59Z', '2026-02-28T23:59:59Z', '2026-03-13T10:00:00Z']

function Harness({ canEdit = true, initialIndex = 2 }) {
  const [index, setIndex] = useState(initialIndex)
  const [playing, setPlaying] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  const [step, setStep] = useState<Step>('month')
  return (
    <>
      <Timeline
        dates={DATES}
        index={index}
        step={step}
        playing={playing}
        canEdit={canEdit}
        unlocked={unlocked}
        onIndexChange={setIndex}
        onPlayingChange={setPlaying}
        onStepChange={setStep}
        onUnlockedChange={setUnlocked}
      />
      <output data-testid="state">{JSON.stringify({ index, playing, unlocked, step })}</output>
    </>
  )
}

const state = () => JSON.parse(screen.getByTestId('state').textContent!)

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Timeline', () => {
  it('labels the latest frame as Now and past frames by period', () => {
    render(<Harness />)
    expect(screen.getByText('Now')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('slider', { name: 'Timeline' }), { target: { value: '0' } })
    expect(screen.getByText('Jan 2026')).toBeInTheDocument()
  })

  it('plays from the start when at the end and stops at the last frame', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(state()).toMatchObject({ index: 0, playing: true })
    act(() => vi.advanceTimersByTime(FRAME_MS))
    expect(state().index).toBe(1)
    act(() => vi.advanceTimersByTime(FRAME_MS))
    expect(state().index).toBe(2)
    act(() => vi.advanceTimersByTime(FRAME_MS))
    expect(state().playing).toBe(false)
  })

  it('offers Edit here only in the past on editable radars', () => {
    const { unmount } = render(<Harness initialIndex={0} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit here' }))
    expect(state().unlocked).toBe(true)
    expect(screen.getByText(/Editing Jan 2026/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Lock' }))
    expect(state().unlocked).toBe(false)
    unmount()
    render(<Harness initialIndex={2} />)
    expect(screen.queryByRole('button', { name: 'Edit here' })).not.toBeInTheDocument()
  })

  it('hides Edit here on read-only radars and changes step', () => {
    render(<Harness canEdit={false} initialIndex={0} />)
    expect(screen.queryByRole('button', { name: 'Edit here' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'Step' }), { target: { value: 'week' } })
    expect(state().step).toBe('week')
  })
})
```

`frontend/src/components/Tray.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PRACTICE_MIME } from '../chart/renderRadar'
import { listItem } from '../test/fixtures'
import Tray from './Tray'

const practices = [
  listItem({ id: 12, name: 'Prompt library', category: 'workflow' }),
  listItem({ id: 13, name: 'MCP servers' }),
]

describe('Tray', () => {
  it('filters and places practices', async () => {
    const onPlace = vi.fn()
    render(<Tray practices={practices} editable onPlace={onPlace} />)
    await userEvent.type(screen.getByRole('searchbox', { name: 'Filter practices' }), 'mcp')
    expect(screen.queryByText('Prompt library')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Place MCP servers' }))
    expect(onPlace).toHaveBeenCalledWith(13)
  })

  it('puts the practice id on drag', () => {
    render(<Tray practices={practices} editable onPlace={() => {}} />)
    const setData = vi.fn()
    fireEvent.dragStart(screen.getByText('Prompt library'), { dataTransfer: { setData, effectAllowed: '' } })
    expect(setData).toHaveBeenCalledWith(PRACTICE_MIME, '12')
  })

  it('is inert when not editable', () => {
    render(<Tray practices={practices} editable={false} onPlace={() => {}} />)
    expect(screen.getByRole('button', { name: 'Place MCP servers' })).toBeDisabled()
  })

  it('shows an empty state', () => {
    render(<Tray practices={[]} editable onPlace={() => {}} />)
    expect(screen.getByText(/everything in the catalog is on this radar/i)).toBeInTheDocument()
  })
})
```

`frontend/src/components/Drawer.test.tsx`:
```tsx
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EDITOR_MODE_KEY } from '../editor/Editor'
import { setEditedBy } from '../lib/editedBy'
import { note } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import Drawer from './Drawer'

const practice = { id: 10, name: 'Claude Code', slug: 'claude-code', category: 'tool' as const, summary: 'Agentic coding.' }

beforeEach(() => {
  setEditedBy('Kim')
  localStorage.setItem(EDITOR_MODE_KEY, 'markdown')
})

describe('Drawer', () => {
  it('shows team details, note and links', async () => {
    server.use(http.get('/api/teams/1/notes/10', () => HttpResponse.json(note())))
    const onRemove = vi.fn()
    renderWithProviders(
      <Drawer scope="team" practice={practice} label="Core" teamId={1} canRemove onRemove={onRemove} onClose={() => {}} />,
    )
    expect(screen.getByRole('complementary', { name: 'Details for Claude Code' })).toBeInTheDocument()
    expect(screen.getByText('Core')).toBeInTheDocument()
    expect(await screen.findByText('We use it for refactors.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open page' })).toHaveAttribute('href', '/practices/10-claude-code')
    await userEvent.click(screen.getByRole('button', { name: 'Remove from radar' }))
    expect(onRemove).toHaveBeenCalledOnce()
  })

  it('edits the team note', async () => {
    let body: unknown
    server.use(
      http.get('/api/teams/1/notes/10', () => HttpResponse.json(note())),
      http.put('/api/teams/1/notes/10', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(note({ body_md: 'Updated', version: 2 }))
      }),
    )
    renderWithProviders(
      <Drawer scope="team" practice={practice} label="Core" teamId={1} canRemove onRemove={() => {}} onClose={() => {}} />,
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Edit note' }))
    const textarea = screen.getByRole('textbox', { name: 'How we use it' })
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'Updated')
    await userEvent.click(screen.getByRole('button', { name: 'Save note' }))
    await waitFor(() => expect(body).toEqual({ version: 1, body_md: 'Updated' }))
  })

  it('keeps the draft when someone else saved first', async () => {
    server.use(
      http.get('/api/teams/1/notes/10', () => HttpResponse.json(note())),
      http.put('/api/teams/1/notes/10', () =>
        HttpResponse.json(
          { detail: 'changed', current: note({ body_md: 'Their text', version: 2 }) },
          { status: 409 },
        ),
      ),
    )
    renderWithProviders(
      <Drawer scope="team" practice={practice} label="Core" teamId={1} canRemove onRemove={() => {}} onClose={() => {}} />,
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Edit note' }))
    const textarea = screen.getByRole('textbox', { name: 'How we use it' })
    await userEvent.type(textarea, ' mine')
    await userEvent.click(screen.getByRole('button', { name: 'Save note' }))
    expect(await screen.findByText(/someone else saved this note/i)).toBeInTheDocument()
    expect(screen.getByText('Their text')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'How we use it' })).toHaveValue('We use it for refactors. mine')
  })

  it('lists teams in the org scope without remove', () => {
    renderWithProviders(
      <Drawer
        scope="org"
        practice={practice}
        label="Core"
        teams={[
          { teamId: 1, teamName: 'Platform', label: 'Core' },
          { teamId: 2, teamName: 'Payments', label: 'Hidden gem' },
        ]}
        canRemove={false}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText('Payments')).toBeInTheDocument()
    expect(screen.getByText('Hidden gem')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove from radar' })).not.toBeInTheDocument()
  })
})
```

`frontend/src/components/UnsavedChangesBar.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import UnsavedChangesBar from './UnsavedChangesBar'

describe('UnsavedChangesBar', () => {
  it('renders nothing without changes', () => {
    const { container } = render(<UnsavedChangesBar count={0} saving={false} onSave={() => {}} onDiscard={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the count and actions', async () => {
    const onSave = vi.fn()
    const onDiscard = vi.fn()
    render(<UnsavedChangesBar count={3} saving={false} onSave={onSave} onDiscard={onDiscard} />)
    expect(screen.getByText('3 unsaved changes')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onSave).toHaveBeenCalledOnce()
    expect(onDiscard).toHaveBeenCalledOnce()
  })

  it('uses singular wording and disables while saving', () => {
    render(<UnsavedChangesBar count={1} saving onSave={() => {}} onDiscard={() => {}} />)
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- src/components`
Expected: FAIL, because `./Timeline`, `./Tray`, `./Drawer` and `./UnsavedChangesBar` can't be resolved.

- [ ] **Step 4: Implement the components**

`frontend/src/components/Panels.module.css`:
```css
.timeline { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-4); border-top: 1px solid var(--border); background: var(--surface); }
.timeline input[type='range'] { flex: 1; }
.dateLabel { min-width: 9ch; font-variant-numeric: tabular-nums; font-weight: 600; }
.editBanner { color: var(--edit-past); font-weight: 600; display: flex; gap: var(--space-2); align-items: center; }
.tray { width: 220px; flex-shrink: 0; border-right: 1px solid var(--border); padding: var(--space-3); overflow-y: auto; background: var(--surface); }
.tray h2, .drawer h2 { font-size: 14px; margin: 0 0 var(--space-2); }
.trayItem { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-2); border: 1px dashed var(--border); border-radius: var(--radius-sm); margin-bottom: var(--space-1); background: var(--surface); }
.trayItem[draggable='true'] { cursor: grab; }
.trayItem span { flex: 1; }
.dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.drawer { width: 300px; flex-shrink: 0; border-left: 1px solid var(--border); padding: var(--space-4); overflow-y: auto; background: var(--surface); display: flex; flex-direction: column; gap: var(--space-3); }
.drawerHeader { display: flex; justify-content: space-between; align-items: start; }
.muted { color: var(--text-muted); }
.conflict { color: var(--danger); }
.actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.unsaved { position: sticky; bottom: 0; display: flex; align-items: center; gap: var(--space-3); justify-content: flex-end; padding: var(--space-2) var(--space-4); background: var(--surface-2); border-top: 1px solid var(--border); }
```

`frontend/src/components/Timeline.tsx`:
```tsx
import { useEffect } from 'react'
import type { Step } from '../api/types'
import { formatFrameDate } from '../chart/frames'
import styles from './Panels.module.css'

export const FRAME_MS = 800

type Props = {
  dates: string[]
  index: number
  step: Step
  playing: boolean
  canEdit: boolean
  unlocked: boolean
  onIndexChange: (index: number) => void
  onPlayingChange: (playing: boolean) => void
  onStepChange: (step: Step) => void
  onUnlockedChange: (unlocked: boolean) => void
}

export default function Timeline(props: Props) {
  const { dates, index, step, playing, canEdit, unlocked } = props
  const last = dates.length - 1
  const isLatest = index >= last
  const label = isLatest ? 'Now' : dates[index] ? formatFrameDate(dates[index], step) : ''

  useEffect(() => {
    if (!playing) return
    const timer = window.setTimeout(() => {
      if (index < last) props.onIndexChange(index + 1)
      else props.onPlayingChange(false)
    }, FRAME_MS)
    return () => window.clearTimeout(timer)
  }, [playing, index, last, props])

  function togglePlay() {
    if (playing) return props.onPlayingChange(false)
    if (isLatest) props.onIndexChange(0)
    props.onPlayingChange(true)
  }

  return (
    <div className={styles.timeline}>
      <button onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <input
        type="range"
        aria-label="Timeline"
        aria-valuetext={label}
        min={0}
        max={Math.max(0, last)}
        value={index}
        onChange={(e) => props.onIndexChange(Number(e.target.value))}
      />
      <span className={styles.dateLabel}>{label}</span>
      <select aria-label="Step" value={step} onChange={(e) => props.onStepChange(e.target.value as Step)}>
        <option value="month">Monthly</option>
        <option value="week">Weekly</option>
      </select>
      {canEdit && !isLatest && !unlocked && (
        <button onClick={() => props.onUnlockedChange(true)}>Edit here</button>
      )}
      {canEdit && !isLatest && unlocked && (
        <span className={styles.editBanner}>
          ✎ Editing {label}
          <button onClick={() => props.onUnlockedChange(false)}>Lock</button>
        </span>
      )}
    </div>
  )
}
```

`frontend/src/components/Tray.tsx`:
```tsx
import { useState } from 'react'
import { Link } from 'react-router'
import type { PracticeListItem } from '../api/types'
import { categoryColor } from '../chart/geometry'
import { PRACTICE_MIME } from '../chart/renderRadar'
import styles from './Panels.module.css'

type Props = { practices: PracticeListItem[]; editable: boolean; onPlace: (practiceId: number) => void }

export default function Tray({ practices, editable, onPlace }: Props) {
  const [filter, setFilter] = useState('')
  const q = filter.trim().toLowerCase()
  const visible = practices.filter((p) => p.name.toLowerCase().includes(q))

  return (
    <section className={styles.tray} aria-label="Not on radar">
      <h2>Not on radar</h2>
      <input
        type="search"
        aria-label="Filter practices"
        placeholder="Filter…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {practices.length === 0 && (
        <p className={styles.muted}>
          Everything in the catalog is on this radar. <Link to="/practices">+ New practice</Link>
        </p>
      )}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {visible.map((p) => (
          <li
            key={p.id}
            className={styles.trayItem}
            draggable={editable}
            onDragStart={(e) => {
              e.dataTransfer.setData(PRACTICE_MIME, String(p.id))
              e.dataTransfer.effectAllowed = 'copy'
            }}
          >
            <i className={styles.dot} style={{ background: categoryColor(p.category) }} aria-hidden="true" />
            <span>{p.name}</span>
            <button aria-label={`Place ${p.name}`} disabled={!editable} onClick={() => onPlace(p.id)}>
              +
            </button>
          </li>
        ))}
      </ul>
      {editable && practices.length > 0 && <p className={styles.muted}>Drag onto the chart, or press +.</p>}
    </section>
  )
}
```

`frontend/src/components/UnsavedChangesBar.tsx`:
```tsx
import styles from './Panels.module.css'

type Props = { count: number; saving: boolean; onSave: () => void; onDiscard: () => void }

export default function UnsavedChangesBar({ count, saving, onSave, onDiscard }: Props) {
  if (count === 0) return null
  return (
    <div className={styles.unsaved} role="region" aria-label="Unsaved changes">
      <span>
        {count} unsaved change{count === 1 ? '' : 's'}
      </span>
      <button onClick={onDiscard} disabled={saving}>
        Discard
      </button>
      <button className="primary" onClick={onSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}
```

`frontend/src/components/Drawer.tsx`:
```tsx
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { conflictCurrent, isConflict } from '../api/client'
import { keys, useNote, usePutNote } from '../api/hooks'
import type { Category, Note } from '../api/types'
import type { PositionLabel } from '../chart/geometry'
import Editor from '../editor/Editor'
import MarkdownView from '../editor/MarkdownView'
import { toRef } from '../lib/refs'
import CategoryChip from './CategoryChip'
import { useNamePrompt } from './NamePrompt'
import styles from './Panels.module.css'
import { useToast } from './Toasts'

export type DrawerPractice = { id: number; name: string; slug: string; category: Category; summary: string }

type Props = {
  scope: 'team' | 'org'
  practice: DrawerPractice
  label: PositionLabel
  teamId?: number
  teams?: { teamId: number; teamName: string; label: PositionLabel }[]
  canRemove: boolean
  onRemove: () => void
  onClose: () => void
}

export default function Drawer({ scope, practice, label, teamId, teams, canRemove, onRemove, onClose }: Props) {
  const ref = toRef(practice.id, practice.slug)
  return (
    <aside className={styles.drawer} aria-label={`Details for ${practice.name}`}>
      <div className={styles.drawerHeader}>
        <CategoryChip category={practice.category} />
        <button aria-label="Close details" onClick={onClose}>
          ✕
        </button>
      </div>
      <h2>{practice.name}</h2>
      <p className={styles.muted}>{practice.summary}</p>
      <p>
        Position: <strong>{label}</strong>
      </p>
      {scope === 'team' && teamId !== undefined && <TeamNote teamId={teamId} practiceId={practice.id} />}
      {scope === 'org' && (
        <section>
          <h3>Teams using it</h3>
          <ul>
            {(teams ?? []).map((t) => (
              <li key={t.teamId}>
                {t.teamName} · <span>{t.label}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className={styles.actions}>
        <Link to={`/practices/${ref}`}>Open page</Link>
        <Link to={`/practices/${ref}?tab=history`}>History</Link>
        {canRemove && <button onClick={onRemove}>Remove from radar</button>}
      </div>
    </aside>
  )
}

function TeamNote({ teamId, practiceId }: { teamId: number; practiceId: number }) {
  const { data: note, isLoading } = useNote(teamId, practiceId)
  const putNote = usePutNote()
  const queryClient = useQueryClient()
  const { ensureName } = useNamePrompt()
  const toast = useToast()
  const [draft, setDraft] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)

  async function save() {
    if (draft === null) return
    await ensureName()
    try {
      await putNote.mutateAsync({ teamId, practiceId, version: note?.version ?? 0, body_md: draft })
      setDraft(null)
      setConflict(false)
    } catch (error) {
      if (isConflict(error)) {
        queryClient.setQueryData(keys.note(teamId, practiceId), conflictCurrent<Note>(error))
        setConflict(true)
      } else {
        toast({ message: 'Could not save the note. Please try again.', tone: 'error' })
      }
    }
  }

  return (
    <section>
      <h3>How we use it</h3>
      {conflict && (
        <p className={styles.conflict} role="alert">
          Someone else saved this note. Their version is shown below; your draft is kept.
        </p>
      )}
      {isLoading ? (
        <p className={styles.muted}>Loading…</p>
      ) : draft === null || conflict ? (
        note?.body_md ? <MarkdownView source={note.body_md} /> : <p className={styles.muted}>No note yet.</p>
      ) : null}
      {draft === null ? (
        <button onClick={() => setDraft(note?.body_md ?? '')}>Edit note</button>
      ) : (
        <>
          <Editor value={draft} onChange={setDraft} label="How we use it" />
          <div className={styles.actions}>
            <button onClick={() => { setDraft(null); setConflict(false) }}>Cancel</button>
            <button className="primary" onClick={save} disabled={putNote.isPending}>
              Save note
            </button>
          </div>
        </>
      )}
    </section>
  )
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- src/components && npm run typecheck`
Expected: all component tests pass, and there are no type errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components frontend/src/test/render.tsx
git commit -m "feat(frontend): add timeline, tray, drawer with team notes and unsaved-changes bar"
```

### Task 8: Teams page

**Files:**
- Create: `frontend/src/pages/Pages.module.css`
- Modify: `frontend/src/pages/TeamsPage.tsx` (replace the stub)
- Test: `frontend/src/pages/TeamsPage.test.tsx`

**Interfaces:**
- Consumes: `useTeams`, `useCreateTeam`, `useUpdateTeam`, `useSetTeamArchived`, `isConflict`, `conflictCurrent`, `useNamePrompt`, `useToast`, `toRef`, `renderRoutes`
- Produces:
  - `/teams`: a list of teams, each linking to its radar, with inline Rename (name and description), Archive/Restore, a "Show archived" toggle and a "New team" form
  - Accessible names used by Plan 3's end-to-end test:
    - text fields "Team name" and "Description"
    - buttons "Create team", `Rename <name>`, `Archive <name>`, `Restore <name>` and "Save"
    - checkbox "Show archived"
  - `Pages.module.css` classes `page`, `headerRow`, `card`, `filters`, `table`, `badge`, `tag`, `error`, `muted`, `actions` and `similar`, which later pages reuse

- [ ] **Step 1: Write the failing tests**

`frontend/src/pages/TeamsPage.test.tsx`:
```tsx
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Team } from '../api/types'
import { setEditedBy } from '../lib/editedBy'
import { team } from '../test/fixtures'
import { renderRoutes } from '../test/render'
import { server } from '../test/server'

let teams: Team[]
let lastPatch: unknown

beforeEach(() => {
  setEditedBy('Kim')
  teams = [team()]
  lastPatch = undefined
  server.use(
    http.get('/api/teams', ({ request }) => {
      const all = new URL(request.url).searchParams.get('include_archived') === 'true'
      return HttpResponse.json(teams.filter((t) => all || !t.archived_at))
    }),
    http.post('/api/teams', async ({ request }) => {
      const body = (await request.json()) as { name: string }
      const existing = teams.find((t) => t.name.toLowerCase() === body.name.toLowerCase())
      if (existing) return HttpResponse.json({ detail: 'exists', current: existing }, { status: 409 })
      const created = team({ id: teams.length + 1, name: body.name, slug: body.name.toLowerCase() })
      teams.push(created)
      return HttpResponse.json(created, { status: 201 })
    }),
    http.patch('/api/teams/:id', async ({ params, request }) => {
      lastPatch = await request.json()
      const t = teams.find((x) => x.id === Number(params.id))!
      Object.assign(t, lastPatch as object, { version: t.version + 1 })
      return HttpResponse.json(t)
    }),
    http.post('/api/teams/:id/:action', ({ params }) => {
      const t = teams.find((x) => x.id === Number(params.id))!
      t.archived_at = params.action === 'archive' ? '2026-03-01T00:00:00Z' : null
      return HttpResponse.json(t)
    }),
  )
})

const list = () => screen.getByRole('list', { name: 'Teams' })

describe('TeamsPage', () => {
  it('lists teams linking to their radars', async () => {
    renderRoutes('/teams')
    const link = await within(await screen.findByRole('list', { name: 'Teams' })).findByRole('link', { name: 'Platform' })
    expect(link).toHaveAttribute('href', '/radar/team/1-platform')
  })

  it('creates a team', async () => {
    renderRoutes('/teams')
    await userEvent.type(screen.getByRole('textbox', { name: 'Team name' }), 'Payments')
    await userEvent.click(screen.getByRole('button', { name: 'Create team' }))
    expect(await within(list()).findByRole('link', { name: 'Payments' })).toBeInTheDocument()
  })

  it('explains duplicate names', async () => {
    renderRoutes('/teams')
    await userEvent.type(screen.getByRole('textbox', { name: 'Team name' }), 'platform')
    await userEvent.click(screen.getByRole('button', { name: 'Create team' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/i)
  })

  it('renames with the current version', async () => {
    renderRoutes('/teams')
    await userEvent.click(await screen.findByRole('button', { name: 'Rename Platform' }))
    const input = screen.getByRole('textbox', { name: 'New name for Platform' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Core')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(lastPatch).toEqual({ version: 1, name: 'Core', description: null }))
    expect(await within(list()).findByRole('link', { name: 'Core' })).toBeInTheDocument()
  })

  it('archives and restores', async () => {
    renderRoutes('/teams')
    await userEvent.click(await screen.findByRole('button', { name: 'Archive Platform' }))
    await waitFor(() => expect(within(list()).queryByText('Platform')).not.toBeInTheDocument())
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show archived' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Restore Platform' }))
    expect(await screen.findByRole('button', { name: 'Archive Platform' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/pages/TeamsPage.test.tsx`
Expected: FAIL, because the page is still a stub that renders only `<h1>Teams</h1>`.

- [ ] **Step 3: Implement**

`frontend/src/pages/Pages.module.css`:
```css
.page { padding: var(--space-6); max-width: 1040px; width: 100%; margin: 0 auto; display: flex; flex-direction: column; gap: var(--space-4); }
.headerRow { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.headerRow h1 { margin: 0; font-size: 22px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }
.card label { display: flex; flex-direction: column; gap: var(--space-1); font-weight: 600; }
.filters { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; }
.table { width: 100%; border-collapse: collapse; background: var(--surface); border-radius: var(--radius); overflow: hidden; }
.table th, .table td { text-align: left; padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--border); vertical-align: top; }
.badge { display: inline-block; margin-left: var(--space-2); font-size: 11px; padding: 0 var(--space-2); border-radius: 999px; background: var(--surface-2); color: var(--text-muted); }
.tag { font-size: 12px; padding: 0 var(--space-2); margin: 0 var(--space-1) var(--space-1) 0; border-radius: 999px; }
.error { color: var(--danger); }
.muted { color: var(--text-muted); }
.actions { display: flex; flex-wrap: wrap; gap: var(--space-2); justify-content: flex-end; }
.similar { background: var(--surface-2); border-radius: var(--radius-sm); padding: var(--space-2) var(--space-3); }
.teamRow { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) 0; border-bottom: 1px solid var(--border); }
.teamRow > :first-child { flex: 1; }
```

`frontend/src/pages/TeamsPage.tsx`:
```tsx
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { conflictCurrent, isConflict } from '../api/client'
import { useCreateTeam, useSetTeamArchived, useTeams, useUpdateTeam } from '../api/hooks'
import type { Team } from '../api/types'
import { useNamePrompt } from '../components/NamePrompt'
import { useToast } from '../components/Toasts'
import { toRef } from '../lib/refs'
import styles from './Pages.module.css'

export default function TeamsPage() {
  const [showArchived, setShowArchived] = useState(false)
  const { data: teams = [] } = useTeams(showArchived)
  const createTeam = useCreateTeam()
  const setArchived = useSetTeamArchived()
  const { ensureName } = useNamePrompt()
  const toast = useToast()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)

  async function onCreate(event: FormEvent) {
    event.preventDefault()
    await ensureName()
    try {
      await createTeam.mutateAsync({ name, description: description.trim() || null })
      setName('')
      setDescription('')
      setError(null)
    } catch (err) {
      if (!isConflict(err)) return toast({ message: 'Could not create the team.', tone: 'error' })
      const existing = conflictCurrent<Team>(err)
      setError(
        existing?.archived_at
          ? `A team named "${existing.name}" already exists but is archived. Show archived teams to restore it.`
          : `A team named "${existing?.name ?? name}" already exists.`,
      )
    }
  }

  async function toggleArchived(t: Team) {
    await ensureName()
    await setArchived.mutateAsync({ id: t.id, archived: t.archived_at === null })
  }

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <h1>Teams</h1>
        <label>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show
          archived
        </label>
      </div>

      <form className={styles.card} onSubmit={onCreate} aria-label="New team">
        <label>
          Team name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
        </label>
        <label>
          Description
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        </label>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <button type="submit" className="primary" disabled={!name.trim() || createTeam.isPending}>
            Create team
          </button>
        </div>
      </form>

      <ul aria-label="Teams" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {teams.map((t) =>
          editingId === t.id ? (
            <TeamEditor key={t.id} team={t} onDone={() => setEditingId(null)} />
          ) : (
            <li key={t.id} className={styles.teamRow}>
              <div>
                <Link to={`/radar/team/${toRef(t.id, t.slug)}`}>{t.name}</Link>
                {t.archived_at && <span className={styles.badge}>Archived</span>}
                {t.description && <div className={styles.muted}>{t.description}</div>}
              </div>
              <button aria-label={`Rename ${t.name}`} onClick={() => setEditingId(t.id)}>
                Rename
              </button>
              <button
                aria-label={`${t.archived_at ? 'Restore' : 'Archive'} ${t.name}`}
                onClick={() => toggleArchived(t)}
              >
                {t.archived_at ? 'Restore' : 'Archive'}
              </button>
            </li>
          ),
        )}
      </ul>
    </div>
  )
}

function TeamEditor({ team, onDone }: { team: Team; onDone: () => void }) {
  const updateTeam = useUpdateTeam()
  const { ensureName } = useNamePrompt()
  const [name, setName] = useState(team.name)
  const [description, setDescription] = useState(team.description ?? '')
  const [error, setError] = useState<string | null>(null)

  async function onSave(event: FormEvent) {
    event.preventDefault()
    await ensureName()
    try {
      await updateTeam.mutateAsync({
        id: team.id,
        body: { version: team.version, name, description: description.trim() || null },
      })
      onDone()
    } catch (err) {
      setError(
        isConflict(err)
          ? 'That name is taken, or someone else changed this team. Reload and try again.'
          : 'Could not save the team.',
      )
    }
  }

  return (
    <li className={styles.teamRow}>
      <form onSubmit={onSave} style={{ display: 'flex', gap: 8, flex: 1, flexWrap: 'wrap' }}>
        <input aria-label={`New name for ${team.name}`} value={name} onChange={(e) => setName(e.target.value)} />
        <input
          aria-label={`Description for ${team.name}`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        {error && (
          <span role="alert" className={styles.error}>
            {error}
          </span>
        )}
        <button type="button" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={!name.trim()}>
          Save
        </button>
      </form>
    </li>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/pages/TeamsPage.test.tsx && npm run typecheck`
Expected: 5 tests pass, and there are no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages
git commit -m "feat(frontend): add teams page with create, rename, archive and restore"
```

---

### Task 9: Catalog page with the new-practice form and duplicate suggestions

**Files:**
- Create: `frontend/src/lib/useDebounced.ts`, `frontend/src/pages/NewPracticeForm.tsx`
- Modify: `frontend/src/pages/CatalogPage.tsx` (replace the stub)
- Test: `frontend/src/pages/CatalogPage.test.tsx`

**Interfaces:**
- Consumes: `usePractices`, `useSimilar`, `useCreatePractice`, `useSetPracticeArchived`, `CATEGORIES`, `CategoryChip`, `isConflict`, `conflictCurrent`, `useNamePrompt`, `useToast` and `toRef`
- Produces:
  - `useDebounced<T>(value: T, delay = 300): T`
  - `/practices`: a table with name link, category, tag buttons (click to filter) and teams count. It has search, a category filter, a tag chip and a "Show archived" toggle.
  - `NewPracticeForm({ onCancel })`: shows "Did you mean…" suggestions and navigates to `/practices/<id>-<slug>` after create or restore
  - Accessible names used by Plan 3's end-to-end test:
    - "+ New practice"
    - form fields "Name", "Category" and "Summary"
    - button "Create practice"
    - the text "Did you mean…"
    - "Search practices" and "Filter by category"

- [ ] **Step 1: Write the failing tests**

`frontend/src/pages/CatalogPage.test.tsx`:
```tsx
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { setEditedBy } from '../lib/editedBy'
import { listItem, practice } from '../test/fixtures'
import { renderRoutes } from '../test/render'
import { server } from '../test/server'

let lastQuery: URLSearchParams

beforeEach(() => {
  setEditedBy('Kim')
  server.use(
    http.get('/api/teams', () => HttpResponse.json([])),
    http.get('/api/practices', ({ request }) => {
      lastQuery = new URL(request.url).searchParams
      const all = [
        listItem({ teams_count: 3, tags: ['agentic'] }),
        listItem({ id: 11, name: 'Spec-driven dev', slug: 'spec-driven-dev', category: 'practice', tags: ['process'] }),
      ]
      const q = lastQuery.get('q')?.toLowerCase()
      return HttpResponse.json(q ? all.filter((p) => p.name.toLowerCase().includes(q)) : all)
    }),
  )
})

describe('CatalogPage', () => {
  it('lists practices with team counts and links', async () => {
    renderRoutes('/practices')
    const link = await screen.findByRole('link', { name: 'Claude Code' })
    expect(link).toHaveAttribute('href', '/practices/10-claude-code')
    expect(screen.getByLabelText('3 teams')).toBeInTheDocument()
  })

  it('searches and filters', async () => {
    renderRoutes('/practices')
    await screen.findByRole('link', { name: 'Claude Code' })
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search practices' }), 'spec')
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Claude Code' })).not.toBeInTheDocument())
    expect(lastQuery.get('q')).toBe('spec')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by category' }), 'practice')
    await waitFor(() => expect(lastQuery.get('category')).toBe('practice'))
  })

  it('filters by tag when a tag is clicked', async () => {
    renderRoutes('/practices')
    await userEvent.click(await screen.findByRole('button', { name: 'agentic' }))
    await waitFor(() => expect(lastQuery.get('tag')).toBe('agentic'))
    expect(screen.getByRole('button', { name: 'Tag: agentic ✕' })).toBeInTheDocument()
  })

  it('suggests similar practices while typing a new name', async () => {
    server.use(
      http.get('/api/practices/similar', () =>
        HttpResponse.json([listItem({ id: 5, name: 'GitHub Copilot', slug: 'github-copilot' })]),
      ),
    )
    renderRoutes('/practices')
    await userEvent.click(screen.getByRole('button', { name: '+ New practice' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'copilot')
    expect(await screen.findByText('Did you mean…')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'GitHub Copilot' })).toHaveAttribute('href', '/practices/5-github-copilot')
  })

  it('creates a practice and opens it', async () => {
    server.use(
      http.get('/api/practices/similar', () => HttpResponse.json([])),
      http.post('/api/practices', () =>
        HttpResponse.json(practice({ id: 42, name: 'MCP servers', slug: 'mcp-servers' }), { status: 201 }),
      ),
    )
    const { router } = renderRoutes('/practices')
    await userEvent.click(screen.getByRole('button', { name: '+ New practice' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'MCP servers')
    await userEvent.click(screen.getByRole('button', { name: 'Create practice' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/practices/42-mcp-servers'))
  })

  it('offers to restore an archived duplicate', async () => {
    const archived = practice({ id: 7, name: 'Cursor', slug: 'cursor', archived_at: '2026-01-01T00:00:00Z' })
    server.use(
      http.get('/api/practices/similar', () => HttpResponse.json([])),
      http.post('/api/practices', () => HttpResponse.json({ detail: 'exists', current: archived }, { status: 409 })),
      http.post('/api/practices/7/restore', () => HttpResponse.json({ ...archived, archived_at: null })),
    )
    const { router } = renderRoutes('/practices')
    await userEvent.click(screen.getByRole('button', { name: '+ New practice' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'cursor')
    await userEvent.click(screen.getByRole('button', { name: 'Create practice' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/archived/i)
    await userEvent.click(screen.getByRole('button', { name: 'Restore it' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/practices/7-cursor'))
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/pages/CatalogPage.test.tsx`
Expected: FAIL, because the page is still a stub.

- [ ] **Step 3: Implement**

`frontend/src/lib/useDebounced.ts`:
```ts
import { useEffect, useState } from 'react'

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}
```

`frontend/src/pages/NewPracticeForm.tsx`:
```tsx
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { conflictCurrent, isConflict } from '../api/client'
import { useCreatePractice, useSetPracticeArchived, useSimilar } from '../api/hooks'
import { CATEGORIES, type Category, type Practice } from '../api/types'
import { useNamePrompt } from '../components/NamePrompt'
import { useToast } from '../components/Toasts'
import { toRef } from '../lib/refs'
import { useDebounced } from '../lib/useDebounced'
import styles from './Pages.module.css'

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1)

export default function NewPracticeForm({ onCancel }: { onCancel: () => void }) {
  const navigate = useNavigate()
  const { ensureName } = useNamePrompt()
  const toast = useToast()
  const [name, setName] = useState('')
  const [category, setCategory] = useState<Category>('tool')
  const [summary, setSummary] = useState('')
  const [conflict, setConflict] = useState<Practice | null>(null)
  const { data: similar = [] } = useSimilar(useDebounced(name))
  const create = useCreatePractice()
  const setArchived = useSetPracticeArchived()

  const open = (p: { id: number; slug: string }) => navigate(`/practices/${toRef(p.id, p.slug)}`)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    await ensureName()
    try {
      open(await create.mutateAsync({ name, category, summary }))
    } catch (err) {
      if (isConflict(err)) setConflict(conflictCurrent<Practice>(err))
      else toast({ message: 'Could not create the practice.', tone: 'error' })
    }
  }

  async function restore() {
    if (!conflict) return
    await ensureName()
    open(await setArchived.mutateAsync({ id: conflict.id, archived: false }))
  }

  return (
    <form className={styles.card} onSubmit={onSubmit} aria-label="New practice">
      <label>
        Name
        <input
          value={name}
          maxLength={100}
          autoFocus
          onChange={(e) => {
            setName(e.target.value)
            setConflict(null)
          }}
        />
      </label>
      {similar.length > 0 && !conflict && (
        <div className={styles.similar} aria-live="polite">
          <span>Did you mean…</span>
          <ul>
            {similar.map((p) => (
              <li key={p.id}>
                <Link to={`/practices/${toRef(p.id, p.slug)}`}>{p.name}</Link>
                {p.archived_at && <span className={styles.badge}>Archived</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <label>
        Category
        <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {capitalize(c)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Summary
        <input value={summary} maxLength={280} onChange={(e) => setSummary(e.target.value)} />
      </label>
      {conflict && (
        <p role="alert" className={styles.error}>
          “{conflict.name}” already exists{conflict.archived_at ? ' but is archived' : ''}.{' '}
          {conflict.archived_at ? (
            <button type="button" onClick={restore}>
              Restore it
            </button>
          ) : (
            <Link to={`/practices/${toRef(conflict.id, conflict.slug)}`}>Open it</Link>
          )}
        </p>
      )}
      <div className={styles.actions}>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={!name.trim() || create.isPending}>
          Create practice
        </button>
      </div>
    </form>
  )
}
```

`frontend/src/pages/CatalogPage.tsx`:
```tsx
import { useState } from 'react'
import { Link } from 'react-router'
import { usePractices } from '../api/hooks'
import { CATEGORIES, type Category } from '../api/types'
import CategoryChip from '../components/CategoryChip'
import { toRef } from '../lib/refs'
import { useDebounced } from '../lib/useDebounced'
import NewPracticeForm from './NewPracticeForm'
import styles from './Pages.module.css'

export default function CatalogPage() {
  const [q, setQ] = useState('')
  const [category, setCategory] = useState<Category | ''>('')
  const [tag, setTag] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const { data: practices = [], isLoading } = usePractices({
    q: useDebounced(q),
    category: category || undefined,
    tag: tag || undefined,
    includeArchived,
  })

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <h1>Catalog</h1>
        {!creating && (
          <button className="primary" onClick={() => setCreating(true)}>
            + New practice
          </button>
        )}
      </div>
      {creating && <NewPracticeForm onCancel={() => setCreating(false)} />}
      <div className={styles.filters}>
        <input type="search" aria-label="Search practices" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value as Category | '')}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c[0].toUpperCase() + c.slice(1)}
            </option>
          ))}
        </select>
        {tag && <button onClick={() => setTag('')}>Tag: {tag} ✕</button>}
        <label>
          <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} /> Show
          archived
        </label>
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Category</th>
            <th>Tags</th>
            <th>Teams</th>
          </tr>
        </thead>
        <tbody>
          {practices.map((p) => (
            <tr key={p.id}>
              <td>
                <Link to={`/practices/${toRef(p.id, p.slug)}`}>{p.name}</Link>
                {p.archived_at && <span className={styles.badge}>Archived</span>}
                <div className={styles.muted}>{p.summary}</div>
              </td>
              <td>
                <CategoryChip category={p.category} />
              </td>
              <td>
                {p.tags.map((t) => (
                  <button key={t} className={styles.tag} onClick={() => setTag(t)}>
                    {t}
                  </button>
                ))}
              </td>
              <td aria-label={`${p.teams_count} teams`}>{p.teams_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!isLoading && practices.length === 0 && <p className={styles.muted}>No practices match.</p>}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/pages && npm run typecheck`
Expected: all page tests pass (5 teams and 6 catalog), and there are no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages frontend/src/lib/useDebounced.ts
git commit -m "feat(frontend): add catalog page with filters and duplicate-aware creation"
```

### Task 10: Radar page (team and org scopes, placing, moving, removing, backdating)

**Files:**
- Create: `frontend/src/pages/RadarPage.module.css`
- Modify: `frontend/src/pages/RadarPage.tsx` (replace the stub)
- Test: `frontend/src/pages/RadarPage.test.tsx`

**Interfaces:**
- Consumes: `useFrames`, `useTeams`, `usePractices`, `usePlace`, `RadarChart`, `ChartBubble`, `trail`, `offRadar`, `formatFrameDate`, `positionLabel`, `Tray`, `Drawer`, `Timeline`, `FRAME_MS`, `useToast`, `useNamePrompt`, `idFromRef`, `writeString` and `LAST_TEAM_KEY`
- Produces:
  - `/radar/org` and `/radar/team/:teamRef`
  - **Behaviour (spec §6):**
    - The tray (team scope only) places a practice at the centre, or where you drop it.
    - Dragging a bubble moves it. Dropping it outside the plot removes it, and a toast offers Undo.
    - Arrow keys nudge the selected bubble, with the save debounced by 600 ms.
    - Changes are shown immediately and reverted on failure with an error toast.
    - "Edit here" backdates with `effective_at` set to the frame date.
    - In the org scope the chart is read-only and selecting a bubble shows the team spread.
    - Category filter and search highlight.
    - Empty-state messages.
    - Visiting a team radar stores `aiRadar.lastTeam`.
    - Archived teams are read-only.
  - Accessible names used by Plan 3's end-to-end test:
    - the "Filter by category" dropdown and the "Highlight practice" search field
    - bubbles labelled `"<name>, <position label>"`
    - `Place <name>` (tray), "Timeline", "Play", "Edit here", "Remove from radar" and "Undo"

- [ ] **Step 1: Write the failing tests**

`frontend/src/pages/RadarPage.test.tsx`:
```tsx
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FramesResponse } from '../api/types'
import { LAST_TEAM_KEY } from '../components/AppShell'
import { setEditedBy } from '../lib/editedBy'
import { framesResponse, listItem, team } from '../test/fixtures'
import { renderRoutes } from '../test/render'
import { server } from '../test/server'

let posted: unknown[]
let frames: FramesResponse

beforeEach(() => {
  setEditedBy('Kim')
  posted = []
  frames = framesResponse()
  server.use(
    http.get('/api/teams', () =>
      HttpResponse.json([team(), team({ id: 2, name: 'Payments', slug: 'payments' })]),
    ),
    http.get('/api/practices', () =>
      HttpResponse.json([
        listItem(),
        listItem({ id: 11, name: 'Spec-driven dev', slug: 'spec-driven-dev', category: 'practice' }),
        listItem({ id: 12, name: 'Prompt library', slug: 'prompt-library', category: 'workflow' }),
      ]),
    ),
    http.get('/api/radar/frames', () => HttpResponse.json(frames)),
    http.get('/api/teams/:teamId/notes/:practiceId', () =>
      HttpResponse.json({ detail: 'Note not found' }, { status: 404 }),
    ),
    http.post('/api/placements', async ({ request }) => {
      posted.push(await request.json())
      return HttpResponse.json({ id: posted.length }, { status: 201 })
    }),
  )
})

const bubble = (label: string) => document.querySelector<SVGGElement>(`[aria-label="${label}"]`)

async function openTeamRadar() {
  const view = renderRoutes('/radar/team/1-platform')
  await waitFor(() => expect(bubble('Claude Code, Core')).not.toBeNull())
  return view
}

describe('RadarPage (team scope)', () => {
  it('shows the latest frame, and the tray lists practices not on the radar', async () => {
    await openTeamRadar()
    expect(bubble('Spec-driven dev, Hidden gem')).not.toBeNull()
    const tray = screen.getByRole('region', { name: 'Not on radar' })
    expect(within(tray).getByText('Prompt library')).toBeInTheDocument()
    expect(within(tray).queryByText('Claude Code')).not.toBeInTheDocument()
    expect(localStorage.getItem(LAST_TEAM_KEY)).toBe('1-platform')
  })

  it('places a practice from the tray at the centre', async () => {
    await openTeamRadar()
    await userEvent.click(screen.getByRole('button', { name: 'Place Prompt library' }))
    await waitFor(() =>
      expect(posted).toEqual([{ team_id: 1, practice_id: 12, adoption: 50, value: 50 }]),
    )
  })

  it('opens the drawer, removes with undo', async () => {
    await openTeamRadar()
    fireEvent.click(bubble('Claude Code, Core')!)
    expect(await screen.findByRole('complementary', { name: 'Details for Claude Code' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove from radar' }))
    await waitFor(() => expect(posted[0]).toEqual({ team_id: 1, practice_id: 10, removed: true }))
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(posted[1]).toEqual({ team_id: 1, practice_id: 10, adoption: 75, value: 85 }),
    )
  })

  it('backdates changes when editing a past frame', async () => {
    await openTeamRadar()
    fireEvent.change(screen.getByRole('slider', { name: 'Timeline' }), { target: { value: '0' } })
    await userEvent.click(screen.getByRole('button', { name: 'Edit here' }))
    expect(document.querySelector('svg.radar')?.classList.contains('editing-past')).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Place Prompt library' }))
    await waitFor(() =>
      expect(posted[0]).toEqual({
        team_id: 1,
        practice_id: 12,
        adoption: 50,
        value: 50,
        effective_at: '2026-01-31T23:59:59Z',
      }),
    )
  })

  it('is read-only in the past until unlocked', async () => {
    await openTeamRadar()
    fireEvent.change(screen.getByRole('slider', { name: 'Timeline' }), { target: { value: '0' } })
    expect(screen.getByRole('button', { name: 'Place Prompt library' })).toBeDisabled()
  })

  it('reports failed saves', async () => {
    server.use(http.post('/api/placements', () => HttpResponse.json({ detail: 'boom' }, { status: 500 })))
    await openTeamRadar()
    await userEvent.click(screen.getByRole('button', { name: 'Place Prompt library' }))
    expect(await screen.findByText(/could not save that change/i)).toBeInTheDocument()
  })

  it('filters bubbles by category', async () => {
    await openTeamRadar()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by category' }), 'practice')
    await waitFor(() => expect(bubble('Claude Code, Core')).toBeNull())
    expect(bubble('Spec-driven dev, Hidden gem')).not.toBeNull()
  })
})

describe('RadarPage (org scope)', () => {
  it('is read-only and shows each team in the drawer', async () => {
    frames = framesResponse({
      scope: 'org',
      frames: [
        {
          date: '2026-02-28T23:59:59Z',
          points: [
            {
              practice_id: 10,
              adoption: 60,
              value: 80,
              teams: 2,
              team_positions: [
                { team_id: 1, adoption: 80, value: 90 },
                { team_id: 2, adoption: 40, value: 70 },
              ],
            },
          ],
        },
      ],
    })
    renderRoutes('/radar/org')
    await waitFor(() => expect(bubble('Claude Code, Core')).not.toBeNull())
    expect(screen.queryByRole('region', { name: 'Not on radar' })).not.toBeInTheDocument()
    fireEvent.click(bubble('Claude Code, Core')!)
    const drawer = await screen.findByRole('complementary', { name: 'Details for Claude Code' })
    expect(within(drawer).getByText('Payments')).toBeInTheDocument()
    expect(within(drawer).getByText('Hidden gem')).toBeInTheDocument()
    expect(within(drawer).queryByRole('button', { name: 'Remove from radar' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/pages/RadarPage.test.tsx`
Expected: FAIL, because the page is still a stub and no bubbles are found.

- [ ] **Step 3: Implement**

`frontend/src/pages/RadarPage.module.css`:
```css
.layout { display: flex; flex: 1; min-height: 0; }
.center { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.toolbar { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-4); }
.toolbar h1 { font-size: 18px; margin: 0 auto 0 0; }
.chartArea { position: relative; flex: 1; display: flex; padding: 0 var(--space-2); min-height: 0; }
.empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--text-muted); pointer-events: none; text-align: center; }
.pastBanner { margin: 0 var(--space-4) var(--space-2); padding: var(--space-1) var(--space-3); border-radius: var(--radius-sm); color: var(--edit-past); border: 1px solid var(--edit-past); }
.archived { color: var(--text-muted); font-size: 12px; }
.message { padding: var(--space-6); }
```

`frontend/src/pages/RadarPage.tsx`:
```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useFrames, usePlace, usePractices, useTeams } from '../api/hooks'
import { CATEGORIES, type Category, type PlacementCreate, type Point, type Step } from '../api/types'
import { formatFrameDate, offRadar, trail } from '../chart/frames'
import { positionLabel } from '../chart/geometry'
import RadarChart from '../chart/RadarChart'
import type { ChartBubble } from '../chart/renderRadar'
import { LAST_TEAM_KEY } from '../components/AppShell'
import Drawer from '../components/Drawer'
import { useNamePrompt } from '../components/NamePrompt'
import Timeline, { FRAME_MS } from '../components/Timeline'
import { useToast } from '../components/Toasts'
import Tray from '../components/Tray'
import { idFromRef } from '../lib/refs'
import { writeString } from '../lib/storage'
import styles from './RadarPage.module.css'

type Position = { adoption: number; value: number }
type Override = Position | 'removed'

const CENTER: Position = { adoption: 50, value: 50 }
const NUDGE_SAVE_MS = 600

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export default function RadarPage() {
  const { teamRef } = useParams()
  const teamId = idFromRef(teamRef)
  const scope = teamId === null ? 'org' : 'team'
  const scopeKey = teamId === null ? 'org' : `team:${teamId}`

  const [step, setStep] = useState<Step>('month')
  const { data: framesData, isLoading } = useFrames(scopeKey, step)
  const { data: teams = [] } = useTeams(true)
  const { data: practices = [] } = usePractices()
  const place = usePlace()
  const toast = useToast()
  const { ensureName } = useNamePrompt()

  const [index, setIndex] = useState<number | null>(null) // null = follow the latest frame
  const [playing, setPlaying] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const [category, setCategory] = useState<Category | ''>('')
  const [search, setSearch] = useState('')
  const [overrides, setOverrides] = useState<Map<number, Override>>(new Map())
  const nudgeTimers = useRef(new Map<number, number>())

  const frames = useMemo(() => framesData?.frames ?? [], [framesData])
  const lastIndex = Math.max(0, frames.length - 1)
  const currentIndex = Math.min(index ?? lastIndex, lastIndex)
  const isLatest = currentIndex === lastIndex
  const frame = frames[currentIndex]
  const team = teams.find((t) => t.id === teamId)
  const teamWritable = scope === 'team' && !!team && team.archived_at === null
  const editable = teamWritable && !playing && (isLatest || unlocked)
  const editingPast = teamWritable && unlocked && !isLatest

  useEffect(() => {
    setIndex(null)
    setSelected([])
    setUnlocked(false)
    setPlaying(false)
    setOverrides(new Map())
  }, [scopeKey])
  useEffect(() => {
    if (isLatest) setUnlocked(false)
  }, [isLatest])
  useEffect(() => {
    if (teamRef) writeString(LAST_TEAM_KEY, teamRef)
  }, [teamRef])
  useEffect(() => {
    const timers = nudgeTimers.current
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [])

  const teamName = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams])
  const practiceById = useMemo(() => new Map(practices.map((p) => [p.id, p])), [practices])
  const nameOf = (id: number) =>
    framesData?.practices[String(id)]?.name ?? practiceById.get(id)?.name ?? 'Unknown practice'
  const categoryOf = (id: number): Category =>
    framesData?.practices[String(id)]?.category ?? practiceById.get(id)?.category ?? 'tool'

  // Frame points with optimistic overrides applied (unfiltered).
  const points: Point[] = useMemo(() => {
    const byId = new Map((frame?.points ?? []).map((p) => [p.practice_id, p]))
    for (const [id, override] of overrides) {
      if (override === 'removed') byId.delete(id)
      else byId.set(id, { ...(byId.get(id) ?? { practice_id: id, teams: 1 }), ...override })
    }
    return [...byId.values()]
  }, [frame, overrides])

  const bubbles: ChartBubble[] = useMemo(
    () =>
      points
        .filter((p) => !category || categoryOf(p.practice_id) === category)
        .map((p) => ({
          practiceId: p.practice_id,
          name: nameOf(p.practice_id),
          category: categoryOf(p.practice_id),
          adoption: p.adoption,
          value: p.value,
          teams: p.teams,
          teamPositions: p.team_positions?.map((t) => ({
            teamId: t.team_id,
            teamName: teamName.get(t.team_id) ?? `Team ${t.team_id}`,
            adoption: t.adoption,
            value: t.value,
          })),
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, category, framesData, practiceById, teamName],
  )

  const trails = useMemo(
    () =>
      Object.fromEntries(
        selected.map((id) => [
          id,
          trail(frames, id, currentIndex).map((p) => ({
            adoption: p.adoption,
            value: p.value,
            label: formatFrameDate(p.date, step),
          })),
        ]),
      ),
    [selected, frames, currentIndex, step],
  )

  const trayPractices = useMemo(
    () => offRadar(practices, { date: frame?.date ?? '', points }),
    [practices, frame, points],
  )

  async function save(practiceId: number, next: Override, previous?: Position) {
    if (teamId === null) return
    await ensureName()
    setOverrides((m) => new Map(m).set(practiceId, next))
    const effective_at = editingPast && frame ? frame.date : undefined
    const body: PlacementCreate =
      next === 'removed'
        ? { team_id: teamId, practice_id: practiceId, removed: true, effective_at }
        : { team_id: teamId, practice_id: practiceId, ...next, effective_at }
    try {
      await place.mutateAsync(body)
      if (next === 'removed') {
        setSelected((s) => s.filter((id) => id !== practiceId))
        toast({
          message: `Removed ${nameOf(practiceId)}`,
          action: previous ? { label: 'Undo', onClick: () => void save(practiceId, previous) } : undefined,
        })
      }
    } catch {
      toast({ message: 'Could not save that change. The bubble was moved back.', tone: 'error' })
    } finally {
      setOverrides((m) => {
        const copy = new Map(m)
        copy.delete(practiceId)
        return copy
      })
    }
  }

  function removeWithUndo(practiceId: number) {
    const p = points.find((x) => x.practice_id === practiceId)
    void save(practiceId, 'removed', p && { adoption: p.adoption, value: p.value })
  }

  function onNudge(id: number, adoption: number, value: number) {
    setOverrides((m) => new Map(m).set(id, { adoption, value }))
    window.clearTimeout(nudgeTimers.current.get(id))
    nudgeTimers.current.set(id, window.setTimeout(() => void save(id, { adoption, value }), NUDGE_SAVE_MS))
  }

  function onSelect(id: number | null, additive: boolean) {
    if (id === null) return setSelected([])
    setSelected((s) => (additive ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : [id]))
  }

  if (teamId !== null && teams.length > 0 && !team) {
    return (
      <div className={styles.message}>
        This team doesn’t exist. <Link to="/teams">See all teams</Link>
      </div>
    )
  }

  const title = scope === 'org' ? 'Whole organization' : (team?.name ?? '')
  const focusId = selected[selected.length - 1]
  const focus = points.find((p) => p.practice_id === focusId)
  const focusListItem = focus ? practiceById.get(focus.practice_id) : undefined

  return (
    <div className={styles.layout}>
      {scope === 'team' && (
        <Tray practices={trayPractices} editable={editable} onPlace={(id) => void save(id, CENTER)} />
      )}
      <section className={styles.center} aria-label={`${title} radar`}>
        <div className={styles.toolbar}>
          <h1>{title}</h1>
          {team?.archived_at && <span className={styles.archived}>Archived: read-only</span>}
          <select
            aria-label="Filter by category"
            value={category}
            onChange={(e) => setCategory(e.target.value as Category | '')}
          >
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c[0].toUpperCase() + c.slice(1)}
              </option>
            ))}
          </select>
          <input
            type="search"
            aria-label="Highlight practice"
            placeholder="Highlight…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {editingPast && frame && (
          <div className={styles.pastBanner} role="status">
            Editing {formatFrameDate(frame.date, step)}. Changes are recorded for that date.
          </div>
        )}
        <div className={styles.chartArea}>
          <RadarChart
            scope={scope}
            bubbles={bubbles}
            dateLabel={isLatest ? 'Now' : frame ? formatFrameDate(frame.date, step) : ''}
            selected={selected}
            trails={trails}
            editable={editable}
            editingPast={editingPast}
            highlight={search}
            duration={prefersReducedMotion() ? 0 : playing ? FRAME_MS : 400}
            onSelect={onSelect}
            onMove={(id, adoption, value) => void save(id, { adoption, value })}
            onRemove={removeWithUndo}
            onNudge={onNudge}
            onDropPractice={(id, adoption, value) => void save(id, { adoption, value })}
          />
          {!isLoading && points.length === 0 && (
            <p className={styles.empty}>
              {scope === 'team'
                ? 'Drag practices from the tray onto the chart to start this radar.'
                : 'No team has placed anything yet.'}
            </p>
          )}
        </div>
        <Timeline
          dates={frames.map((f) => f.date)}
          index={currentIndex}
          step={step}
          playing={playing}
          canEdit={teamWritable}
          unlocked={unlocked}
          onIndexChange={(i) => setIndex(i >= lastIndex ? null : i)}
          onPlayingChange={setPlaying}
          onStepChange={(s) => {
            setStep(s)
            setIndex(null)
          }}
          onUnlockedChange={setUnlocked}
        />
      </section>
      {focus && (
        <Drawer
          scope={scope}
          practice={{
            id: focus.practice_id,
            name: nameOf(focus.practice_id),
            slug: focusListItem?.slug ?? '',
            category: categoryOf(focus.practice_id),
            summary: focusListItem?.summary ?? '',
          }}
          label={positionLabel(focus.adoption, focus.value)}
          teamId={teamId ?? undefined}
          teams={focus.team_positions?.map((t) => ({
            teamId: t.team_id,
            teamName: teamName.get(t.team_id) ?? `Team ${t.team_id}`,
            label: positionLabel(t.adoption, t.value),
          }))}
          canRemove={editable}
          onRemove={() => removeWithUndo(focus.practice_id)}
          onClose={() => setSelected([])}
        />
      )}
    </div>
  )
}
```

If the project's ESLint config doesn't include the `react-hooks` plugin, delete the `eslint-disable-next-line` comment. The Vite template ships with it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/pages/RadarPage.test.tsx && npm run typecheck`
Expected: 8 tests pass, and there are no type errors.

- [ ] **Step 5: Try it in the browser**

Run the backend and `npm run dev`, then create a team on `/teams` and a few practices on `/practices`. Check each of these on the team radar:
- Drag from the tray onto the chart.
- Drag a bubble to move it.
- Drag a bubble off the chart, then Undo.
- Use the arrow keys on a focused bubble.
- Scrub back, press "Edit here" and place something.
- Press ▶ and watch the playback.
- Open `/radar/org`, select a bubble and see the team spread.

Expected: each behaves as in spec §6. The amber (`--edit-past`) border appears only while editing the past.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages
git commit -m "feat(frontend): assemble radar page with tray, drawer, timeline and backdating"
```

### Task 11: Practice page (inline staged editing, conflicts, leave guard, teams, history, archive)

**Files:**
- Modify: `frontend/src/pages/PracticePage.tsx` (replace the stub), `frontend/src/pages/Pages.module.css` (append), `frontend/src/pages/CatalogPage.test.tsx` (add two handlers)
- Test: `frontend/src/pages/PracticePage.test.tsx`

**Interfaces:**
- Consumes: `usePractice`, `useUpdatePractice`, `useSetPracticeArchived`, `useRevisions`, `useRevert`, `keys`, `isConflict`, `conflictCurrent`, `Editor`, `MarkdownView`, `UnsavedChangesBar`, `ConfirmDialog`, `CategoryChip`, `useNamePrompt`, `useToast`, `idFromRef` and `toRef`
- Produces:
  - `/practices/:practiceRef` (and `?tab=history`)
  - Accessible names used by Plan 3's end-to-end test:
    - tabs "Overview" and "History"
    - buttons `Edit name`, `Edit category`, `Edit summary`, `Edit tags`, `Edit links`, `Edit guidance`, "Done", "Save", "Discard", "Revert to this", "Archive practice" and "Restore practice"
    - fields "Name", "Category", "Summary", "Tags" and "Guidance"
    - the list "Revisions", whose items are buttons named `<Created|Edited|Archived|Restored|Reverted> by <author> · <time>`
    - the region "Teams using it"
    - the dialog "Discard unsaved changes?"

- [ ] **Step 1: Stop Catalog tests from hitting unhandled requests after navigation**

In `frontend/src/pages/CatalogPage.test.tsx`, add `detail` to the fixtures import. Then add these two handlers inside the `server.use(...)` call in `beforeEach`, after the existing ones:
```tsx
    http.get('/api/practices/:id', ({ params }) => HttpResponse.json(detail({ id: Number(params.id) }))),
    http.get('/api/revisions', () => HttpResponse.json([])),
```
Per-test `server.use` calls take precedence, so the `/api/practices/similar` handlers defined inside tests still win over `/:id`.

- [ ] **Step 2: Write the failing tests**

`frontend/src/pages/PracticePage.test.tsx`:
```tsx
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PracticeDetail, PracticeUpdate } from '../api/types'
import { EDITOR_MODE_KEY } from '../editor/Editor'
import { setEditedBy } from '../lib/editedBy'
import { detail, revision } from '../test/fixtures'
import { renderRoutes } from '../test/render'
import { server } from '../test/server'

let current: PracticeDetail
let patches: PracticeUpdate[]
let reverted: number[]

beforeEach(() => {
  setEditedBy('Kim')
  localStorage.setItem(EDITOR_MODE_KEY, 'markdown')
  current = detail({
    teams: [
      { team_id: 1, team_name: 'Platform', team_slug: 'platform', label: 'Core', note_md: '## Notes\nRefactors and tests.' },
    ],
  })
  patches = []
  reverted = []
  server.use(
    http.get('/api/teams', () => HttpResponse.json([])),
    http.get('/api/practices', () => HttpResponse.json([])),
    http.get('/api/practices/10', () => HttpResponse.json(current)),
    http.patch('/api/practices/10', async ({ request }) => {
      const body = (await request.json()) as PracticeUpdate
      patches.push(body)
      current = { ...current, ...body, version: current.version + 1 } as PracticeDetail
      return HttpResponse.json(current)
    }),
    http.get('/api/revisions', () =>
      HttpResponse.json([
        revision({ id: 101, action: 'update', edited_by: 'Kim', snapshot: { name: 'Claude Code', summary: 'Changed', body_md: '' } }),
        revision({ id: 100, action: 'create', snapshot: { name: 'Claude Code', summary: 'Agentic coding assistant.', body_md: '## Getting started' } }),
      ]),
    ),
    http.post('/api/revisions/:id/revert', ({ params }) => {
      reverted.push(Number(params.id))
      return HttpResponse.json({ entity_type: 'practice', entity: current })
    }),
    http.post('/api/practices/10/archive', () => {
      current = { ...current, archived_at: '2026-03-01T00:00:00Z' }
      return HttpResponse.json(current)
    }),
  )
})

const open = () => renderRoutes('/practices/10-claude-code')

async function editSummary(text: string) {
  await userEvent.click(await screen.findByRole('button', { name: 'Edit summary' }))
  const input = screen.getByRole('textbox', { name: 'Summary' })
  await userEvent.clear(input)
  await userEvent.type(input, text)
  await userEvent.click(screen.getByRole('button', { name: 'Done' }))
}

describe('PracticePage', () => {
  it('shows the entry and the teams using it', async () => {
    open()
    expect(await screen.findByRole('heading', { name: 'Claude Code' })).toBeInTheDocument()
    const teams = screen.getByRole('complementary', { name: 'Teams using it' })
    expect(within(teams).getByRole('link', { name: 'Platform' })).toHaveAttribute('href', '/radar/team/1-platform')
    expect(within(teams).getByText('Core', { exact: false })).toBeInTheDocument()
    expect(within(teams).getByText(/Refactors and tests\./)).toBeInTheDocument()
  })

  it('stages several inline edits and saves them in one PATCH', async () => {
    open()
    await editSummary('New summary')
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Edit tags' }))
    const tags = screen.getByRole('textbox', { name: 'Tags' })
    await userEvent.clear(tags)
    await userEvent.type(tags, 'agentic, cli')
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByText('2 unsaved changes')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(patches).toEqual([{ version: 1, summary: 'New summary', tags: ['agentic', 'cli'] }]))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Unsaved changes' })).not.toBeInTheDocument())
  })

  it('discards staged edits', async () => {
    open()
    await editSummary('Throwaway')
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.getByText('Agentic coding assistant.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).not.toBeInTheDocument()
  })

  it('keeps edits on conflict and saves against the new version', async () => {
    server.use(
      http.patch('/api/practices/10', async ({ request }) => {
        const body = (await request.json()) as PracticeUpdate
        patches.push(body)
        if (patches.length === 1) {
          return HttpResponse.json(
            { detail: 'changed', current: { ...current, version: 2, summary: 'Theirs' } },
            { status: 409 },
          )
        }
        return HttpResponse.json({ ...current, ...body, version: 3 })
      }),
    )
    open()
    await editSummary('Mine')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/someone else saved/i)
    expect(screen.getByText('Mine')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(patches[1]).toEqual({ version: 2, summary: 'Mine' }))
  })

  it('asks before leaving with unsaved changes', async () => {
    const { router } = open()
    await editSummary('Unsaved')
    await userEvent.click(screen.getByRole('link', { name: 'Catalog' }))
    const dialog = await screen.findByRole('dialog', { name: 'Discard unsaved changes?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(router.state.location.pathname).toBe('/practices/10-claude-code')
    await userEvent.click(screen.getByRole('link', { name: 'Catalog' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/practices'))
  })

  it('shows history and reverts to an earlier revision', async () => {
    open()
    await userEvent.click(await screen.findByRole('tab', { name: 'History' }))
    const list = await screen.findByRole('list', { name: 'Revisions' })
    expect(screen.getByRole('button', { name: 'Revert to this' })).toBeDisabled() // latest is selected
    await userEvent.click(within(list).getByRole('button', { name: /^Created by anonymous/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Revert to this' }))
    await waitFor(() => expect(reverted).toEqual([100]))
    expect(await screen.findByText('Reverted to the selected version.')).toBeInTheDocument()
  })

  it('archives and offers restore', async () => {
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Archive practice' }))
    expect(await screen.findByRole('button', { name: 'Restore practice' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- src/pages/PracticePage.test.tsx`
Expected: FAIL, because the page is still a stub.

- [ ] **Step 4: Append the practice page styles**

Append to `frontend/src/pages/Pages.module.css`:
```css
.practiceLayout { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: var(--space-6); align-items: start; }
.practiceMain { display: flex; flex-direction: column; gap: var(--space-3); }
.inlineField { display: flex; align-items: flex-start; gap: var(--space-2); }
.inlineField > :first-child { flex: 1; }
.editButton { border: none; background: transparent; color: var(--text-muted); opacity: 0.6; }
.inlineField:hover .editButton, .editButton:focus-visible { opacity: 1; }
.revisionList { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.revisionList button { width: 100%; text-align: left; }
.revisionList button[aria-pressed='true'] { border-color: var(--accent); background: var(--surface-2); }
```

- [ ] **Step 5: Implement the page**

`frontend/src/pages/PracticePage.tsx`:
```tsx
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useBlocker, useParams, useSearchParams } from 'react-router'
import { conflictCurrent, isConflict } from '../api/client'
import {
  keys,
  usePractice,
  useRevert,
  useRevisions,
  useSetPracticeArchived,
  useUpdatePractice,
} from '../api/hooks'
import {
  CATEGORIES,
  type Category,
  type Link as PracticeLink,
  type Practice,
  type PracticeDetail,
  type PracticeUpdate,
} from '../api/types'
import CategoryChip from '../components/CategoryChip'
import ConfirmDialog from '../components/ConfirmDialog'
import { useNamePrompt } from '../components/NamePrompt'
import { useToast } from '../components/Toasts'
import UnsavedChangesBar from '../components/UnsavedChangesBar'
import Editor from '../editor/Editor'
import MarkdownView from '../editor/MarkdownView'
import { idFromRef, toRef } from '../lib/refs'
import styles from './Pages.module.css'

type Field = 'name' | 'category' | 'summary' | 'tags' | 'links' | 'body_md'
type Draft = Partial<Pick<Practice, Field>>

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1)
const parseTags = (text: string) => [...new Set(text.split(',').map((t) => t.trim()).filter(Boolean))]
const excerpt = (md: string) =>
  md
    .split('\n')
    .map((line) => line.replace(/^[#>*\-\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(' ')
    .slice(0, 160)

export default function PracticePage() {
  const { practiceRef } = useParams()
  const id = idFromRef(practiceRef)
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'history' ? 'history' : 'overview'
  const { data: practice, isError } = usePractice(id)
  const setArchived = useSetPracticeArchived()
  const { ensureName } = useNamePrompt()

  if (id === null || isError) {
    return (
      <div className={styles.page}>
        <h1>Practice not found</h1>
        <Link to="/practices">Back to the catalog</Link>
      </div>
    )
  }
  if (!practice) {
    return (
      <div className={styles.page}>
        <p className={styles.muted}>Loading…</p>
      </div>
    )
  }

  async function toggleArchived(p: PracticeDetail) {
    await ensureName()
    await setArchived.mutateAsync({ id: p.id, archived: p.archived_at === null })
  }

  return (
    <div className={styles.page}>
      {practice.archived_at && (
        <div role="status" className={styles.similar}>
          Archived. This practice is hidden from radars and the catalog.{' '}
          <button onClick={() => toggleArchived(practice)}>Restore practice</button>
        </div>
      )}
      <div role="tablist" aria-label="Practice sections" className={styles.filters}>
        <button role="tab" aria-selected={tab === 'overview'} onClick={() => setParams({})}>
          Overview
        </button>
        <button role="tab" aria-selected={tab === 'history'} onClick={() => setParams({ tab: 'history' })}>
          History
        </button>
        {!practice.archived_at && (
          <button style={{ marginLeft: 'auto' }} onClick={() => toggleArchived(practice)}>
            Archive practice
          </button>
        )}
      </div>
      {tab === 'overview' ? <Overview practice={practice} /> : <History practice={practice} />}
    </div>
  )
}

function InlineField(props: {
  label: string
  editing: boolean
  onEdit: () => void
  onDone: () => void
  display: ReactNode
  children: ReactNode
}) {
  return (
    <section className={styles.inlineField}>
      {props.editing ? (
        <>
          <div>{props.children}</div>
          <button onClick={props.onDone}>Done</button>
        </>
      ) : (
        <>
          <div>{props.display}</div>
          <button className={styles.editButton} aria-label={`Edit ${props.label.toLowerCase()}`} onClick={props.onEdit}>
            ✎
          </button>
        </>
      )}
    </section>
  )
}

function TagsEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [text, setText] = useState(tags.join(', '))
  return (
    <input
      aria-label="Tags"
      value={text}
      placeholder="comma, separated, tags"
      onChange={(e) => {
        setText(e.target.value)
        onChange(parseTags(e.target.value))
      }}
    />
  )
}

function LinksEditor({ links, onChange }: { links: PracticeLink[]; onChange: (links: PracticeLink[]) => void }) {
  const set = (i: number, patch: Partial<PracticeLink>) =>
    onChange(links.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  return (
    <div>
      {links.map((l, i) => (
        <div key={i} className={styles.filters}>
          <input aria-label={`Link ${i + 1} label`} value={l.label} onChange={(e) => set(i, { label: e.target.value })} />
          <input aria-label={`Link ${i + 1} URL`} type="url" value={l.url} onChange={(e) => set(i, { url: e.target.value })} />
          <button aria-label={`Remove link ${i + 1}`} onClick={() => onChange(links.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button onClick={() => onChange([...links, { label: '', url: 'https://' }])}>Add link</button>
    </div>
  )
}

function Overview({ practice }: { practice: PracticeDetail }) {
  const [draft, setDraft] = useState<Draft>({})
  const [editing, setEditing] = useState<Field | null>(null)
  const [conflict, setConflict] = useState(false)
  const update = useUpdatePractice()
  const queryClient = useQueryClient()
  const { ensureName } = useNamePrompt()
  const toast = useToast()

  const changed = (Object.keys(draft) as Field[]).filter(
    (f) => JSON.stringify(draft[f]) !== JSON.stringify(practice[f]),
  )
  const dirty = changed.length > 0
  const view = { ...practice, ...draft }
  const stage = <F extends Field>(field: F, value: Practice[F]) => setDraft((d) => ({ ...d, [field]: value }))
  const edit = (field: Field) => ({
    editing: editing === field,
    onEdit: () => setEditing(field),
    onDone: () => setEditing(null),
  })

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname,
  )
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  async function save() {
    await ensureName()
    const body: PracticeUpdate = { version: practice.version }
    for (const field of changed) Object.assign(body, { [field]: draft[field] })
    try {
      await update.mutateAsync({ id: practice.id, body })
      setDraft({})
      setEditing(null)
      setConflict(false)
    } catch (err) {
      if (!isConflict(err)) return toast({ message: 'Could not save your changes.', tone: 'error' })
      const current = conflictCurrent<Practice>(err)
      if (current) queryClient.setQueryData(keys.practice(practice.id), { ...practice, ...current })
      setConflict(true)
    }
  }

  function discard() {
    setDraft({})
    setEditing(null)
    setConflict(false)
  }

  return (
    <>
      {conflict && (
        <p role="alert" className={styles.error}>
          Someone else saved changes to this practice. Your edits are kept below. Review them and save again.
        </p>
      )}
      <div className={styles.practiceLayout}>
        <article className={styles.practiceMain}>
          <InlineField label="Category" {...edit('category')} display={<CategoryChip category={view.category} />}>
            <select aria-label="Category" value={view.category} onChange={(e) => stage('category', e.target.value as Category)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {capitalize(c)}
                </option>
              ))}
            </select>
          </InlineField>
          <InlineField label="Name" {...edit('name')} display={<h1 style={{ margin: 0 }}>{view.name}</h1>}>
            <input aria-label="Name" value={view.name} maxLength={100} onChange={(e) => stage('name', e.target.value)} />
          </InlineField>
          <InlineField
            label="Summary"
            {...edit('summary')}
            display={view.summary ? <p>{view.summary}</p> : <p className={styles.muted}>No summary yet.</p>}
          >
            <input aria-label="Summary" value={view.summary} maxLength={280} onChange={(e) => stage('summary', e.target.value)} />
          </InlineField>
          <InlineField
            label="Tags"
            {...edit('tags')}
            display={
              view.tags.length ? (
                view.tags.map((t) => (
                  <span key={t} className={styles.badge}>
                    {t}
                  </span>
                ))
              ) : (
                <span className={styles.muted}>No tags.</span>
              )
            }
          >
            <TagsEditor tags={view.tags} onChange={(tags) => stage('tags', tags)} />
          </InlineField>
          <InlineField
            label="Links"
            {...edit('links')}
            display={
              view.links.length ? (
                <ul>
                  {view.links.map((l, i) => (
                    <li key={i}>
                      <a href={l.url} target="_blank" rel="noreferrer">
                        {l.label}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className={styles.muted}>No links.</span>
              )
            }
          >
            <LinksEditor links={view.links} onChange={(links) => stage('links', links)} />
          </InlineField>
          <InlineField
            label="Guidance"
            {...edit('body_md')}
            display={<MarkdownView source={view.body_md || '_No guidance yet._'} />}
          >
            <Editor value={view.body_md} onChange={(value) => stage('body_md', value)} label="Guidance" />
          </InlineField>
        </article>
        <aside className={styles.card} aria-label="Teams using it">
          <h2 style={{ margin: 0, fontSize: 16 }}>Teams using it ({practice.teams.length})</h2>
          {practice.teams.length === 0 && <p className={styles.muted}>No team has this on its radar yet.</p>}
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {practice.teams.map((t) => (
              <li key={t.team_id}>
                <Link to={`/radar/team/${toRef(t.team_id, t.team_slug)}`}>{t.team_name}</Link> · {t.label}
                {t.note_md && <p className={styles.muted}>{excerpt(t.note_md)}</p>}
              </li>
            ))}
          </ul>
        </aside>
      </div>
      <UnsavedChangesBar count={changed.length} saving={update.isPending} onSave={save} onDiscard={discard} />
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title="Discard unsaved changes?"
        message="You have unsaved changes on this practice. Leaving will discard them."
        confirmLabel="Discard changes"
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />
    </>
  )
}

const ACTION_LABELS: Record<string, string> = {
  create: 'Created',
  update: 'Edited',
  archive: 'Archived',
  restore: 'Restored',
  revert: 'Reverted',
}
const TIME = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

function History({ practice }: { practice: PracticeDetail }) {
  const { data: revisions = [], isLoading } = useRevisions('practice', String(practice.id))
  const revert = useRevert()
  const { ensureName } = useNamePrompt()
  const toast = useToast()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const selected = revisions.find((r) => r.id === selectedId) ?? revisions[0]
  const snapshot = selected?.snapshot as Partial<Practice> | undefined

  async function onRevert() {
    if (!selected) return
    await ensureName()
    try {
      await revert.mutateAsync(selected.id)
      setSelectedId(null)
      toast({ message: 'Reverted to the selected version.' })
    } catch (err) {
      toast({
        message: isConflict(err)
          ? 'Can’t revert: that name is now used by another practice.'
          : 'Could not revert.',
        tone: 'error',
      })
    }
  }

  return (
    <div className={styles.practiceLayout}>
      <ol aria-label="Revisions" className={styles.revisionList}>
        {revisions.map((r) => (
          <li key={r.id}>
            <button aria-pressed={r.id === selected?.id} onClick={() => setSelectedId(r.id)}>
              {ACTION_LABELS[r.action] ?? r.action} by {r.edited_by ?? 'anonymous'} · {TIME.format(new Date(r.created_at))}
            </button>
          </li>
        ))}
      </ol>
      {isLoading && <p className={styles.muted}>Loading…</p>}
      {selected && snapshot && (
        <section className={styles.card} aria-label="Selected version">
          <h2 style={{ margin: 0 }}>{snapshot.name}</h2>
          <p>{snapshot.summary}</p>
          <MarkdownView source={snapshot.body_md ?? ''} />
          <div className={styles.actions}>
            <button
              className="primary"
              onClick={onRevert}
              disabled={revert.isPending || selected.id === revisions[0]?.id}
            >
              Revert to this
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- src/pages && npm run typecheck`
Expected: all page tests pass (5 teams, 6 catalog, 8 radar and 7 practice), and there are no type errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages
git commit -m "feat(frontend): add practice page with staged inline editing, history and revert"
```

---

## Plan 2 completion check

- [ ] Run `cd frontend && npm test && npm run typecheck && npm run build && npm run check:api`. All pass, and `check:api` shows no diff.
- [ ] Manual walkthrough with the backend running and `npm run dev`:
  1. Create two teams.
  2. Create three practices, and check that the duplicate hint appears.
  3. Place practices on both team radars.
  4. Backdate a move.
  5. Play the animation.
  6. Check the org spread.
  7. Edit a practice inline and save.
  8. Revert it on the History tab.
  9. Archive and restore it.
  10. Switch the editor between Rich and Markdown.
- [ ] Check the look in light **and** dark system themes. The `--edit-past` border must be distinct from all category colours.
- [ ] Continue with **Plan 3** (`docs/superpowers/plans/2026-09-13-ai-radar-3-delivery.md`).
