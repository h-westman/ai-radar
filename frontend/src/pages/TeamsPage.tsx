import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { conflictCurrent, isConflict, validationMessage } from '../api/client'
import { useCreateTeam, useSetTeamArchived, useTeams, useUpdateTeam } from '../api/hooks'
import type { Team } from '../api/types'
import { useNamePrompt } from '../components/NamePrompt'
import { useToast } from '../components/Toasts'
import { toRef } from '../lib/refs'
import styles from './Pages.module.css'

export default function TeamsPage() {
  const [showArchived, setShowArchived] = useState(false)
  const { data: teams = [] } = useTeams(showArchived)
  const createTeam = useCreateTeam()
  const setArchived = useSetTeamArchived()
  const { ensureName } = useNamePrompt()
  const toast = useToast()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)

  async function onCreate(event: FormEvent) {
    event.preventDefault()
    await ensureName()
    try {
      await createTeam.mutateAsync({ name, description: description.trim() || null })
      setName('')
      setDescription('')
      setError(null)
    } catch (err) {
      if (!isConflict(err)) {
        const message = validationMessage(err)
        return toast({
          message: message ? `Could not save: ${message}` : 'Could not create the team.',
          tone: 'error',
        })
      }
      const existing = conflictCurrent<Team>(err)
      setError(
        existing?.archived_at
          ? `A team named "${existing.name}" already exists but is archived. Show archived teams to restore it.`
          : `A team named "${existing?.name ?? name}" already exists.`,
      )
    }
  }

  async function toggleArchived(t: Team) {
    await ensureName()
    try {
      await setArchived.mutateAsync({ id: t.id, archived: t.archived_at === null })
    } catch (err) {
      toast({ message: 'Could not update the team.', tone: 'error' })
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <h1>Teams</h1>
        <label>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show
          archived
        </label>
      </div>

      <form className={styles.card} onSubmit={onCreate} aria-label="New team">
        <label>
          Team name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
        </label>
        <label>
          Description
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        </label>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <button type="submit" className="primary" disabled={!name.trim() || createTeam.isPending}>
            Create team
          </button>
        </div>
      </form>

      <ul aria-label="Teams" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {teams.map((t) =>
          editingId === t.id ? (
            <TeamEditor key={t.id} team={t} onDone={() => setEditingId(null)} />
          ) : (
            <li key={t.id} className={styles.teamRow}>
              <div>
                <Link to={`/radar/team/${toRef(t.id, t.slug)}`}>{t.name}</Link>
                {t.archived_at && <span className={styles.badge}>Archived</span>}
                {t.description && <div className={styles.muted}>{t.description}</div>}
              </div>
              <button aria-label={`Rename ${t.name}`} onClick={() => setEditingId(t.id)}>
                Rename
              </button>
              <button
                aria-label={`${t.archived_at ? 'Restore' : 'Archive'} ${t.name}`}
                onClick={() => toggleArchived(t)}
              >
                {t.archived_at ? 'Restore' : 'Archive'}
              </button>
            </li>
          ),
        )}
      </ul>
    </div>
  )
}

function TeamEditor({ team, onDone }: { team: Team; onDone: () => void }) {
  const updateTeam = useUpdateTeam()
  const queryClient = useQueryClient()
  const { ensureName } = useNamePrompt()
  const toast = useToast()
  const [name, setName] = useState(team.name)
  const [description, setDescription] = useState(team.description ?? '')
  const [error, setError] = useState<string | null>(null)

  async function onSave(event: FormEvent) {
    event.preventDefault()
    await ensureName()
    try {
      await updateTeam.mutateAsync({
        id: team.id,
        body: { version: team.version, name, description: description.trim() || null },
      })
      onDone()
    } catch (err) {
      if (isConflict(err)) {
        setError('That name is taken, or someone else changed this team. Reload and try again.')
        // Refresh the list so the row's version updates and a retry can succeed.
        await queryClient.invalidateQueries({ queryKey: ['teams'] })
      } else {
        const message = validationMessage(err)
        toast({ message: message ? `Could not save: ${message}` : 'Could not save the team.', tone: 'error' })
      }
    }
  }

  return (
    <li className={styles.teamRow}>
      <form onSubmit={onSave} style={{ display: 'flex', gap: 8, flex: 1, flexWrap: 'wrap' }}>
        <input aria-label={`New name for ${team.name}`} value={name} onChange={(e) => setName(e.target.value)} />
        <input
          aria-label={`Description for ${team.name}`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        {error && (
          <span role="alert" className={styles.error}>
            {error}
          </span>
        )}
        <button type="button" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={!name.trim()}>
          Save
        </button>
      </form>
    </li>
  )
}
