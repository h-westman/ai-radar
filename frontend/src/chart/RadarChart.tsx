import { useEffect, useRef, type DragEvent } from 'react'
import { useElementSize } from '../lib/useElementSize'
import { fromPixel, plotBox } from './geometry'
import './radar.css'
import {
  createRadar,
  PRACTICE_MIME,
  type ChartCallbacks,
  type ChartState,
} from './renderRadar'

type Props = Omit<ChartState, 'size'> &
  ChartCallbacks & {
    onDropPractice?: (practiceId: number, adoption: number, value: number) => void
  }

export default function RadarChart(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const radarRef = useRef<ReturnType<typeof createRadar> | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const size = useElementSize(containerRef)

  useEffect(() => {
    const radar = createRadar(svgRef.current!, {
      onSelect: (...args) => propsRef.current.onSelect(...args),
      onMove: (...args) => propsRef.current.onMove(...args),
      onRemove: (...args) => propsRef.current.onRemove(...args),
      onNudge: (...args) => propsRef.current.onNudge(...args),
    })
    radarRef.current = radar
    return () => radar.destroy()
  }, [])

  const { scope, bubbles, dateLabel, selected, trails, editable, editingPast, highlight, duration } =
    props
  useEffect(() => {
    radarRef.current?.update({
      size,
      scope,
      bubbles,
      dateLabel,
      selected,
      trails,
      editable,
      editingPast,
      highlight,
      duration,
    })
  }, [size, scope, bubbles, dateLabel, selected, trails, editable, editingPast, highlight, duration])

  function onDragOver(event: DragEvent) {
    if (props.editable && Array.from(event.dataTransfer.types).includes(PRACTICE_MIME)) {
      event.preventDefault()
    }
  }

  function onDrop(event: DragEvent) {
    const id = Number(event.dataTransfer.getData(PRACTICE_MIME))
    if (!id || !props.onDropPractice) return
    event.preventDefault()
    const rect = svgRef.current!.getBoundingClientRect()
    const point = fromPixel(plotBox(size), event.clientX - rect.left, event.clientY - rect.top)
    if (point.inside) props.onDropPractice(id, point.adoption, point.value)
  }

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', flex: 1, minHeight: 360 }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <svg ref={svgRef} role="group" aria-label="Radar chart" />
    </div>
  )
}
