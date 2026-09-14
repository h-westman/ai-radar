import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Step } from '../api/types'
import Timeline, { FRAME_MS } from './Timeline'

const DATES = ['2026-01-31T23:59:59Z', '2026-02-28T23:59:59Z', '2026-03-13T10:00:00Z']

function Harness({ canEdit = true, initialIndex = 2 }) {
  const [index, setIndex] = useState(initialIndex)
  const [playing, setPlaying] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  const [step, setStep] = useState<Step>('month')
  return (
    <>
      <Timeline
        dates={DATES}
        index={index}
        step={step}
        playing={playing}
        canEdit={canEdit}
        unlocked={unlocked}
        onIndexChange={setIndex}
        onPlayingChange={setPlaying}
        onStepChange={setStep}
        onUnlockedChange={setUnlocked}
      />
      <output data-testid="state">{JSON.stringify({ index, playing, unlocked, step })}</output>
    </>
  )
}

const state = () => JSON.parse(screen.getByTestId('state').textContent!)

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Timeline', () => {
  it('labels the latest frame as Now and past frames by period', () => {
    render(<Harness />)
    expect(screen.getByText('Now')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('slider', { name: 'Timeline' }), { target: { value: '0' } })
    expect(screen.getByText('Jan 2026')).toBeInTheDocument()
  })

  it('plays from the start when at the end and stops at the last frame', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(state()).toMatchObject({ index: 0, playing: true })
    act(() => vi.advanceTimersByTime(FRAME_MS))
    expect(state().index).toBe(1)
    act(() => vi.advanceTimersByTime(FRAME_MS))
    expect(state().index).toBe(2)
    act(() => vi.advanceTimersByTime(FRAME_MS))
    expect(state().playing).toBe(false)
  })

  it('offers Edit here only in the past on editable radars', () => {
    const { unmount } = render(<Harness initialIndex={0} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit here' }))
    expect(state().unlocked).toBe(true)
    expect(screen.getByText(/Editing Jan 2026/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Lock' }))
    expect(state().unlocked).toBe(false)
    unmount()
    render(<Harness initialIndex={2} />)
    expect(screen.queryByRole('button', { name: 'Edit here' })).not.toBeInTheDocument()
  })

  it('hides Edit here on read-only radars and changes step', () => {
    render(<Harness canEdit={false} initialIndex={0} />)
    expect(screen.queryByRole('button', { name: 'Edit here' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'Step' }), { target: { value: 'week' } })
    expect(state().step).toBe('week')
  })
})
