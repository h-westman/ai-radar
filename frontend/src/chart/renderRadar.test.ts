import { describe, expect, it, vi } from 'vitest'
import { plotBox } from './geometry'
import { createRadar, resolveDrop, type ChartBubble, type ChartState } from './renderRadar'

const bubble = (
  practiceId: number,
  name: string,
  category: ChartBubble['category'],
  adoption: number,
  value: number,
  extra: Partial<ChartBubble> = {},
): ChartBubble => ({ practiceId, name, category, adoption, value, teams: 1, ...extra })

function setup(overrides: Partial<ChartState> = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  document.body.appendChild(svg)
  const callbacks = { onSelect: vi.fn(), onMove: vi.fn(), onRemove: vi.fn(), onNudge: vi.fn() }
  const radar = createRadar(svg, callbacks)
  const state: ChartState = {
    size: { width: 452, height: 252 },
    scope: 'team',
    bubbles: [bubble(10, 'Claude Code', 'tool', 70, 80), bubble(11, 'Spec-driven dev', 'practice', 20, 60)],
    dateLabel: 'Feb 2026',
    selected: [],
    trails: {},
    editable: true,
    editingPast: false,
    highlight: '',
    duration: 0,
    ...overrides,
  }
  radar.update(state)
  const bubbleEl = (id: number) =>
    [...svg.querySelectorAll<SVGGElement>('g.radar-bubble')].find((g) =>
      g.getAttribute('aria-label')?.startsWith(id === 10 ? 'Claude Code' : 'Spec-driven dev'),
    )!
  return { svg, callbacks, radar, state, bubbleEl }
}

describe('renderRadar', () => {
  it('renders bubbles with names, positions and accessible labels', () => {
    const { svg, bubbleEl } = setup()
    expect(svg.querySelectorAll('g.radar-bubble')).toHaveLength(2)
    expect(bubbleEl(10).getAttribute('aria-label')).toBe('Claude Code, Core')
    expect(bubbleEl(11).getAttribute('aria-label')).toBe('Spec-driven dev, Hidden gem')
    expect(bubbleEl(10).getAttribute('transform')).toBe('translate(316,56)')
    expect(svg.querySelector('.radar-date')?.textContent).toBe('Feb 2026')
    expect(svg.textContent).toContain('Hidden gems')
    expect(svg.textContent).toContain('Perceived value →')
  })

  it('removes bubbles that leave the frame', () => {
    const { svg, radar, state } = setup()
    radar.update({ ...state, bubbles: [state.bubbles[0]] })
    expect(svg.querySelectorAll('g.radar-bubble')).toHaveLength(1)
  })

  it('marks selection and draws a labelled trail', () => {
    const { svg, bubbleEl } = setup({
      selected: [10],
      trails: {
        10: [
          { adoption: 60, value: 70, label: 'Jan 2026' },
          { adoption: 70, value: 80, label: 'Feb 2026' },
        ],
      },
    })
    expect(bubbleEl(10).classList.contains('is-selected')).toBe(true)
    expect(svg.querySelector('.radar-trail path')).not.toBeNull()
    expect(svg.querySelector('.radar-trail')?.textContent).toContain('Jan 2026')
  })

  it('selects on click, adds with shift, clears on background', () => {
    const { svg, callbacks, bubbleEl } = setup()
    bubbleEl(10).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    bubbleEl(11).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
    svg.querySelector('.radar-bg')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(callbacks.onSelect.mock.calls).toEqual([
      [10, false],
      [11, true],
      [null, false],
    ])
  })

  it('nudges with arrow keys only when editable', () => {
    const { callbacks, bubbleEl, radar, state } = setup()
    bubbleEl(10).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(callbacks.onNudge).toHaveBeenCalledWith(10, 72, 80)
    radar.update({ ...state, editable: false })
    bubbleEl(10).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(callbacks.onNudge).toHaveBeenCalledTimes(1)
  })

  it('fans out team positions for a selected org bubble and dims the rest', () => {
    const { svg, bubbleEl } = setup({
      scope: 'org',
      editable: false,
      selected: [10],
      bubbles: [
        bubble(10, 'Claude Code', 'tool', 60, 80, {
          teams: 2,
          teamPositions: [
            { teamId: 1, teamName: 'Platform', adoption: 80, value: 90 },
            { teamId: 2, teamName: 'Payments', adoption: 40, value: 70 },
          ],
        }),
        bubble(11, 'Spec-driven dev', 'practice', 20, 60),
      ],
    })
    expect(svg.querySelectorAll('.radar-spread circle')).toHaveLength(2)
    expect(svg.querySelector('.radar-spread')?.textContent).toContain('Payments')
    expect(bubbleEl(11).classList.contains('is-dim')).toBe(true)
  })

  it('reflects editing-past and search highlight', () => {
    const { svg, bubbleEl } = setup({ editingPast: true, highlight: 'spec' })
    expect(svg.classList.contains('editing-past')).toBe(true)
    expect(bubbleEl(10).classList.contains('is-dim')).toBe(true)
    expect(bubbleEl(11).classList.contains('is-dim')).toBe(false)
  })

  it('resolves drops inside and outside the plot', () => {
    const box = plotBox({ width: 452, height: 252 })
    expect(resolveDrop(box, 236, 116)).toEqual({ type: 'move', adoption: 50, value: 50 })
    expect(resolveDrop(box, 5, 116)).toEqual({ type: 'remove' })
  })
})
