import { useRef, useState } from 'react'
import styles from './Editor.module.css'
import { applyMarkdownAction, type ToolbarAction } from './markdownActions'
import MarkdownView from './MarkdownView'

type Props = { value: string; onChange: (value: string) => void; label: string }

const TOOLBAR: { action: ToolbarAction; label: string; glyph: string }[] = [
  { action: 'bold', label: 'Bold', glyph: 'B' },
  { action: 'heading', label: 'Heading', glyph: 'H' },
  { action: 'list', label: 'Bulleted list', glyph: '•' },
  { action: 'link', label: 'Link', glyph: '🔗' },
  { action: 'code', label: 'Code', glyph: '</>' },
]

export default function MarkdownEditor({ value, onChange, label }: Props) {
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function apply(action: ToolbarAction) {
    const el = textareaRef.current!
    const result = applyMarkdownAction(value, el.selectionStart, el.selectionEnd, action)
    onChange(result.value)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(result.selectionStart, result.selectionEnd)
    })
  }

  return (
    <div className={styles.markdownEditor}>
      <div role="tablist" className={styles.tabs}>
        <button type="button" role="tab" aria-selected={tab === 'write'} onClick={() => setTab('write')}>
          Write
        </button>
        <button type="button" role="tab" aria-selected={tab === 'preview'} onClick={() => setTab('preview')}>
          Preview
        </button>
      </div>
      {tab === 'write' ? (
        <>
          <div className={styles.toolbar} role="toolbar" aria-label="Formatting">
            {TOOLBAR.map((t) => (
              <button key={t.action} type="button" aria-label={t.label} title={t.label} onClick={() => apply(t.action)}>
                {t.glyph}
              </button>
            ))}
          </div>
          <textarea
            ref={textareaRef}
            aria-label={label}
            className={styles.textarea}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={12}
          />
        </>
      ) : (
        <div className={styles.preview}>
          <MarkdownView source={value || '_Nothing to preview._'} />
        </div>
      )}
    </div>
  )
}
