import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CategoryRadios from './CategoryRadios'

describe('CategoryRadios', () => {
  it('groups the options under a Category legend', () => {
    render(<CategoryRadios value="tool" onChange={() => {}} />)
    expect(screen.getByRole('group', { name: 'Category' })).toBeInTheDocument()
  })

  it('offers one option per category', () => {
    render(<CategoryRadios value="tool" onChange={() => {}} />)
    const names = screen.getAllByRole('radio').map((r) => r.getAttribute('value'))
    expect(names).toEqual(['tool', 'skill', 'practice', 'workflow'])
  })

  it('names each option by its category alone', () => {
    render(<CategoryRadios value="tool" onChange={() => {}} />)
    expect(screen.getByRole('radio', { name: 'Workflow' })).toBeInTheDocument()
  })

  it('describes each option for screen readers', () => {
    render(<CategoryRadios value="tool" onChange={() => {}} />)
    expect(screen.getByRole('radio', { name: 'Skill' })).toHaveAccessibleDescription(
      /something a person gets better at with practice/i,
    )
  })

  it('checks the current value', () => {
    render(<CategoryRadios value="practice" onChange={() => {}} />)
    expect(screen.getByRole('radio', { name: 'Practice' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Tool' })).not.toBeChecked()
  })

  it('reports a new choice', async () => {
    const onChange = vi.fn()
    render(<CategoryRadios value="tool" onChange={onChange} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Workflow' }))
    expect(onChange).toHaveBeenCalledWith('workflow')
  })

  it('moves to the next option with the arrow keys', async () => {
    const onChange = vi.fn()
    render(<CategoryRadios value="tool" onChange={onChange} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Tool' }))
    await userEvent.keyboard('{ArrowDown}')
    expect(onChange).toHaveBeenLastCalledWith('skill')
  })
})
