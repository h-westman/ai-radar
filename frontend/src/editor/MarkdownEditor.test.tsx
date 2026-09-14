import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import MarkdownEditor from './MarkdownEditor'

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <MarkdownEditor value={value} onChange={setValue} label="Guidance" />
      <output data-testid="value">{value}</output>
    </>
  )
}

describe('MarkdownEditor', () => {
  it('edits text and applies toolbar actions', async () => {
    render(<Harness />)
    const textarea = screen.getByRole('textbox', { name: 'Guidance' }) as HTMLTextAreaElement
    await userEvent.type(textarea, 'hello')
    textarea.setSelectionRange(0, 5)
    await userEvent.click(screen.getByRole('button', { name: 'Bold' }))
    expect(screen.getByTestId('value')).toHaveTextContent('**hello**')
  })

  it('shows a rendered preview', async () => {
    render(<Harness initial="## Title" />)
    await userEvent.click(screen.getByRole('tab', { name: 'Preview' }))
    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument()
  })

  it('does not submit an enclosing form when a tab is clicked', async () => {
    const onSubmit = vi.fn()
    render(
      <form onSubmit={onSubmit}>
        <Harness initial="## Title" />
      </form>,
    )
    await userEvent.click(screen.getByRole('tab', { name: 'Preview' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
