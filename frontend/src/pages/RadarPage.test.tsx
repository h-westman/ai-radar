import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FramesResponse } from '../api/types'
import { LAST_RADAR_KEY } from '../components/AppShell'
import { setEditedBy } from '../lib/editedBy'
import { framesResponse, listItem, radar } from '../test/fixtures'
import { renderRoutes } from '../test/render'
import { server } from '../test/server'

let posted: unknown[]
let frames: FramesResponse

beforeEach(() => {
  setEditedBy('Kim')
  posted = []
  frames = framesResponse()
  server.use(
    http.get('/api/radars', () =>
      HttpResponse.json([radar(), radar({ id: 2, name: 'Payments' })]),
    ),
    http.get('/api/practices', () =>
      HttpResponse.json([
        listItem(),
        listItem({ id: 11, name: 'Spec-driven dev', category: 'practice' }),
        listItem({ id: 12, name: 'Prompt library', category: 'workflow' }),
      ]),
    ),
    http.get('/api/frames', () => HttpResponse.json(frames)),
    http.get('/api/radars/:radarId/notes/:practiceId', () =>
      HttpResponse.json({ detail: 'Note not found' }, { status: 404 }),
    ),
    http.post('/api/placements', async ({ request }) => {
      posted.push(await request.json())
      return HttpResponse.json({ id: posted.length }, { status: 201 })
    }),
  )
})

const bubble = (label: string) => document.querySelector<SVGGElement>(`[aria-label="${label}"]`)

async function openRadar() {
  const view = renderRoutes('/radar/1')
  await waitFor(() => expect(bubble('Claude Code, Core')).not.toBeNull())
  return view
}

describe('RadarPage (radar scope)', () => {
  it('shows the latest frame, and the tray lists practices not on the radar', async () => {
    await openRadar()
    expect(bubble('Spec-driven dev, Hidden gem')).not.toBeNull()
    const tray = screen.getByRole('region', { name: 'Not on radar' })
    expect(within(tray).getByText('Prompt library')).toBeInTheDocument()
    expect(within(tray).queryByText('Claude Code')).not.toBeInTheDocument()
    expect(localStorage.getItem(LAST_RADAR_KEY)).toBe('1')
  })

  it('places a practice from the tray at the centre', async () => {
    await openRadar()
    await userEvent.click(screen.getByRole('button', { name: 'Place Prompt library' }))
    await waitFor(() =>
      expect(posted).toEqual([{ radar_id: 1, practice_id: 12, adoption: 50, value: 50 }]),
    )
  })

  it('opens the drawer, removes with undo', async () => {
    await openRadar()
    fireEvent.click(bubble('Claude Code, Core')!)
    expect(await screen.findByRole('complementary', { name: 'Details for Claude Code' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove from radar' }))
    await waitFor(() => expect(posted[0]).toEqual({ radar_id: 1, practice_id: 10, removed: true }))
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(posted[1]).toEqual({ radar_id: 1, practice_id: 10, adoption: 75, value: 85 }),
    )
  })

  it('backdates changes when editing a past frame', async () => {
    await openRadar()
    fireEvent.change(screen.getByRole('slider', { name: 'Timeline' }), { target: { value: '0' } })
    await userEvent.click(screen.getByRole('button', { name: 'Edit here' }))
    expect(document.querySelector('svg.radar')?.classList.contains('editing-past')).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Place Prompt library' }))
    await waitFor(() =>
      expect(posted[0]).toEqual({
        radar_id: 1,
        practice_id: 12,
        adoption: 50,
        value: 50,
        effective_at: '2026-01-31T23:59:59Z',
      }),
    )
  })

  it('is read-only in the past until unlocked', async () => {
    await openRadar()
    fireEvent.change(screen.getByRole('slider', { name: 'Timeline' }), { target: { value: '0' } })
    expect(screen.getByRole('button', { name: 'Place Prompt library' })).toBeDisabled()
  })

  it('reports failed saves', async () => {
    server.use(http.post('/api/placements', () => HttpResponse.json({ detail: 'boom' }, { status: 500 })))
    await openRadar()
    await userEvent.click(screen.getByRole('button', { name: 'Place Prompt library' }))
    expect(await screen.findByText(/could not save that change/i)).toBeInTheDocument()
  })

  it('filters bubbles by category', async () => {
    await openRadar()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by category' }), 'practice')
    await waitFor(() => expect(bubble('Claude Code, Core')).toBeNull())
    expect(bubble('Spec-driven dev, Hidden gem')).not.toBeNull()
  })
})

describe('RadarPage (org scope)', () => {
  it('is read-only and shows each radar in the drawer', async () => {
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
              radars: 2,
              radar_positions: [
                { radar_id: 1, adoption: 80, value: 90 },
                { radar_id: 2, adoption: 40, value: 70 },
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

  it('shows a not-found message for an unknown radar id', async () => {
    renderRoutes('/radar/999')
    expect(await screen.findByText('This radar doesn’t exist.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See all radars' })).toHaveAttribute('href', '/radars')
  })
})
