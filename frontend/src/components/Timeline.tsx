import { useEffect, useRef } from 'react'
import type { Step } from '../api/types'
import { formatFrameDate } from '../chart/frames'
import styles from './Panels.module.css'

export const FRAME_MS = 800

type Props = {
  dates: string[]
  index: number
  step: Step
  playing: boolean
  canEdit: boolean
  unlocked: boolean
  onIndexChange: (index: number) => void
  onPlayingChange: (playing: boolean) => void
  onStepChange: (step: Step) => void
  onUnlockedChange: (unlocked: boolean) => void
}

export default function Timeline(props: Props) {
  const { dates, index, step, playing, canEdit, unlocked } = props
  const last = dates.length - 1
  const isLatest = index >= last
  const label = isLatest ? 'Now' : dates[index] ? formatFrameDate(dates[index], step) : ''

  const onIndexChangeRef = useRef(props.onIndexChange)
  const onPlayingChangeRef = useRef(props.onPlayingChange)

  useEffect(() => {
    onIndexChangeRef.current = props.onIndexChange
  }, [props.onIndexChange])

  useEffect(() => {
    onPlayingChangeRef.current = props.onPlayingChange
  }, [props.onPlayingChange])

  useEffect(() => {
    if (!playing) return
    const timer = window.setTimeout(() => {
      if (index < last) onIndexChangeRef.current(index + 1)
      else onPlayingChangeRef.current(false)
    }, FRAME_MS)
    return () => window.clearTimeout(timer)
  }, [playing, index, last])

  function togglePlay() {
    if (playing) return props.onPlayingChange(false)
    if (isLatest) props.onIndexChange(0)
    props.onPlayingChange(true)
  }

  return (
    <div className={styles.timeline}>
      <button onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <input
        type="range"
        aria-label="Timeline"
        aria-valuetext={label}
        min={0}
        max={Math.max(0, last)}
        value={index}
        onChange={(e) => props.onIndexChange(Number(e.target.value))}
      />
      <span className={styles.dateLabel}>{label}</span>
      <select aria-label="Step" value={step} onChange={(e) => props.onStepChange(e.target.value as Step)}>
        <option value="month">Monthly</option>
        <option value="week">Weekly</option>
      </select>
      {canEdit && !isLatest && !unlocked && (
        <button onClick={() => props.onUnlockedChange(true)}>Edit here</button>
      )}
      {canEdit && !isLatest && unlocked && (
        <span className={styles.editBanner}>
          ✎ Editing {label}
          <button onClick={() => props.onUnlockedChange(false)}>Lock</button>
        </span>
      )}
    </div>
  )
}
