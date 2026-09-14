import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import RadarChart from './RadarChart'
import { PRACTICE_MIME } from './renderRadar'

const noop = () => {}

describe('RadarChart', () => {
  it('renders bubbles and accepts practice drops inside the plot', () => {
    const onDropPractice = vi.fn()
    const { container } = render(
      <RadarChart
        scope="team"
        bubbles={[{ practiceId: 10, name: 'Claude Code', category: 'tool', adoption: 70, value: 80, teams: 1 }]}
        dateLabel="Feb 2026"
        selected={[]}
        trails={{}}
        editable
        editingPast={false}
        highlight=""
        duration={0}
        onSelect={noop}
        onMove={noop}
        onRemove={noop}
        onNudge={noop}
        onDropPractice={onDropPractice}
      />,
    )
    expect(container.querySelectorAll('g.radar-bubble')).toHaveLength(1)
    // jsdom: no ResizeObserver, so the fallback 640x480 applies and the plot box is (36,16,588,428)
    const target = container.firstElementChild!
    fireEvent.drop(target, {
      clientX: 36 + 294,
      clientY: 16 + 214,
      dataTransfer: { types: [PRACTICE_MIME], getData: () => '12' },
    })
    expect(onDropPractice).toHaveBeenCalledWith(12, 50, 50)
  })
})
