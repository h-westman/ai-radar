import type { Frame, Point, PracticeListItem, Step } from '../api/types'
import { clampScore } from './geometry'

export type TrailPoint = { date: string; adoption: number; value: number }

export function pointMap(frame: Frame | undefined): Map<number, Point> {
  return new Map((frame?.points ?? []).map((p) => [p.practice_id, p]))
}

export function trail(frames: Frame[], practiceId: number, uptoIndex: number): TrailPoint[] {
  const result: TrailPoint[] = []
  for (const frame of frames.slice(0, uptoIndex + 1)) {
    const point = frame.points.find((p) => p.practice_id === practiceId)
    if (point) result.push({ date: frame.date, adoption: point.adoption, value: point.value })
  }
  return result
}

export function offRadar(
  practices: PracticeListItem[],
  frame: Frame | undefined,
): PracticeListItem[] {
  const onRadar = pointMap(frame)
  return practices
    .filter((p) => p.archived_at === null && !onRadar.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name))
}

const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const DAY = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

export function formatFrameDate(date: string, step: Step): string {
  const d = new Date(date)
  return step === 'month' ? MONTH.format(d) : `w/e ${DAY.format(d)}`
}

export const NUDGE_STEP = 2

const DIRECTIONS: Record<string, [number, number]> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
}

export function nudge(
  point: { adoption: number; value: number },
  key: string,
  shift = false,
): { adoption: number; value: number } | null {
  const direction = DIRECTIONS[key]
  if (!direction) return null
  const step = NUDGE_STEP * (shift ? 5 : 1)
  return {
    adoption: clampScore(point.adoption + direction[0] * step),
    value: clampScore(point.value + direction[1] * step),
  }
}
