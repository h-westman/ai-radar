import { useState } from 'react'
import { Link } from 'react-router'
import { usePractices } from '../api/hooks'
import { CATEGORIES, type Category } from '../api/types'
import CategoryChip from '../components/CategoryChip'
import { toRef } from '../lib/refs'
import { useDebounced } from '../lib/useDebounced'
import NewPracticeForm from './NewPracticeForm'
import styles from './Pages.module.css'

export default function CatalogPage() {
  const [q, setQ] = useState('')
  const [category, setCategory] = useState<Category | ''>('')
  const [tag, setTag] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const { data: practices = [], isLoading } = usePractices({
    q: useDebounced(q),
    category: category || undefined,
    tag: tag || undefined,
    includeArchived,
  })

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <h1>Catalog</h1>
        {!creating && (
          <button className="primary" onClick={() => setCreating(true)}>
            + New practice
          </button>
        )}
      </div>
      {creating && <NewPracticeForm onCancel={() => setCreating(false)} />}
      <div className={styles.filters}>
        <input type="search" aria-label="Search practices" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value as Category | '')}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c[0].toUpperCase() + c.slice(1)}
            </option>
          ))}
        </select>
        {tag && <button onClick={() => setTag('')}>Tag: {tag} ✕</button>}
        <label>
          <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} /> Show
          archived
        </label>
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Category</th>
            <th>Tags</th>
            <th>Teams</th>
          </tr>
        </thead>
        <tbody>
          {practices.map((p) => (
            <tr key={p.id}>
              <td>
                <Link to={`/practices/${toRef(p.id, p.slug)}`}>{p.name}</Link>
                {p.archived_at && <span className={styles.badge}>Archived</span>}
                <div className={styles.muted}>{p.summary}</div>
              </td>
              <td>
                <CategoryChip category={p.category} />
              </td>
              <td>
                {p.tags.map((t) => (
                  <button key={t} className={styles.tag} onClick={() => setTag(t)}>
                    {t}
                  </button>
                ))}
              </td>
              <td aria-label={`${p.teams_count} teams`}>{p.teams_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!isLoading && practices.length === 0 && <p className={styles.muted}>No practices match.</p>}
    </div>
  )
}
