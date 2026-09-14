import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import Editor, { EDITOR_MODE_KEY } from './Editor'

vi.mock('./RichEditor', () => ({
  default: ({ label }: { label: string }) => <div data-testid="rich" aria-label={label} />,
}))

describe('Editor', () => {
  it('defaults to rich mode', () => {
    render(<Editor value="x" onChange={() => {}} label="Guidance" />)
    expect(screen.getByTestId('rich')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Rich' })).toHaveAttribute('aria-checked', 'true')
  })

  it('switches to markdown and remembers the choice', async () => {
    const { unmount } = render(<Editor value="x" onChange={() => {}} label="Guidance" />)
    await userEvent.click(screen.getByRole('radio', { name: 'Markdown' }))
    expect(screen.getByRole('textbox', { name: 'Guidance' })).toBeInTheDocument()
    expect(localStorage.getItem(EDITOR_MODE_KEY)).toBe('markdown')
    unmount()
    render(<Editor value="x" onChange={() => {}} label="Guidance" />)
    expect(screen.getByRole('textbox', { name: 'Guidance' })).toBeInTheDocument()
  })
})
