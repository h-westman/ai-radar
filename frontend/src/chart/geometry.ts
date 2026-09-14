import type { Category } from '../api/types'

export type Size = { width: number; height: number }
export type PlotBox = { left: number; top: number; width: number; height: number }

export const MARGIN = { top: 16, right: 16, bottom: 36, left: 36 }

export function plotBox(size: Size): PlotBox {
  return {
    left: MARGIN.left,
    top: MARGIN.top,
    width: Math.max(0, size.width - MARGIN.left - MARGIN.right),
    height: Math.max(0, size.height - MARGIN.top - MARGIN.bottom),
  }
}

export function clampScore(n: number): number {
  return Math.min(100, Math.max(0, Math.round(n)))
}

export function toPixel(box: PlotBox, adoption: number, value: number) {
  return {
    x: box.left + (adoption / 100) * box.width,
    y: box.top + (1 - value / 100) * box.height,
  }
}

export function fromPixel(box: PlotBox, x: number, y: number) {
  const adoption = ((x - box.left) / box.width) * 100
  const value = (1 - (y - box.top) / box.height) * 100
  const inside = adoption >= 0 && adoption <= 100 && value >= 0 && value <= 100
  return { adoption: clampScore(adoption), value: clampScore(value), inside }
}

export const TEAM_RADIUS = 10

export function bubbleRadius(teams: number, maxTeams: number, scope: 'team' | 'org'): number {
  if (scope === 'team') return TEAM_RADIUS
  return 8 + 14 * Math.sqrt(teams / Math.max(1, maxTeams))
}

export const CORNER_LABELS = {
  topLeft: 'Hidden gems',
  topRight: 'Core',
  bottomRight: 'Question it',
  bottomLeft: 'Parked',
} as const

export function categoryColor(category: Category): string {
  return `var(--cat-${category})`
}

export type PositionLabel = 'Core' | 'Hidden gem' | 'Question it' | 'Parked'

export function positionLabel(adoption: number, value: number): PositionLabel {
  const highAdoption = adoption >= 50
  if (value >= 50) return highAdoption ? 'Core' : 'Hidden gem'
  return highAdoption ? 'Question it' : 'Parked'
}
