import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useBlocker, useParams, useSearchParams } from 'react-router'
import { conflictCurrent, isConflict, validationMessage } from '../api/client'
import {
  keys,
  usePractice,
  useRevert,
  useRevisions,
  useSetPracticeArchived,
  useUpdatePractice,
} from '../api/hooks'
import {
  CATEGORIES,
  type Category,
  type Link as PracticeLink,
  type Practice,
  type PracticeDetail,
  type PracticeUpdate,
} from '../api/types'
import CategoryChip from '../components/CategoryChip'
import ConfirmDialog from '../components/ConfirmDialog'
import { useNamePrompt } from '../components/NamePrompt'
import { useToast } from '../components/Toasts'
import UnsavedChangesBar from '../components/UnsavedChangesBar'
import Editor from '../editor/Editor'
import MarkdownView from '../editor/MarkdownView'
import { categoryOptionText } from '../lib/categories'
import { parseId } from '../lib/ids'
import styles from './Pages.module.css'

type Field = 'name' | 'category' | 'summary' | 'tags' | 'links' | 'body_md'
type Draft = Partial<Pick<Practice, Field>>

const parseTags = (text: string) => [...new Set(text.split(',').map((t) => t.trim()).filter(Boolean))]
const excerpt = (md: string) =>
  md
    .split('\n')
    .map((line) => line.replace(/^[#>*\-\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(' ')
    .slice(0, 160)

export default function PracticePage() {
  const { practiceId: practiceRef } = useParams()
  const id = parseId(practiceRef)
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'history' ? 'history' : 'overview'
  const { data: practice, isError } = usePractice(id)
  const setArchived = useSetPracticeArchived()
  const { ensureName } = useNamePrompt()
  const toast = useToast()

  if (id === null || isError) {
    return (
      <div className={styles.page}>
        <h1>Practice not found</h1>
        <Link to="/practices">Back to the catalog</Link>
      </div>
    )
  }
  if (!practice) {
    return (
      <div className={styles.page}>
        <p className={styles.muted}>Loading…</p>
      </div>
    )
  }

  async function toggleArchived(p: PracticeDetail) {
    await ensureName()
    try {
      await setArchived.mutateAsync({ id: p.id, archived: p.archived_at === null })
    } catch {
      toast({ message: 'Could not update the practice.', tone: 'error' })
    }
  }

  return (
    <div className={styles.page}>
      {practice.archived_at && (
        <div role="status" className={styles.similar}>
          Archived. This practice is hidden from radars and the catalog.{' '}
          <button onClick={() => toggleArchived(practice)}>Restore practice</button>
        </div>
      )}
      <div className={styles.tablistRow}>
        <div role="tablist" aria-label="Practice sections" className={styles.tablist}>
          <button role="tab" aria-selected={tab === 'overview'} onClick={() => setParams({})}>
            Overview
          </button>
          <button role="tab" aria-selected={tab === 'history'} onClick={() => setParams({ tab: 'history' })}>
            History
          </button>
        </div>
        {!practice.archived_at && (
          <button onClick={() => toggleArchived(practice)}>Archive practice</button>
        )}
      </div>
      {tab === 'overview' ? (
        <Overview key={practice.id} practice={practice} />
      ) : (
        <History key={practice.id} practice={practice} />
      )}
    </div>
  )
}

function InlineField(props: {
  label: string
  editing: boolean
  onEdit: () => void
  onDone: () => void
  display: ReactNode
  children: ReactNode
}) {
  return (
    <section className={styles.inlineField}>
      {props.editing ? (
        <>
          <div>{props.children}</div>
          <button onClick={props.onDone}>Done</button>
        </>
      ) : (
        <>
          <div>{props.display}</div>
          <button className={styles.editButton} aria-label={`Edit ${props.label.toLowerCase()}`} onClick={props.onEdit}>
            ✎
          </button>
        </>
      )}
    </section>
  )
}

function TagsEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [text, setText] = useState(tags.join(', '))
  return (
    <input
      aria-label="Tags"
      value={text}
      placeholder="comma, separated, tags"
      onChange={(e) => {
        setText(e.target.value)
        onChange(parseTags(e.target.value))
      }}
    />
  )
}

function LinksEditor({ links, onChange }: { links: PracticeLink[]; onChange: (links: PracticeLink[]) => void }) {
  const set = (i: number, patch: Partial<PracticeLink>) =>
    onChange(links.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  return (
    <div>
      {links.map((l, i) => (
        <div key={i} className={styles.filters}>
          <input aria-label={`Link ${i + 1} label`} value={l.label} onChange={(e) => set(i, { label: e.target.value })} />
          <input aria-label={`Link ${i + 1} URL`} type="url" value={l.url} onChange={(e) => set(i, { url: e.target.value })} />
          <button aria-label={`Remove link ${i + 1}`} onClick={() => onChange(links.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button onClick={() => onChange([...links, { label: '', url: '' }])}>Add link</button>
    </div>
  )
}

function Overview({ practice }: { practice: PracticeDetail }) {
  const [draft, setDraft] = useState<Draft>({})
  const [editing, setEditing] = useState<Field | null>(null)
  const [conflict, setConflict] = useState(false)
  const [nameConflict, setNameConflict] = useState<Practice | null>(null)
  const update = useUpdatePractice()
  const queryClient = useQueryClient()
  const { ensureName } = useNamePrompt()
  const toast = useToast()

  const changed = (Object.keys(draft) as Field[]).filter(
    (f) => JSON.stringify(draft[f]) !== JSON.stringify(practice[f]),
  )
  const dirty = changed.length > 0
  const view = { ...practice, ...draft }
  const stage = <F extends Field>(field: F, value: Practice[F]) => setDraft((d) => ({ ...d, [field]: value }))
  const edit = (field: Field) => ({
    editing: editing === field,
    onEdit: () => setEditing(field),
    onDone: () => setEditing(null),
  })

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
  )
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  async function save() {
    await ensureName()
    const body: PracticeUpdate = { version: practice.version }
    for (const field of changed) Object.assign(body, { [field]: draft[field] })
    try {
      await update.mutateAsync({ id: practice.id, body })
      setDraft({})
      setEditing(null)
      setConflict(false)
      setNameConflict(null)
    } catch (err) {
      if (!isConflict(err)) {
        const message = validationMessage(err)
        return toast({
          message: message ? `Could not save: ${message}` : 'Could not save your changes.',
          tone: 'error',
        })
      }
      const current = conflictCurrent<Practice>(err)
      if (current && current.id !== practice.id) {
        // A duplicate-name conflict carries the OTHER practice as `current`. Merging it into
        // this practice's cache entry would corrupt its id/version, so leave the cache
        // alone and just surface a message with a link to the existing practice.
        setNameConflict(current)
        return
      }
      if (current) queryClient.setQueryData(keys.practice(practice.id), { ...practice, ...current })
      setConflict(true)
      setNameConflict(null)
    }
  }

  function discard() {
    setDraft({})
    setEditing(null)
    setConflict(false)
    setNameConflict(null)
  }

  return (
    <>
      {conflict && (
        <p role="alert" className={styles.error}>
          Someone else saved changes to this practice. Your edits are kept below. Review them and save again.
        </p>
      )}
      {nameConflict && (
        <p role="alert" className={styles.error}>
          A practice named "{view.name}" already exists.{' '}
          <Link to={`/practices/${nameConflict.id}`}>Open it</Link>
        </p>
      )}
      <div className={styles.practiceLayout}>
        <article className={styles.practiceMain}>
          <InlineField label="Category" {...edit('category')} display={<CategoryChip category={view.category} />}>
            <select aria-label="Category" value={view.category} onChange={(e) => stage('category', e.target.value as Category)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {categoryOptionText(c)}
                </option>
              ))}
            </select>
          </InlineField>
          <InlineField label="Name" {...edit('name')} display={<h1 style={{ margin: 0 }}>{view.name}</h1>}>
            <input aria-label="Name" value={view.name} maxLength={100} onChange={(e) => stage('name', e.target.value)} />
          </InlineField>
          <InlineField
            label="Summary"
            {...edit('summary')}
            display={view.summary ? <p>{view.summary}</p> : <p className={styles.muted}>No summary yet.</p>}
          >
            <input aria-label="Summary" value={view.summary} maxLength={280} onChange={(e) => stage('summary', e.target.value)} />
          </InlineField>
          <InlineField
            label="Tags"
            {...edit('tags')}
            display={
              view.tags.length ? (
                view.tags.map((t) => (
                  <span key={t} className={styles.badge}>
                    {t}
                  </span>
                ))
              ) : (
                <span className={styles.muted}>No tags.</span>
              )
            }
          >
            <TagsEditor tags={view.tags} onChange={(tags) => stage('tags', tags)} />
          </InlineField>
          <InlineField
            label="Links"
            {...edit('links')}
            display={
              view.links.length ? (
                <ul>
                  {view.links.map((l, i) => (
                    <li key={i}>
                      <a href={l.url} target="_blank" rel="noreferrer">
                        {l.label}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className={styles.muted}>No links.</span>
              )
            }
          >
            <LinksEditor links={view.links} onChange={(links) => stage('links', links)} />
          </InlineField>
          <InlineField
            label="Guidance"
            {...edit('body_md')}
            display={<MarkdownView source={view.body_md || '_No guidance yet._'} />}
          >
            <Editor value={view.body_md} onChange={(value) => stage('body_md', value)} label="Guidance" />
          </InlineField>
        </article>
        <aside className={styles.card} aria-label="Who’s using it">
          <h2 style={{ margin: 0, fontSize: 16 }}>Who’s using it ({practice.radars.length})</h2>
          {practice.radars.length === 0 && <p className={styles.muted}>Nobody has this on their radar yet.</p>}
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {practice.radars.map((r) => (
              <li key={r.radar_id}>
                <Link to={`/radar/${r.radar_id}`}>{r.radar_name}</Link> · {r.label}
                {r.note_md && <p className={styles.muted}>{excerpt(r.note_md)}</p>}
              </li>
            ))}
          </ul>
        </aside>
      </div>
      <UnsavedChangesBar count={changed.length} saving={update.isPending} onSave={save} onDiscard={discard} />
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title="Discard unsaved changes?"
        message="You have unsaved changes on this practice. Leaving will discard them."
        confirmLabel="Discard changes"
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />
    </>
  )
}

const ACTION_LABELS: Record<string, string> = {
  create: 'Created',
  update: 'Edited',
  archive: 'Archived',
  restore: 'Restored',
  revert: 'Reverted',
}
const TIME = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

function History({ practice }: { practice: PracticeDetail }) {
  const { data: revisions = [], isLoading } = useRevisions('practice', String(practice.id))
  const revert = useRevert()
  const { ensureName } = useNamePrompt()
  const toast = useToast()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const selected = revisions.find((r) => r.id === selectedId) ?? revisions[0]
  const snapshot = selected?.snapshot as Partial<Practice> | undefined

  async function onRevert() {
    if (!selected) return
    await ensureName()
    try {
      await revert.mutateAsync(selected.id)
      setSelectedId(null)
      toast({ message: 'Reverted to the selected version.' })
    } catch (err) {
      toast({
        message: isConflict(err)
          ? 'Can’t revert: that name is now used by another practice.'
          : 'Could not revert.',
        tone: 'error',
      })
    }
  }

  return (
    <div className={styles.practiceLayout}>
      <ol aria-label="Revisions" className={styles.revisionList}>
        {revisions.map((r) => (
          <li key={r.id}>
            <button aria-pressed={r.id === selected?.id} onClick={() => setSelectedId(r.id)}>
              {ACTION_LABELS[r.action] ?? r.action} by {r.edited_by ?? 'anonymous'} · {TIME.format(new Date(r.created_at))}
            </button>
          </li>
        ))}
      </ol>
      {isLoading && <p className={styles.muted}>Loading…</p>}
      {selected && snapshot && (
        <section className={styles.card} aria-label="Selected version">
          <h2 style={{ margin: 0 }}>{snapshot.name}</h2>
          <p>{snapshot.summary}</p>
          <MarkdownView source={snapshot.body_md ?? ''} />
          <div className={styles.actions}>
            <button
              className="primary"
              onClick={onRevert}
              disabled={revert.isPending || selected.id === revisions[0]?.id}
            >
              Revert to this
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
