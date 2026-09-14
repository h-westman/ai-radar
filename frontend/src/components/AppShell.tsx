import { Link, NavLink, Outlet, useMatch, useNavigate } from 'react-router'
import { useTeams } from '../api/hooks'
import { getEditedBy } from '../lib/editedBy'
import { idFromRef, toRef } from '../lib/refs'
import { writeString } from '../lib/storage'
import styles from './AppShell.module.css'
import { useNamePrompt } from './NamePrompt'

export const LAST_TEAM_KEY = 'aiRadar.lastTeam'

export default function AppShell() {
  const navigate = useNavigate()
  const teamMatch = useMatch('/radar/team/:teamRef')
  const orgMatch = useMatch('/radar/org')
  const { data: teams = [] } = useTeams()
  const { changeName } = useNamePrompt()
  const name = getEditedBy()

  const teamRef = teamMatch?.params.teamRef
  const teamId = teamRef ? idFromRef(teamRef) : null
  const matchedTeam = teamId !== null ? teams.find((t) => t.id === teamId) : undefined
  const current = teamRef
    ? (matchedTeam ? toRef(matchedTeam.id, matchedTeam.slug) : teamRef)
    : orgMatch
      ? 'org'
      : ''

  function onScopeChange(value: string) {
    if (value === 'org') {
      navigate('/radar/org')
    } else {
      writeString(LAST_TEAM_KEY, value)
      navigate(`/radar/team/${value}`)
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
            {teams.map((t) => (
              <option key={t.id} value={toRef(t.id, t.slug)}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <nav className={styles.nav}>
          <NavLink to="/practices">Catalog</NavLink>
          <NavLink to="/teams">Teams</NavLink>
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
