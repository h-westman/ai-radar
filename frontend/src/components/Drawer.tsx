import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { conflictCurrent, isConflict, validationMessage } from '../api/client'
import { keys, useNote, usePutNote } from '../api/hooks'
import type { Category, Note } from '../api/types'
import type { PositionLabel } from '../chart/geometry'
import Editor from '../editor/Editor'
import MarkdownView from '../editor/MarkdownView'
import { toRef } from '../lib/refs'
import CategoryChip from './CategoryChip'
import { useNamePrompt } from './NamePrompt'
import styles from './Panels.module.css'
import { useToast } from './Toasts'

export type DrawerPractice = { id: number; name: string; slug: string; category: Category; summary: string }

type Props = {
  scope: 'team' | 'org'
  practice: DrawerPractice
  label: PositionLabel
  teamId?: number
  teams?: { teamId: number; teamName: string; label: PositionLabel }[]
  canRemove: boolean
  onRemove: () => void
  onClose: () => void
}

export default function Drawer({ scope, practice, label, teamId, teams, canRemove, onRemove, onClose }: Props) {
  const ref = toRef(practice.id, practice.slug)
  return (
    <aside className={styles.drawer} aria-label={`Details for ${practice.name}`}>
      <div className={styles.drawerHeader}>
        <CategoryChip category={practice.category} />
        <button aria-label="Close details" onClick={onClose}>
          ✕
        </button>
      </div>
      <h2>{practice.name}</h2>
      <p className={styles.muted}>{practice.summary}</p>
      <p>
        Position: <strong>{label}</strong>
      </p>
      {scope === 'team' && teamId !== undefined && (
        <TeamNote key={`${teamId}:${practice.id}`} teamId={teamId} practiceId={practice.id} />
      )}
      {scope === 'org' && (
        <section>
          <h3>Teams using it</h3>
          <ul>
            {(teams ?? []).map((t) => (
              <li key={t.teamId}>
                <span>{t.teamName}</span> · <span>{t.label}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className={styles.actions}>
        <Link to={`/practices/${ref}`}>Open page</Link>
        <Link to={`/practices/${ref}?tab=history`}>History</Link>
        {canRemove && <button onClick={onRemove}>Remove from radar</button>}
      </div>
    </aside>
  )
}

function TeamNote({ teamId, practiceId }: { teamId: number; practiceId: number }) {
  const { data: note, isLoading } = useNote(teamId, practiceId)
  const putNote = usePutNote()
  const queryClient = useQueryClient()
  const { ensureName } = useNamePrompt()
  const toast = useToast()
  const [draft, setDraft] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)

  async function save() {
    if (draft === null) return
    await ensureName()
    try {
      await putNote.mutateAsync({ teamId, practiceId, version: note?.version ?? 0, body_md: draft })
      setDraft(null)
      setConflict(false)
    } catch (error) {
      if (isConflict(error)) {
        queryClient.setQueryData(keys.note(teamId, practiceId), conflictCurrent<Note>(error))
        setConflict(true)
      } else {
        const message = validationMessage(error)
        toast({
          message: message ? `Could not save: ${message}` : 'Could not save the note. Please try again.',
          tone: 'error',
        })
      }
    }
  }

  return (
    <section>
      <h3>How we use it</h3>
      {conflict && (
        <p className={styles.conflict} role="alert">
          Someone else saved this note. Their version is shown below; your draft is kept.
        </p>
      )}
      {isLoading ? (
        <p className={styles.muted}>Loading…</p>
      ) : draft === null || conflict ? (
        note?.body_md ? <MarkdownView source={note.body_md} /> : <p className={styles.muted}>No note yet.</p>
      ) : null}
      {draft === null ? (
        <button onClick={() => setDraft(note?.body_md ?? '')}>Edit note</button>
      ) : (
        <>
          <Editor value={draft} onChange={setDraft} label="How we use it" />
          <div className={styles.actions}>
            <button onClick={() => { setDraft(null); setConflict(false) }}>Cancel</button>
            <button className="primary" onClick={save} disabled={putNote.isPending}>
              Save note
            </button>
          </div>
        </>
      )}
    </section>
  )
}
