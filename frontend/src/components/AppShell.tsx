import { Link, NavLink, Outlet, useMatch, useNavigate } from 'react-router'
import { useRadars } from '../api/hooks'
import { getEditedBy } from '../lib/editedBy'
import { parseId } from '../lib/ids'
import { writeString } from '../lib/storage'
import styles from './AppShell.module.css'
import { useNamePrompt } from './NamePrompt'

export const LAST_RADAR_KEY = 'aiRadar.lastRadar'

export default function AppShell() {
  const navigate = useNavigate()
  const radarMatch = useMatch('/radar/:radarId')
  const orgMatch = useMatch('/radar/org')
  const { data: radars = [] } = useRadars()
  const { changeName } = useNamePrompt()
  const name = getEditedBy()

  const radarId = radarMatch ? parseId(radarMatch.params.radarId) : null
  const current = radarId !== null ? String(radarId) : orgMatch ? 'org' : ''

  function onScopeChange(value: string) {
    if (value === 'org') {
      navigate('/radar/org')
    } else {
      writeString(LAST_RADAR_KEY, value)
      navigate(`/radar/${value}`)
    }
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>
          AI Radar
        </Link>
        <label className={styles.scope}>
          <span className="visually-hidden">Radar</span>
          <select aria-label="Radar" value={current} onChange={(e) => onScopeChange(e.target.value)}>
            {current === '' && <option value="">Choose a radar…</option>}
            <option value="org">Whole organization</option>
            {radars.map((r) => (
              <option key={r.id} value={String(r.id)}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <nav className={styles.nav}>
          <NavLink to="/practices">Catalog</NavLink>
          <NavLink to="/radars">Radars</NavLink>
        </nav>
        <button className={styles.nameChip} onClick={changeName} title="Change your name">
          ✎ {name ? name : 'anonymous'}
        </button>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}
