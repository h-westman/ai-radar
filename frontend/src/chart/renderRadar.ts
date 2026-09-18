import * as d3 from 'd3'
import type { Category } from '../api/types'
import { nudge } from './frames'
import {
  bubbleRadius,
  categoryColor,
  CORNER_LABELS,
  fromPixel,
  plotBox,
  positionLabel,
  toPixel,
  type PlotBox,
  type Size,
} from './geometry'

export type RadarDot = { radarId: number; radarName: string; adoption: number; value: number }
export type ChartBubble = {
  practiceId: number
  name: string
  category: Category
  adoption: number
  value: number
  radars: number
  radarPositions?: RadarDot[]
}
export type LabelledPoint = { adoption: number; value: number; label: string }
export type ChartState = {
  size: Size
  scope: 'team' | 'org'
  bubbles: ChartBubble[]
  dateLabel: string
  selected: number[]
  trails: Record<number, LabelledPoint[]>
  editable: boolean
  editingPast: boolean
  highlight: string
  duration: number
}
export type ChartCallbacks = {
  onSelect: (id: number | null, additive: boolean) => void
  onMove: (id: number, adoption: number, value: number) => void
  onRemove: (id: number) => void
  onNudge: (id: number, adoption: number, value: number) => void
}
export type Drop = { type: 'move'; adoption: number; value: number } | { type: 'remove' }

export const PRACTICE_MIME = 'application/x-ai-radar-practice'

export function resolveDrop(box: PlotBox, x: number, y: number): Drop {
  const p = fromPixel(box, x, y)
  return p.inside ? { type: 'move', adoption: p.adoption, value: p.value } : { type: 'remove' }
}

