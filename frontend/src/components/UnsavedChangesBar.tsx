import styles from './Panels.module.css'

type Props = { count: number; saving: boolean; onSave: () => void; onDiscard: () => void }

export default function UnsavedChangesBar({ count, saving, onSave, onDiscard }: Props) {
  if (count === 0) return null
  return (
    <div className={styles.unsaved} role="region" aria-label="Unsaved changes">
      <span>
        {count} unsaved change{count === 1 ? '' : 's'}
      </span>
      <button onClick={onDiscard} disabled={saving}>
        Discard
      </button>
      <button className="primary" onClick={onSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}
