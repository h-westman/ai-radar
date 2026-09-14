import { useState } from 'react'
import { readString, writeString } from '../lib/storage'
import styles from './Editor.module.css'
import MarkdownEditor from './MarkdownEditor'
import RichEditor from './RichEditor'

export const EDITOR_MODE_KEY = 'aiRadar.editorMode'
export type EditorMode = 'rich' | 'markdown'

function readMode(): EditorMode {
  return readString(EDITOR_MODE_KEY) === 'markdown' ? 'markdown' : 'rich'
}

type Props = { value: string; onChange: (value: string) => void; label: string }

export default function Editor({ value, onChange, label }: Props) {
  const [mode, setMode] = useState<EditorMode>(readMode)

  function switchTo(next: EditorMode) {
    writeString(EDITOR_MODE_KEY, next)
    setMode(next)
  }

  return (
    <div className={styles.editor}>
      <div role="radiogroup" aria-label="Editor mode" className={styles.modes}>
        {(['rich', 'markdown'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => switchTo(m)}
          >
            {m === 'rich' ? 'Rich' : 'Markdown'}
          </button>
        ))}
      </div>
      {mode === 'rich' ? (
        <RichEditor value={value} onChange={onChange} label={label} />
      ) : (
        <MarkdownEditor value={value} onChange={onChange} label={label} />
      )}
    </div>
  )
}
