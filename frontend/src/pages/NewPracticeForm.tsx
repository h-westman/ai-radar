import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { conflictCurrent, isConflict, validationMessage } from '../api/client'
import { useCreatePractice, useSetPracticeArchived, useSimilar } from '../api/hooks'
import { type Category, type Practice } from '../api/types'
import CategoryRadios from '../components/CategoryRadios'
import { useNamePrompt } from '../components/NamePrompt'
import { useToast } from '../components/Toasts'
import { useDebounced } from '../lib/useDebounced'
import styles from './Pages.module.css'

export default function NewPracticeForm({ onCancel }: { onCancel: () => void }) {
  const navigate = useNavigate()
  const { ensureName } = useNamePrompt()
  const toast = useToast()
  const [name, setName] = useState('')
  const [category, setCategory] = useState<Category>('tool')
  const [summary, setSummary] = useState('')
  const [conflict, setConflict] = useState<Practice | null>(null)
  const { data: similar = [] } = useSimilar(useDebounced(name))
  const create = useCreatePractice()
  const setArchived = useSetPracticeArchived()

  const open = (p: { id: number }) => navigate(`/practices/${p.id}`)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    await ensureName()
    try {
      open(await create.mutateAsync({ name, category, summary }))
    } catch (err) {
      if (isConflict(err)) {
        setConflict(conflictCurrent<Practice>(err))
      } else {
        const message = validationMessage(err)
        toast({ message: message ? `Could not save: ${message}` : 'Could not create the practice.', tone: 'error' })
      }
    }
  }

  async function restore() {
    if (!conflict) return
    await ensureName()
    try {
      open(await setArchived.mutateAsync({ id: conflict.id, archived: false }))
    } catch (err) {
      toast({ message: 'Could not restore the practice.', tone: 'error' })
    }
  }

  return (
    <form className={styles.card} onSubmit={onSubmit} aria-label="New practice">
      <label>
        Name
        <input
          value={name}
          maxLength={100}
          autoFocus
          onChange={(e) => {
            setName(e.target.value)
            setConflict(null)
          }}
        />
      </label>
      {similar.length > 0 && !conflict && (
        <div className={styles.similar} aria-live="polite">
          <span>Did you mean…</span>
          <ul>
            {similar.map((p) => (
              <li key={p.id}>
                <Link to={`/practices/${p.id}`}>{p.name}</Link>
                {p.archived_at && <span className={styles.badge}>Archived</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <CategoryRadios value={category} onChange={setCategory} />
      <label>
        Summary
        <input value={summary} maxLength={280} onChange={(e) => setSummary(e.target.value)} />
      </label>
      {conflict && (
        <p role="alert" className={styles.error}>
          "{conflict.name}" already exists{conflict.archived_at ? ' but is archived' : ''}.{' '}
          {conflict.archived_at ? (
            <button type="button" onClick={restore}>
              Restore it
            </button>
          ) : (
            <Link to={`/practices/${conflict.id}`}>Open it</Link>
          )}
        </p>
      )}
      <div className={styles.actions}>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={!name.trim() || create.isPending}>
          Create practice
        </button>
      </div>
    </form>
  )
}
