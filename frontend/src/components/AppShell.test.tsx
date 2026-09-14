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
