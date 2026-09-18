import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Radar } from '../api/types'
import { setEditedBy } from '../lib/editedBy'
import { radar } from '../test/fixtures'
import { renderRoutes } from '../test/render'
import { server } from '../test/server'

// RadarPage, CatalogPage and PracticePage still import the deleted `lib/refs`
// module (Tasks 7/8 fix that). Stub them out so the router can be exercised
// here without pulling in those still-broken pages.
vi.mock('./RadarPage', () => ({ default: () => <div data-testid="radar-page-stub" /> }))
vi.mock('./CatalogPage', () => ({ default: () => <div data-testid="catalog-page-stub" /> }))
vi.mock('./PracticePage', () => ({ default: () => <div data-testid="practice-page-stub" /> }))

let radars: Radar[]
let lastPatch: unknown

beforeEach(() => {
  setEditedBy('Kim')
  radars = [radar()]
  lastPatch = undefined
  server.use(
    http.get('/api/radars', ({ request }) => {
      const all = new URL(request.url).searchParams.get('include_archived') === 'true'
      return HttpResponse.json(radars.filter((r) => all || !r.archived_at))
    }),
    http.post('/api/radars', async ({ request }) => {
      const body = (await request.json()) as { name: string }
      const existing = radars.find((r) => r.name.toLowerCase() === body.name.toLowerCase())
      if (existing) return HttpResponse.json({ detail: 'exists', current: existing }, { status: 409 })
      const created = radar({ id: radars.length + 1, name: body.name })
      radars.push(created)
      return HttpResponse.json(created, { status: 201 })
    }),
    http.patch('/api/radars/:id', async ({ params, request }) => {
      lastPatch = await request.json()
      const r = radars.find((x) => x.id === Number(params.id))!
      Object.assign(r, lastPatch as object, { version: r.version + 1 })
      return HttpResponse.json(r)
    }),
    http.post('/api/radars/:id/:action', ({ params }) => {
      const r = radars.find((x) => x.id === Number(params.id))!
      r.archived_at = params.action === 'archive' ? '2026-03-01T00:00:00Z' : null
      return HttpResponse.json(r)
    }),
  )
})

const list = () => screen.getByRole('list', { name: 'Radars' })

describe('RadarListPage', () => {
  it('lists radars linking to their radar pages', async () => {
    renderRoutes('/radars')
    const link = await within(await screen.findByRole('list', { name: 'Radars' })).findByRole('link', {
      name: 'Platform',
    })
    expect(link).toHaveAttribute('href', '/radar/1')
  })

  it('creates a radar', async () => {
    renderRoutes('/radars')
    await userEvent.type(screen.getByRole('textbox', { name: 'Radar name' }), 'Payments')
    await userEvent.click(screen.getByRole('button', { name: 'Create radar' }))
    expect(await within(list()).findByRole('link', { name: 'Payments' })).toBeInTheDocument()
  })

  it('explains duplicate names', async () => {
    renderRoutes('/radars')
    await userEvent.type(screen.getByRole('textbox', { name: 'Radar name' }), 'platform')
    await userEvent.click(screen.getByRole('button', { name: 'Create radar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/i)
  })

  it('renames with the current version', async () => {
    renderRoutes('/radars')
    await userEvent.click(await screen.findByRole('button', { name: 'Rename Platform' }))
    const input = screen.getByRole('textbox', { name: 'New name for Platform' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Core')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(lastPatch).toEqual({ version: 1, name: 'Core', description: null }))
    expect(await within(list()).findByRole('link', { name: 'Core' })).toBeInTheDocument()
  })

  it('archives and restores', async () => {
    renderRoutes('/radars')
    await userEvent.click(await screen.findByRole('button', { name: 'Archive Platform' }))
    await waitFor(() => expect(within(list()).queryByText('Platform')).not.toBeInTheDocument())
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show archived' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Restore Platform' }))
    expect(await screen.findByRole('button', { name: 'Archive Platform' })).toBeInTheDocument()
  })

  it('shows toast when archive fails', async () => {
    server.use(
      http.post('/api/radars/:id/:action', () => {
        return HttpResponse.json({ detail: 'Server error' }, { status: 500 })
      }),
    )
    renderRoutes('/radars')
    await userEvent.click(await screen.findByRole('button', { name: 'Archive Platform' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/Could not update the radar/i)
    expect(await within(list()).findByRole('link', { name: 'Platform' })).toBeInTheDocument()
  })

  it('refreshes the radar version after a rename conflict so a retry succeeds', async () => {
    let attempt = 0
    server.use(
      http.patch('/api/radars/:id', async ({ params, request }) => {
        attempt += 1
        const body = (await request.json()) as { version: number; name: string; description: string | null }
        if (attempt === 1) {
          // Someone else renamed the radar first: bump its version server-side and report a conflict.
          const r = radars.find((x) => x.id === Number(params.id))!
          r.version = 2
          return HttpResponse.json({ detail: 'exists' }, { status: 409 })
        }
        lastPatch = body
        const r = radars.find((x) => x.id === Number(params.id))!
        Object.assign(r, body, { version: r.version + 1 })
        return HttpResponse.json(r)
      }),
    )
    renderRoutes('/radars')
    await userEvent.click(await screen.findByRole('button', { name: 'Rename Platform' }))
    const input = screen.getByRole('textbox', { name: 'New name for Platform' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Core')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/taken|changed/i)

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(lastPatch).toEqual({ version: 2, name: 'Core', description: null }))
  })

  it('shows toast when rename fails', async () => {
    server.use(
      http.patch('/api/radars/:id', () => {
        return HttpResponse.json({ detail: 'Server error' }, { status: 500 })
      }),
    )
    renderRoutes('/radars')
    await userEvent.click(await screen.findByRole('button', { name: 'Rename Platform' }))
    const input = screen.getByRole('textbox', { name: 'New name for Platform' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Core')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/Could not save the radar/i)
  })
})
