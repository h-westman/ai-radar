import { describe, expect, it } from 'vitest'
import {
  bubbleRadius,
  categoryColor,
  clampScore,
  fromPixel,
  plotBox,
  positionLabel,
  RADAR_RADIUS,
  toPixel,
} from './geometry'

const box = plotBox({ width: 452, height: 252 }) // plot area 400 x 200 at (36, 16)

describe('geometry', () => {
  it('computes the plot box inside margins', () => {
    expect(box).toEqual({ left: 36, top: 16, width: 400, height: 200 })
    expect(plotBox({ width: 10, height: 10 }).width).toBe(0)
  })

  it('maps scores to pixels with value growing upwards', () => {
    expect(toPixel(box, 0, 0)).toEqual({ x: 36, y: 216 })
    expect(toPixel(box, 100, 100)).toEqual({ x: 436, y: 16 })
    expect(toPixel(box, 50, 50)).toEqual({ x: 236, y: 116 })
  })

  it('maps pixels back to rounded scores', () => {
    expect(fromPixel(box, 236, 116)).toEqual({ adoption: 50, value: 50, inside: true })
    expect(fromPixel(box, 137, 66)).toEqual({ adoption: 25, value: 75, inside: true })
  })

  it('flags and clamps points outside the plot', () => {
    expect(fromPixel(box, 10, 116)).toEqual({ adoption: 0, value: 50, inside: false })
    expect(fromPixel(box, 236, 300)).toEqual({ adoption: 50, value: 0, inside: false })
  })

  it('clamps scores', () => {
    expect([clampScore(-3), clampScore(49.6), clampScore(140)]).toEqual([0, 50, 100])
  })

  it('sizes bubbles', () => {
    expect(bubbleRadius(1, 9, 'radar')).toBe(RADAR_RADIUS)
    expect(bubbleRadius(0, 9, 'org')).toBe(8)
    expect(bubbleRadius(9, 9, 'org')).toBe(22)
    expect(bubbleRadius(4, 9, 'org')).toBeGreaterThan(bubbleRadius(1, 9, 'org'))
  })

  it('uses category tokens', () => {
    expect(categoryColor('workflow')).toBe('var(--cat-workflow)')
  })

  it('labels positions like the backend', () => {
    expect(positionLabel(80, 90)).toBe('Core')
    expect(positionLabel(49, 50)).toBe('Hidden gem')
    expect(positionLabel(50, 49)).toBe('Question it')
    expect(positionLabel(0, 0)).toBe('Parked')
  })
})
