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
