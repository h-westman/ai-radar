import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PRACTICE_MIME } from '../chart/renderRadar'
import { listItem } from '../test/fixtures'
import { renderWithProviders as render } from '../test/render'
import Tray from './Tray'

// '../test/render' imports the app router, which still statically imports
// CatalogPage and PracticePage. Those still import the deleted `lib/refs`
// module (Task 8 fixes that). Stub them out so this file's render helper
// loads without pulling in those still-broken pages.
vi.mock('../pages/CatalogPage', () => ({ default: () => null }))
vi.mock('../pages/PracticePage', () => ({ default: () => null }))

const practices = [
  listItem({ id: 12, name: 'Prompt library', category: 'workflow' }),
  listItem({ id: 13, name: 'MCP servers' }),
]

describe('Tray', () => {
  it('filters and places practices', async () => {
    const onPlace = vi.fn()
    render(<Tray practices={practices} editable onPlace={onPlace} />)
    await userEvent.type(screen.getByRole('searchbox', { name: 'Filter practices' }), 'mcp')
    expect(screen.queryByText('Prompt library')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Place MCP servers' }))
    expect(onPlace).toHaveBeenCalledWith(13)
  })

  it('puts the practice id on drag', () => {
    render(<Tray practices={practices} editable onPlace={() => {}} />)
    const setData = vi.fn()
    fireEvent.dragStart(screen.getByText('Prompt library'), { dataTransfer: { setData, effectAllowed: '' } })
    expect(setData).toHaveBeenCalledWith(PRACTICE_MIME, '12')
  })

  it('is inert when not editable', () => {
    render(<Tray practices={practices} editable={false} onPlace={() => {}} />)
    expect(screen.getByRole('button', { name: 'Place MCP servers' })).toBeDisabled()
  })

  it('shows an empty state', () => {
    render(<Tray practices={[]} editable onPlace={() => {}} />)
    expect(screen.getByText(/everything in the catalog is on this radar/i)).toBeInTheDocument()
  })
})
