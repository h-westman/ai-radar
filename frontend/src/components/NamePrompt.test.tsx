import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { getEditedBy, setEditedBy } from '../lib/editedBy'
import { NamePromptProvider, useNamePrompt } from './NamePrompt'

function Writer({ onReady }: { onReady: () => void }) {
  const { ensureName } = useNamePrompt()
  return <button onClick={() => ensureName().then(onReady)}>write</button>
}

function setup() {
  const onReady = vi.fn()
  render(
    <NamePromptProvider>
      <Writer onReady={onReady} />
    </NamePromptProvider>,
  )
  return onReady
}

describe('name prompt', () => {
  it('asks for a name before the first write and stores it', async () => {
    const onReady = setup()
    await userEvent.click(screen.getByText('write'))
    const dialog = screen.getByRole('dialog', { name: /who is editing/i })
    await userEvent.type(screen.getByLabelText('Your name'), '  Kim  ')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(getEditedBy()).toBe('Kim')
    expect(onReady).toHaveBeenCalledOnce()
    expect(dialog).not.toBeInTheDocument()
  })

  it('skip stores an empty name and does not ask again', async () => {
    const onReady = setup()
    await userEvent.click(screen.getByText('write'))
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(getEditedBy()).toBe('')
    await userEvent.click(screen.getByText('write'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onReady).toHaveBeenCalledTimes(2)
  })

  it('does not ask when a name is already stored', async () => {
    setEditedBy('Kim')
    const onReady = setup()
    await userEvent.click(screen.getByText('write'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onReady).toHaveBeenCalledOnce()
  })
})
