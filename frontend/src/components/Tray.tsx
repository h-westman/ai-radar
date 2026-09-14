import { useState } from 'react'
import { Link } from 'react-router'
import type { PracticeListItem } from '../api/types'
import { categoryColor } from '../chart/geometry'
import { PRACTICE_MIME } from '../chart/renderRadar'
import styles from './Panels.module.css'

type Props = { practices: PracticeListItem[]; editable: boolean; onPlace: (practiceId: number) => void }

export default function Tray({ practices, editable, onPlace }: Props) {
  const [filter, setFilter] = useState('')
  const q = filter.trim().toLowerCase()
  const visible = practices.filter((p) => p.name.toLowerCase().includes(q))

  return (
    <section className={styles.tray} aria-label="Not on radar">
      <h2>Not on radar</h2>
      <input
        type="search"
        aria-label="Filter practices"
        placeholder="Filter…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {practices.length === 0 && (
        <p className={styles.muted}>
          Everything in the catalog is on this radar. <Link to="/practices">+ New practice</Link>
        </p>
      )}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {visible.map((p) => (
          <li
            key={p.id}
            className={styles.trayItem}
            draggable={editable}
            onDragStart={(e) => {
              e.dataTransfer.setData(PRACTICE_MIME, String(p.id))
              e.dataTransfer.effectAllowed = 'copy'
            }}
          >
            <i className={styles.dot} style={{ background: categoryColor(p.category) }} aria-hidden="true" />
            <span>{p.name}</span>
            <button aria-label={`Place ${p.name}`} disabled={!editable} onClick={() => onPlace(p.id)}>
              +
            </button>
          </li>
        ))}
      </ul>
      {editable && practices.length > 0 && <p className={styles.muted}>Drag onto the chart, or press +.</p>}
    </section>
  )
}
