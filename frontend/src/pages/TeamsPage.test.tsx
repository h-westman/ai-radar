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

  it('shows toast when archive fails', async () => {
    server.use(
      http.post('/api/teams/:id/:action', () => {
        return HttpResponse.json({ detail: 'Server error' }, { status: 500 })
      }),
    )
    renderRoutes('/teams')
    await userEvent.click(await screen.findByRole('button', { name: 'Archive Platform' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/Could not update the team/i)
    expect(await within(list()).findByRole('link', { name: 'Platform' })).toBeInTheDocument()
  })

  it('shows toast when rename fails', async () => {
    server.use(
      http.patch('/api/teams/:id', () => {
        return HttpResponse.json({ detail: 'Server error' }, { status: 500 })
      }),
    )
    renderRoutes('/teams')
    await userEvent.click(await screen.findByRole('button', { name: 'Rename Platform' }))
    const input = screen.getByRole('textbox', { name: 'New name for Platform' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Core')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/Could not save the team/i)
  })
})