export function createRadar(svgEl: SVGSVGElement, callbacks: ChartCallbacks) {
  const svg = d3.select(svgEl).classed('radar', true)
  svg.selectAll('*').remove()
  const background = svg
    .append('rect')
    .attr('class', 'radar-bg')
    .on('click', () => callbacks.onSelect(null, false))
  const frame = svg.append('rect').attr('class', 'radar-frame')
  const midX = svg.append('line').attr('class', 'radar-mid')
  const midY = svg.append('line').attr('class', 'radar-mid')
  const dateText = svg.append('text').attr('class', 'radar-date')
  const corners = svg.append('g').attr('class', 'radar-corners')
  const axes = svg.append('g').attr('class', 'radar-axes')
  const trailLayer = svg.append('g').attr('class', 'radar-trails')
  const spreadLayer = svg.append('g').attr('class', 'radar-spreads')
  const bubbleLayer = svg.append('g').attr('class', 'radar-bubbles')

  let state: ChartState | null = null
  let box: PlotBox = plotBox({ width: 0, height: 0 })
  // Round to whole pixels: toPixel's division can leave float noise (e.g. 55.99999999999999),
  // which would otherwise leak into rendered attribute strings.
  const at = (d: { adoption: number; value: number }) => {
    const p = toPixel(box, d.adoption, d.value)
    return { x: Math.round(p.x), y: Math.round(p.y) }
  }
  const translate = (d: { adoption: number; value: number }) => {
    const p = at(d)
    return `translate(${p.x},${p.y})`
  }
  // Apply attributes through a transition only when animating (duration 0 = synchronous, for tests).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx = (sel: any) =>
    state && state.duration > 0
      ? sel.transition().duration(state.duration).ease(d3.easeCubicInOut)
      : sel

  const drag = d3
    .drag<SVGGElement, ChartBubble>()
    .clickDistance(4)
    .filter(() => state?.editable === true)
    .subject((_event, d) => at(d))
    .on('drag', function (event) {
      d3.select(this)
        .attr('transform', `translate(${event.x},${event.y})`)
        .classed('is-outside', !fromPixel(box, event.x, event.y).inside)
    })
    .on('end', function (event, d) {
      d3.select(this).classed('is-outside', false)
      if (Math.hypot(event.x - event.subject.x, event.y - event.subject.y) < 4) return
      const drop = resolveDrop(box, event.x, event.y)
      if (drop.type === 'remove') callbacks.onRemove(d.practiceId)
      else callbacks.onMove(d.practiceId, drop.adoption, drop.value)
    })

  function renderStatic(next: ChartState) {
    const { width, height } = next.size
    svg
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`)
      .classed('editing-past', next.editingPast)
    background.attr('width', width).attr('height', height)
    frame.attr('x', box.left).attr('y', box.top).attr('width', box.width).attr('height', box.height)
    const cx = box.left + box.width / 2
    const cy = box.top + box.height / 2
    midX.attr('x1', cx).attr('x2', cx).attr('y1', box.top).attr('y2', box.top + box.height)
    midY.attr('x1', box.left).attr('x2', box.left + box.width).attr('y1', cy).attr('y2', cy)
    dateText.attr('x', cx).attr('y', cy).text(next.dateLabel)

    const pad = 8
    const cornerData = [
      { text: CORNER_LABELS.topLeft, x: box.left + pad, y: box.top + 16, anchor: 'start' },
      { text: CORNER_LABELS.topRight, x: box.left + box.width - pad, y: box.top + 16, anchor: 'end' },
      { text: CORNER_LABELS.bottomRight, x: box.left + box.width - pad, y: box.top + box.height - pad, anchor: 'end' },
      { text: CORNER_LABELS.bottomLeft, x: box.left + pad, y: box.top + box.height - pad, anchor: 'start' },
    ]
    corners
      .selectAll('text')
      .data(cornerData)
      .join('text')
      .attr('x', (d) => d.x)
      .attr('y', (d) => d.y)
      .attr('text-anchor', (d) => d.anchor)
      .text((d) => d.text)

    axes
      .selectAll('text')
      .data([
        { text: 'Adoption / usage →', x: cx, y: box.top + box.height + 24, rotate: 0 },
        { text: 'Perceived value →', x: box.left - 14, y: cy, rotate: -90 },
      ])
      .join('text')
      .attr('text-anchor', 'middle')
      .attr('transform', (d) => `translate(${d.x},${d.y}) rotate(${d.rotate})`)
      .text((d) => d.text)
  }

  function renderTrails(next: ChartState) {
    const categoryOf = new Map(next.bubbles.map((b) => [b.practiceId, b.category]))
    const data = next.selected
      .filter((id) => (next.trails[id]?.length ?? 0) > 1 && categoryOf.has(id))
      .map((id) => ({ id, points: next.trails[id], category: categoryOf.get(id)! }))
    const line = d3.line<LabelledPoint>((p) => at(p).x, (p) => at(p).y)
    trailLayer
      .selectAll<SVGGElement, (typeof data)[number]>('g.radar-trail')
      .data(data, (d) => String(d.id))
      .join('g')
      .attr('class', 'radar-trail')
      .each(function (d) {
        const g = d3.select(this)
        g.selectAll('path')
          .data([d])
          .join('path')
          .attr('d', line(d.points))
          .style('stroke', categoryColor(d.category))
        const history = d.points.slice(0, -1)
        g.selectAll('circle')
          .data(history)
          .join('circle')
          .attr('r', 3)
          .attr('cx', (p) => at(p).x)
          .attr('cy', (p) => at(p).y)
        g.selectAll('text')
          .data(history)
          .join('text')
          .attr('x', (p) => at(p).x)
          .attr('y', (p) => at(p).y - 7)
          .text((p) => p.label)
      })
  }

  function renderSpread(next: ChartState, selected: Set<number>) {
    const data =
      next.scope === 'org'
        ? next.bubbles.filter((b) => selected.has(b.practiceId) && b.radarPositions?.length)
        : []
    spreadLayer
      .selectAll<SVGGElement, ChartBubble>('g.radar-spread')
      .data(data, (d) => String(d.practiceId))
      .join('g')
      .attr('class', 'radar-spread')
      .each(function (b) {
        const g = d3.select(this)
        const center = at(b)
        const dots = b.radarPositions ?? []
        g.selectAll('line')
          .data(dots)
          .join('line')
          .attr('x1', center.x)
          .attr('y1', center.y)
          .attr('x2', (t) => at(t).x)
          .attr('y2', (t) => at(t).y)
        g.selectAll('circle')
          .data(dots)
          .join('circle')
          .attr('r', 4)
          .attr('cx', (t) => at(t).x)
          .attr('cy', (t) => at(t).y)
        g.selectAll('text')
          .data(dots)
          .join('text')
          .attr('x', (t) => at(t).x + 6)
          .attr('y', (t) => at(t).y + 3)
          .text((t) => t.radarName)
      })
    return data.length > 0
  }

  function renderBubbles(next: ChartState, selected: Set<number>, spreading: boolean) {
    const maxRadars = d3.max(next.bubbles, (b) => b.radars) ?? 1
    const radius = (d: ChartBubble) => bubbleRadius(d.radars, maxRadars, next.scope)
    const query = next.highlight.trim().toLowerCase()

    const join = bubbleLayer
      .selectAll<SVGGElement, ChartBubble>('g.radar-bubble')
      .data(next.bubbles, (d) => String(d.practiceId))

    const entered = join
      .enter()
      .append('g')
      .attr('class', 'radar-bubble')
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('transform', translate)
      .style('opacity', next.duration > 0 ? 0 : 1)
    entered.append('circle')
    entered.append('text').attr('class', 'radar-label')
    entered
      .on('click', (event: MouseEvent, d) => {
        event.stopPropagation()
        callbacks.onSelect(d.practiceId, event.shiftKey)
      })
      .on('keydown', (event: KeyboardEvent, d) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          callbacks.onSelect(d.practiceId, event.shiftKey)
          return
        }
        if (!state?.editable) return
        const moved = nudge(d, event.key, event.shiftKey)
        if (moved) {
          event.preventDefault()
          callbacks.onNudge(d.practiceId, moved.adoption, moved.value)
        }
      })
      .call(drag)

    const merged = entered.merge(join)
    merged
      .attr('aria-label', (d) => `${d.name}, ${positionLabel(d.adoption, d.value)}`)
      .classed('is-selected', (d) => selected.has(d.practiceId))
      .classed(
        'is-dim',
        (d) =>
          (query !== '' && !d.name.toLowerCase().includes(query)) ||
          (spreading && !selected.has(d.practiceId)),
      )
    merged
      .select<SVGCircleElement>('circle')
      .attr('r', radius)
      .style('fill', (d) => categoryColor(d.category))
    merged
      .select<SVGTextElement>('text')
      .attr('y', (d) => radius(d) + 12)
      .text((d) => d.name)
    tx(merged).attr('transform', translate).style('opacity', 1)

    const exit = join.exit()
    if (next.duration > 0) exit.transition().duration(next.duration).style('opacity', 0).remove()
    else exit.remove()
  }

  return {
    update(next: ChartState) {
      state = next
      box = plotBox(next.size)
      const selected = new Set(next.selected)
      renderStatic(next)
      renderTrails(next)
      const spreading = renderSpread(next, selected)
      renderBubbles(next, selected, spreading)
    },
    destroy() {
      svg.selectAll('*').interrupt().remove()
    },
  }
}
