import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writeString } from '../lib/storage'
import { radar } from '../test/fixtures'
import { renderRoutes } from '../test/render'
import { server } from '../test/server'
import { LAST_RADAR_KEY } from './AppShell'

// RadarPage, CatalogPage and PracticePage still import the deleted `lib/refs`
// module (Tasks 7/8 fix that). Stub them out so the router can be exercised
// here without pulling in those still-broken pages.
vi.mock('../pages/RadarPage', () => ({ default: () => <div data-testid="radar-page-stub" /> }))
vi.mock('../pages/CatalogPage', () => ({ default: () => <div data-testid="catalog-page-stub" /> }))
vi.mock('../pages/PracticePage', () => ({ default: () => <div data-testid="practice-page-stub" /> }))

beforeEach(() => {
  server.use(
    http.get('/api/radars', () =>
      HttpResponse.json([radar({ id: 1, name: 'Platform' }), radar({ id: 2, name: 'Payments' })]),
    ),
  )
})

describe('app shell', () => {
  it('redirects home to the org radar by default', async () => {
    const { router } = renderRoutes('/')
    await waitFor(() => expect(router.state.location.pathname).toBe('/radar/org'))
  })

  it('redirects home to the last radar', async () => {
    writeString(LAST_RADAR_KEY, '2')
    const { router } = renderRoutes('/')
    await waitFor(() => expect(router.state.location.pathname).toBe('/radar/2'))
  })

  it('navigates to a bare-id radar url', async () => {
    const { router } = renderRoutes('/radar/org')
    const select = await screen.findByRole('combobox', { name: 'Radar' })
    await screen.findByRole('option', { name: 'Platform' })
    await userEvent.selectOptions(select, '1')
    await waitFor(() => expect(router.state.location.pathname).toBe('/radar/1'))
  })

  it('switches scope and remembers the radar', async () => {
    const { router } = renderRoutes('/radar/org')
    const select = await screen.findByRole('combobox', { name: 'Radar' })
    await screen.findByRole('option', { name: 'Payments' })
    await userEvent.selectOptions(select, '2')
    expect(router.state.location.pathname).toBe('/radar/2')
    expect(localStorage.getItem(LAST_RADAR_KEY)).toBe('2')
    await userEvent.selectOptions(select, 'org')
    expect(router.state.location.pathname).toBe('/radar/org')
  })

  it('shows the current radar selected when navigating directly by id', async () => {
    renderRoutes('/radar/1')
    const select = await screen.findByRole('combobox', { name: 'Radar' })
    await screen.findByRole('option', { name: 'Platform' })
    await waitFor(() => expect(select).toHaveValue('1'))
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
