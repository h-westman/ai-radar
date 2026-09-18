import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { conflictCurrent, isConflict, validationMessage } from '../api/client'
import { useCreateRadar, useRadars, useSetRadarArchived, useUpdateRadar } from '../api/hooks'
import type { Radar } from '../api/types'
import { useNamePrompt } from '../components/NamePrompt'
import { useToast } from '../components/Toasts'
import styles from './Pages.module.css'

export default function RadarListPage() {
  const [showArchived, setShowArchived] = useState(false)
  const { data: radars = [] } = useRadars(showArchived)
  const createRadar = useCreateRadar()
  const setArchived = useSetRadarArchived()
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
      await createRadar.mutateAsync({ name, description: description.trim() || null })
      setName('')
      setDescription('')
      setError(null)
    } catch (err) {
      if (!isConflict(err)) {
        const message = validationMessage(err)
        return toast({
          message: message ? `Could not save: ${message}` : 'Could not create the radar.',
          tone: 'error',
        })
      }
      const existing = conflictCurrent<Radar>(err)
      setError(
        existing?.archived_at
          ? `A radar named "${existing.name}" already exists but is archived. Show archived radars to restore it.`
          : `A radar named "${existing?.name ?? name}" already exists.`,
      )
    }
  }

  async function toggleArchived(r: Radar) {
    await ensureName()
    try {
      await setArchived.mutateAsync({ id: r.id, archived: r.archived_at === null })
    } catch (err) {
      toast({ message: 'Could not update the radar.', tone: 'error' })
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <h1>Radars</h1>
        <label>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show
          archived
        </label>
      </div>

      <form className={styles.card} onSubmit={onCreate} aria-label="New radar">
        <label>
          Radar name
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
          <button type="submit" className="primary" disabled={!name.trim() || createRadar.isPending}>
            Create radar
          </button>
        </div>
      </form>

      <ul aria-label="Radars" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {radars.map((r) =>
          editingId === r.id ? (
            <RadarEditor key={r.id} radar={r} onDone={() => setEditingId(null)} />
          ) : (
            <li key={r.id} className={styles.teamRow}>
              <div>
                <Link to={`/radar/${r.id}`}>{r.name}</Link>
                {r.archived_at && <span className={styles.badge}>Archived</span>}
                {r.description && <div className={styles.muted}>{r.description}</div>}
              </div>
              <button aria-label={`Rename ${r.name}`} onClick={() => setEditingId(r.id)}>
                Rename
              </button>
              <button
                aria-label={`${r.archived_at ? 'Restore' : 'Archive'} ${r.name}`}
                onClick={() => toggleArchived(r)}
              >
                {r.archived_at ? 'Restore' : 'Archive'}
              </button>
            </li>
          ),
        )}
      </ul>
    </div>
  )
}

function RadarEditor({ radar, onDone }: { radar: Radar; onDone: () => void }) {
  const updateRadar = useUpdateRadar()
  const queryClient = useQueryClient()
  const { ensureName } = useNamePrompt()
  const toast = useToast()
  const [name, setName] = useState(radar.name)
  const [description, setDescription] = useState(radar.description ?? '')
  const [error, setError] = useState<string | null>(null)

  async function onSave(event: FormEvent) {
    event.preventDefault()
    await ensureName()
    try {
      await updateRadar.mutateAsync({
        id: radar.id,
        body: { version: radar.version, name, description: description.trim() || null },
      })
      onDone()
    } catch (err) {
      if (isConflict(err)) {
        setError('That name is taken, or someone else changed this radar. Reload and try again.')
        // Refresh the list so the row's version updates and a retry can succeed.
        await queryClient.invalidateQueries({ queryKey: ['radars'] })
      } else {
        const message = validationMessage(err)
        toast({ message: message ? `Could not save: ${message}` : 'Could not save the radar.', tone: 'error' })
      }
    }
  }

  return (
    <li className={styles.teamRow}>
      <form onSubmit={onSave} style={{ display: 'flex', gap: 8, flex: 1, flexWrap: 'wrap' }}>
        <input aria-label={`New name for ${radar.name}`} value={name} onChange={(e) => setName(e.target.value)} />
        <input
          aria-label={`Description for ${radar.name}`}
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
