# AI Radar frontend

A React 19 + TypeScript + Vite single-page app, using TanStack Query for data
fetching and React Router for routing.

## Setup

This machine's local Node is newer than the version CI pins (CI uses Node 22
LTS; local development here runs on Node 25), and `npm test` needs
`NODE_OPTIONS=--no-experimental-webstorage` to work around a Node 25
`localStorage` behavior change — the `test` script already sets this for you.
`.npmrc` sets `legacy-peer-deps=true` so `npm install` resolves peer
dependencies the same way in CI and locally.

## npm scripts

- `npm run dev` — start the Vite dev server.
- `npm test` — run the Vitest suite (Vitest + Testing Library + MSW, jsdom).
- `npm run typecheck` — type-check the project with `tsc -b`.
- `npm run build` — type-check and build the production bundle.
- `npm run gen:api` — regenerate `openapi.json` and `src/api/schema.d.ts` from
  the backend's OpenAPI spec.
- `npm run check:api` — regenerate the API types and fail if they differ from
  what's committed, to catch a frontend that has drifted from the backend API.
