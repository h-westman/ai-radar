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

  it('shows a toast when archiving fails, keeping "Archive practice" shown', async () => {
    server.use(http.post('/api/practices/10/archive', () => HttpResponse.json(null, { status: 500 })))
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Archive practice' }))
    expect(await screen.findByText('Could not update the practice.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Archive practice' })).toBeInTheDocument()
  })
})
