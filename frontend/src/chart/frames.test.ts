import { describe, expect, it } from 'vitest'
import { framesResponse, listItem } from '../test/fixtures'
import { formatFrameDate, nudge, offRadar, pointMap, trail } from './frames'

const { frames } = framesResponse()

describe('frame helpers', () => {
  it('indexes points by practice id', () => {
    expect(pointMap(frames[1]).get(11)?.value).toBe(60)
    expect(pointMap(undefined).size).toBe(0)
  })

  it('builds a trail up to the current frame', () => {
    expect(trail(frames, 10, 1)).toEqual([
      { date: '2026-01-31T23:59:59Z', adoption: 70, value: 80 },
      { date: '2026-02-28T23:59:59Z', adoption: 75, value: 85 },
    ])
    expect(trail(frames, 10, 0)).toHaveLength(1)
    expect(trail(frames, 11, 1)).toEqual([
      { date: '2026-02-28T23:59:59Z', adoption: 20, value: 60 },
    ])
  })

  it('lists catalog practices not on the radar at a frame', () => {
    const practices = [
      listItem({ id: 12, name: 'Prompt library' }),
      listItem({ id: 10, name: 'Claude Code' }),
      listItem({ id: 13, name: 'Archived thing', archived_at: '2026-01-01T00:00:00Z' }),
      listItem({ id: 11, name: 'Spec-driven dev' }),
    ]
    expect(offRadar(practices, frames[0]).map((p) => p.id)).toEqual([12, 11])
    expect(offRadar(practices, undefined).map((p) => p.name)).toEqual([
      'Claude Code',
      'Prompt library',
      'Spec-driven dev',
    ])
  })

  it('formats frame dates in UTC', () => {
    expect(formatFrameDate('2026-03-31T23:59:59Z', 'month')).toBe('Mar 2026')
    expect(formatFrameDate('2026-03-15T23:59:59Z', 'week')).toBe('w/e 15 Mar 2026')
  })

  it('nudges with arrow keys', () => {
    const p = { adoption: 50, value: 50 }
    expect(nudge(p, 'ArrowRight')).toEqual({ adoption: 52, value: 50 })
    expect(nudge(p, 'ArrowUp')).toEqual({ adoption: 50, value: 52 })
    expect(nudge(p, 'ArrowLeft', true)).toEqual({ adoption: 40, value: 50 })
    expect(nudge({ adoption: 99, value: 1 }, 'ArrowRight', true)).toEqual({ adoption: 100, value: 1 })
    expect(nudge(p, 'Enter')).toBeNull()
  })
})
