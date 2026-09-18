import { QueryClientProvider } from '@tanstack/react-query'
import { render as baseRender, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EDITOR_MODE_KEY } from '../editor/Editor'
import { setEditedBy } from '../lib/editedBy'
import { note } from '../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { NamePromptProvider } from './NamePrompt'
import { ToastProvider } from './Toasts'
import Drawer, { type DrawerPractice } from './Drawer'

const practice = { id: 10, name: 'Claude Code', category: 'tool' as const, summary: 'Agentic coding.' }
const otherPractice: DrawerPractice = { id: 11, name: 'Other Practice', category: 'tool', summary: 'Something else.' }

function renderDrawerHarness(practiceProp: DrawerPractice) {
  const client = createTestQueryClient()
  const tree = (p: DrawerPractice) => (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <NamePromptProvider>
          <MemoryRouter>
            <Drawer scope="radar" practice={p} label="Core" radarId={1} canRemove onRemove={() => {}} onClose={() => {}} />
          </MemoryRouter>
        </NamePromptProvider>
      </ToastProvider>
    </QueryClientProvider>
  )
  const utils = baseRender(tree(practiceProp))
  return { ...utils, rerenderWith: (p: DrawerPractice) => utils.rerender(tree(p)) }
}

beforeEach(() => {
  setEditedBy('Kim')
  localStorage.setItem(EDITOR_MODE_KEY, 'markdown')
})

describe('Drawer', () => {
  it('shows practice details, note and links', async () => {
    server.use(http.get('/api/radars/1/notes/10', () => HttpResponse.json(note())))
    const onRemove = vi.fn()
    renderWithProviders(
      <Drawer scope="radar" practice={practice} label="Core" radarId={1} canRemove onRemove={onRemove} onClose={() => {}} />,
    )
    expect(screen.getByRole('complementary', { name: 'Details for Claude Code' })).toBeInTheDocument()
    expect(screen.getByText('Core')).toBeInTheDocument()
    expect(await screen.findByText('We use it for refactors.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open page' })).toHaveAttribute('href', '/practices/10')
    await userEvent.click(screen.getByRole('button', { name: 'Remove from radar' }))
    expect(onRemove).toHaveBeenCalledOnce()
  })

  it('edits the radar note', async () => {
    let body: unknown
    server.use(
      http.get('/api/radars/1/notes/10', () => HttpResponse.json(note())),
      http.put('/api/radars/1/notes/10', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(note({ body_md: 'Updated', version: 2 }))
      }),
    )
    renderWithProviders(
      <Drawer scope="radar" practice={practice} label="Core" radarId={1} canRemove onRemove={() => {}} onClose={() => {}} />,
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
      http.get('/api/radars/1/notes/10', () => HttpResponse.json(note())),
      http.put('/api/radars/1/notes/10', () =>
        HttpResponse.json(
          { detail: 'changed', current: note({ body_md: 'Their text', version: 2 }) },
          { status: 409 },
        ),
      ),
    )
    renderWithProviders(
      <Drawer scope="radar" practice={practice} label="Core" radarId={1} canRemove onRemove={() => {}} onClose={() => {}} />,
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Edit note' }))
    const textarea = screen.getByRole('textbox', { name: 'How we use it' })
    await userEvent.type(textarea, ' mine')
    await userEvent.click(screen.getByRole('button', { name: 'Save note' }))
    expect(await screen.findByText(/someone else saved this note/i)).toBeInTheDocument()
    expect(screen.getByText('Their text')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'How we use it' })).toHaveValue('We use it for refactors. mine')
  })

  it('does not leak a note draft to a different practice when the drawer re-renders', async () => {
    let putCalled = false
    server.use(
      http.get('/api/radars/1/notes/10', () => HttpResponse.json(note())),
      http.get('/api/radars/1/notes/11', () =>
        HttpResponse.json(note({ practice_id: 11, body_md: 'Their note for the other practice.' })),
      ),
      http.put('/api/radars/1/notes/:practiceId', () => {
        putCalled = true
        return HttpResponse.json(note())
      }),
    )
    const { rerenderWith } = renderDrawerHarness(practice)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit note' }))
    const textarea = screen.getByRole('textbox', { name: 'How we use it' })
    await userEvent.type(textarea, ' plus a draft for practice 10')

    rerenderWith(otherPractice)

    expect(await screen.findByRole('button', { name: 'Edit note' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'How we use it' })).not.toBeInTheDocument()
    expect(await screen.findByText('Their note for the other practice.')).toBeInTheDocument()
    expect(putCalled).toBe(false)
  })

  it('lists radars in the org scope without remove', () => {
    renderWithProviders(
      <Drawer
        scope="org"
        practice={practice}
        label="Core"
        radars={[
          { radarId: 1, radarName: 'Platform', label: 'Core' },
          { radarId: 2, radarName: 'Payments', label: 'Hidden gem' },
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

  it('lists who is using the practice in org scope', () => {
    renderWithProviders(
      <Drawer
        scope="org"
        practice={practice}
        label="Core"
        radars={[{ radarId: 3, radarName: 'Platform', label: 'Core' }]}
        canRemove={false}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Who’s using it' })).toBeInTheDocument()
    expect(screen.getByText('Platform')).toBeInTheDocument()
  })
})
