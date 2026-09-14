import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import UnsavedChangesBar from './UnsavedChangesBar'

describe('UnsavedChangesBar', () => {
  it('renders nothing without changes', () => {
    const { container } = render(<UnsavedChangesBar count={0} saving={false} onSave={() => {}} onDiscard={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the count and actions', async () => {
    const onSave = vi.fn()
    const onDiscard = vi.fn()
    render(<UnsavedChangesBar count={3} saving={false} onSave={onSave} onDiscard={onDiscard} />)
    expect(screen.getByText('3 unsaved changes')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onSave).toHaveBeenCalledOnce()
    expect(onDiscard).toHaveBeenCalledOnce()
  })

  it('uses singular wording and disables while saving', () => {
    render(<UnsavedChangesBar count={1} saving onSave={() => {}} onDiscard={() => {}} />)
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
  })
})
