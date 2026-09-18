import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useFrames, usePlace, usePractices, useRadars } from '../api/hooks'
import { CATEGORIES, type Category, type PlacementCreate, type Point, type Step } from '../api/types'
import { formatFrameDate, offRadar, trail } from '../chart/frames'
import { positionLabel } from '../chart/geometry'
import RadarChart from '../chart/RadarChart'
import type { ChartBubble } from '../chart/renderRadar'
import { LAST_RADAR_KEY } from '../components/AppShell'
import Drawer from '../components/Drawer'
import { useNamePrompt } from '../components/NamePrompt'
import Timeline, { FRAME_MS } from '../components/Timeline'
import { useToast } from '../components/Toasts'
import Tray from '../components/Tray'
import { categoryLabel } from '../lib/categories'
import { parseId } from '../lib/ids'
import { writeString } from '../lib/storage'
import styles from './RadarPage.module.css'

type Position = { adoption: number; value: number }
type Override = Position | 'removed'

const CENTER: Position = { adoption: 50, value: 50 }
const NUDGE_SAVE_MS = 600

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export default function RadarPage() {
  const { radarId: radarRef } = useParams()
  const radarId = parseId(radarRef)
  const scope = radarId === null ? 'org' : 'radar'
  const scopeKey = radarId === null ? 'org' : `radar:${radarId}`

  const [step, setStep] = useState<Step>('month')
  const { data: framesData, isLoading } = useFrames(scopeKey, step)
  const { data: radars = [] } = useRadars(true)
  const { data: practices = [] } = usePractices()
  const place = usePlace()
  const toast = useToast()
  const { ensureName } = useNamePrompt()

  const [index, setIndex] = useState<number | null>(null) // null = follow the latest frame
  const [playing, setPlaying] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const [category, setCategory] = useState<Category | ''>('')
  const [search, setSearch] = useState('')
  const [overrides, setOverrides] = useState<Map<number, Override>>(new Map())
  const nudgeTimers = useRef(new Map<number, number>())

  const frames = useMemo(() => framesData?.frames ?? [], [framesData])
  const lastIndex = Math.max(0, frames.length - 1)
  const currentIndex = Math.min(index ?? lastIndex, lastIndex)
  const isLatest = currentIndex === lastIndex
  const frame = frames[currentIndex]
  const radar = radars.find((r) => r.id === radarId)
  const radarWritable = scope === 'radar' && !!radar && radar.archived_at === null
  const editable = radarWritable && !playing && (isLatest || unlocked)
  const editingPast = radarWritable && unlocked && !isLatest

  useEffect(() => {
    setIndex(null)
    setSelected([])
    setUnlocked(false)
    setPlaying(false)
    setOverrides(new Map())
  }, [scopeKey])
  useEffect(() => {
    if (isLatest) setUnlocked(false)
  }, [isLatest])
  useEffect(() => {
    if (radarId !== null) writeString(LAST_RADAR_KEY, String(radarId))
  }, [radarId])
  useEffect(() => {
    const timers = nudgeTimers.current
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [])

  const radarName = useMemo(() => new Map(radars.map((r) => [r.id, r.name])), [radars])
  const practiceById = useMemo(() => new Map(practices.map((p) => [p.id, p])), [practices])
  const nameOf = (id: number) =>
    framesData?.practices[String(id)]?.name ?? practiceById.get(id)?.name ?? 'Unknown practice'
  const categoryOf = (id: number): Category =>
    framesData?.practices[String(id)]?.category ?? practiceById.get(id)?.category ?? 'tool'

  // Frame points with optimistic overrides applied (unfiltered).
  const points: Point[] = useMemo(() => {
    const byId = new Map((frame?.points ?? []).map((p) => [p.practice_id, p]))
    for (const [id, override] of overrides) {
      if (override === 'removed') byId.delete(id)
      else byId.set(id, { ...(byId.get(id) ?? { practice_id: id, radars: 1 }), ...override })
    }
    return [...byId.values()]
  }, [frame, overrides])

  const bubbles: ChartBubble[] = useMemo(
    () =>
      points
        .filter((p) => !category || categoryOf(p.practice_id) === category)
        .map((p) => ({
          practiceId: p.practice_id,
          name: nameOf(p.practice_id),
          category: categoryOf(p.practice_id),
          adoption: p.adoption,
          value: p.value,
          radars: p.radars,
          radarPositions: p.radar_positions?.map((r) => ({
            radarId: r.radar_id,
            radarName: radarName.get(r.radar_id) ?? `Radar ${r.radar_id}`,
            adoption: r.adoption,
            value: r.value,
          })),
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, category, framesData, practiceById, radarName],
  )

  const trails = useMemo(
    () =>
      Object.fromEntries(
        selected.map((id) => [
          id,
          trail(frames, id, currentIndex).map((p) => ({
            adoption: p.adoption,
            value: p.value,
            label: formatFrameDate(p.date, step),
          })),
        ]),
      ),
    [selected, frames, currentIndex, step],
  )

  const trayPractices = useMemo(
    () => offRadar(practices, { date: frame?.date ?? '', points }),
    [practices, frame, points],
  )

  async function save(practiceId: number, next: Override, previous?: Position) {
    if (radarId === null) return
    await ensureName()
    setOverrides((m) => new Map(m).set(practiceId, next))
    const effective_at = editingPast && frame ? frame.date : undefined
    const body: PlacementCreate =
      next === 'removed'
        ? { radar_id: radarId, practice_id: practiceId, removed: true, effective_at }
        : { radar_id: radarId, practice_id: practiceId, ...next, effective_at }
    try {
      await place.mutateAsync(body)
      if (next === 'removed') {
        setSelected((s) => s.filter((id) => id !== practiceId))
        toast({
          message: `Removed ${nameOf(practiceId)}`,
          action: previous ? { label: 'Undo', onClick: () => void save(practiceId, previous) } : undefined,
        })
      }
    } catch {
      toast({ message: 'Could not save that change. The bubble was moved back.', tone: 'error' })
    } finally {
      setOverrides((m) => {
        const copy = new Map(m)
        copy.delete(practiceId)
        return copy
      })
    }
  }

  function removeWithUndo(practiceId: number) {
    const p = points.find((x) => x.practice_id === practiceId)
    void save(practiceId, 'removed', p && { adoption: p.adoption, value: p.value })
  }

  function onNudge(id: number, adoption: number, value: number) {
    setOverrides((m) => new Map(m).set(id, { adoption, value }))
    window.clearTimeout(nudgeTimers.current.get(id))
    nudgeTimers.current.set(id, window.setTimeout(() => void save(id, { adoption, value }), NUDGE_SAVE_MS))
  }

  function onSelect(id: number | null, additive: boolean) {
    if (id === null) return setSelected([])
    setSelected((s) => (additive ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : [id]))
  }

  if (radarId !== null && radars.length > 0 && !radar) {
    return (
      <div className={styles.message}>
        This radar doesn’t exist. <Link to="/radars">See all radars</Link>
      </div>
    )
  }

  const title = scope === 'org' ? 'Whole organization' : (radar?.name ?? '')
  const focusId = selected[selected.length - 1]
  const focus = points.find((p) => p.practice_id === focusId)
  const focusListItem = focus ? practiceById.get(focus.practice_id) : undefined

  return (
    <div className={styles.layout}>
      {scope === 'radar' && (
        <Tray practices={trayPractices} editable={editable} onPlace={(id) => void save(id, CENTER)} />
      )}
      <section className={styles.center} aria-label={`${title} radar`}>
        <div className={styles.toolbar}>
          <h1>{title}</h1>
          {radar?.archived_at && <span className={styles.archived}>Archived: read-only</span>}
          <select
            aria-label="Filter by category"
            value={category}
            onChange={(e) => setCategory(e.target.value as Category | '')}
          >
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(c)}
              </option>
            ))}
          </select>
          <input
            type="search"
            aria-label="Highlight practice"
            placeholder="Highlight…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {editingPast && frame && (
          <div className={styles.pastBanner} role="status">
            Editing {formatFrameDate(frame.date, step)}. Changes are recorded for that date.
          </div>
        )}
        <div className={styles.chartArea}>
          <RadarChart
            scope={scope}
            bubbles={bubbles}
            dateLabel={isLatest ? 'Now' : frame ? formatFrameDate(frame.date, step) : ''}
            selected={selected}
            trails={trails}
            editable={editable}
            editingPast={editingPast}
            highlight={search}
            duration={prefersReducedMotion() ? 0 : playing ? FRAME_MS : 400}
            onSelect={onSelect}
            onMove={(id, adoption, value) => void save(id, { adoption, value })}
            onRemove={removeWithUndo}
            onNudge={onNudge}
            onDropPractice={(id, adoption, value) => void save(id, { adoption, value })}
          />
          {!isLoading && points.length === 0 && (
            <p className={styles.empty}>
              {scope === 'radar'
                ? 'Drag practices from the tray onto the chart to start this radar.'
                : 'Nobody has placed anything yet.'}
            </p>
          )}
        </div>
        <Timeline
          dates={frames.map((f) => f.date)}
          index={currentIndex}
          step={step}
          playing={playing}
          canEdit={radarWritable}
          unlocked={unlocked}
          onIndexChange={(i) => setIndex(i >= lastIndex ? null : i)}
          onPlayingChange={setPlaying}
          onStepChange={(s) => {
            setStep(s)
            setIndex(null)
          }}
          onUnlockedChange={setUnlocked}
        />
      </section>
      {focus && (
        <Drawer
          scope={scope}
          practice={{
            id: focus.practice_id,
            name: nameOf(focus.practice_id),
            category: categoryOf(focus.practice_id),
            summary: focusListItem?.summary ?? '',
          }}
          label={positionLabel(focus.adoption, focus.value)}
          radarId={radarId ?? undefined}
          radars={focus.radar_positions?.map((r) => ({
            radarId: r.radar_id,
            radarName: radarName.get(r.radar_id) ?? `Radar ${r.radar_id}`,
            label: positionLabel(r.adoption, r.value),
          }))}
          canRemove={editable}
          onRemove={() => removeWithUndo(focus.practice_id)}
          onClose={() => setSelected([])}
        />
      )}
    </div>
  )
}
