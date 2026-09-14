import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ToastProvider, useToast } from './Toasts'

function Trigger({ onUndo }: { onUndo: () => void }) {
  const toast = useToast()
  return (
    <button onClick={() => toast({ message: 'Moved', action: { label: 'Undo', onClick: onUndo } })}>
      go
    </button>
  )
}

describe('toasts', () => {
  it('shows a message with an action', async () => {
    const onUndo = vi.fn()
    render(
      <ToastProvider>
        <Trigger onUndo={onUndo} />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByText('go'))
    expect(screen.getByRole('status')).toHaveTextContent('Moved')
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalledOnce()
    expect(screen.queryByText('Moved')).not.toBeInTheDocument()
  })
})
