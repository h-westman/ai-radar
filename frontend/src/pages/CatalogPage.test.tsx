import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PracticeCreate } from '../api/types'
import { setEditedBy } from '../lib/editedBy'
import { detail, listItem, practice } from '../test/fixtures'
import { renderRoutes } from '../test/render'
import { server } from '../test/server'

let lastQuery: URLSearchParams

beforeEach(() => {
  setEditedBy('Kim')
  server.use(
    http.get('/api/radars', () => HttpResponse.json([])),
    http.get('/api/practices', ({ request }) => {
      lastQuery = new URL(request.url).searchParams
      const all = [
        listItem({ radars_count: 3, tags: ['agentic'] }),
        listItem({ id: 11, name: 'Spec-driven dev', category: 'practice', tags: ['process'] }),
      ]
      const q = lastQuery.get('q')?.toLowerCase()
      return HttpResponse.json(q ? all.filter((p) => p.name.toLowerCase().includes(q)) : all)
    }),
    http.get('/api/practices/:id', ({ params }) => HttpResponse.json(detail({ id: Number(params.id) }))),
    http.get('/api/revisions', () => HttpResponse.json([])),
  )
})

describe('CatalogPage', () => {
  it('lists practices with radar counts and links', async () => {
    renderRoutes('/practices')
    const link = await screen.findByRole('link', { name: 'Claude Code' })
    expect(link).toHaveAttribute('href', '/practices/10')
    expect(screen.getByLabelText('3 radars')).toBeInTheDocument()
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
      http.get('/api/practices/similar', () => HttpResponse.json([listItem({ id: 5, name: 'GitHub Copilot' })])),
    )
    renderRoutes('/practices')
    await userEvent.click(screen.getByRole('button', { name: '+ New practice' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'copilot')
    expect(await screen.findByText('Did you mean…')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'GitHub Copilot' })).toHaveAttribute('href', '/practices/5')
  })

  it('creates a practice and opens it', async () => {
    server.use(
      http.get('/api/practices/similar', () => HttpResponse.json([])),
      http.post('/api/practices', () => HttpResponse.json(practice({ id: 42, name: 'MCP servers' }), { status: 201 })),
    )
    const { router } = renderRoutes('/practices')
    await userEvent.click(screen.getByRole('button', { name: '+ New practice' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'MCP servers')
    await userEvent.click(screen.getByRole('button', { name: 'Create practice' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/practices/42'))
  })

  it('creates a practice with the chosen category', async () => {
    let created: PracticeCreate | undefined
    server.use(
      http.get('/api/practices/similar', () => HttpResponse.json([])),
      http.post('/api/practices', async ({ request }) => {
        created = (await request.json()) as PracticeCreate
        return HttpResponse.json(practice({ id: 42, name: 'Daily agent standup' }), {
          status: 201,
        })
      }),
    )
    renderRoutes('/practices')
    await userEvent.click(screen.getByRole('button', { name: '+ New practice' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Daily agent standup')
    await userEvent.click(screen.getByRole('radio', { name: 'Workflow' }))
    await userEvent.click(screen.getByRole('button', { name: 'Create practice' }))
    await waitFor(() => expect(created).toMatchObject({ category: 'workflow' }))
  })

  it('explains each category while you choose one', async () => {
    renderRoutes('/practices')
    await userEvent.click(screen.getByRole('button', { name: '+ New practice' }))
    expect(screen.getByRole('radio', { name: 'Practice' })).toHaveAccessibleDescription(
      /a habit your team applies while working/i,
    )
  })

  it('offers to restore an archived duplicate', async () => {
    const archived = practice({ id: 7, name: 'Cursor', archived_at: '2026-01-01T00:00:00Z' })
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
    await waitFor(() => expect(router.state.location.pathname).toBe('/practices/7'))
  })

  it('shows error toast when restore request fails', async () => {
    const archived = practice({ id: 7, name: 'Cursor', archived_at: '2026-01-01T00:00:00Z' })
    server.use(
      http.get('/api/practices/similar', () => HttpResponse.json([])),
      http.post('/api/practices', () => HttpResponse.json({ detail: 'exists', current: archived }, { status: 409 })),
      http.post('/api/practices/7/restore', () => HttpResponse.json(null, { status: 500 })),
    )
    const { router } = renderRoutes('/practices')
    await userEvent.click(screen.getByRole('button', { name: '+ New practice' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'cursor')
    await userEvent.click(screen.getByRole('button', { name: 'Create practice' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/archived/i)
    await userEvent.click(screen.getByRole('button', { name: 'Restore it' }))
    expect(await screen.findByText('Could not restore the practice.')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/practices')
  })
})
