import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { getEditedBy, hasChosenName, setEditedBy } from '../lib/editedBy'
import styles from './Modal.module.css'

type NamePromptApi = { ensureName: () => Promise<void>; changeName: () => void }

const NamePromptContext = createContext<NamePromptApi>({
  ensureName: async () => {},
  changeName: () => {},
})

export function NamePromptProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [resolvers, setResolvers] = useState<(() => void)[]>([])

  const ensureName = useCallback(() => {
    if (hasChosenName()) return Promise.resolve()
    return new Promise<void>((resolve) => {
      setResolvers((all) => [...all, resolve])
      setDraft('')
      setOpen(true)
    })
  }, [])

  const changeName = useCallback(() => {
    setDraft(getEditedBy() ?? '')
    setOpen(true)
  }, [])

  const finish = (value: string) => {
    setEditedBy(value)
    setOpen(false)
    resolvers.forEach((resolve) => resolve())
    setResolvers([])
  }

  return (
    <NamePromptContext.Provider value={{ ensureName, changeName }}>
      {children}
      {open && (
        <div className={styles.backdrop}>
          <form
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="name-title"
            onSubmit={(e) => {
              e.preventDefault()
              if (draft.trim()) finish(draft)
            }}
          >
            <h2 id="name-title">Who is editing?</h2>
            <p>Your name is saved with your changes so others can see who made them.</p>
            <label>
              <span className="visually-hidden">Your name</span>
              <input
                aria-label="Your name"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="e.g. Kim Andersson"
              />
            </label>
            <div className={styles.actions}>
              <button type="button" onClick={() => finish('')}>
                Skip
              </button>
              <button type="submit" className="primary" disabled={!draft.trim()}>
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </NamePromptContext.Provider>
  )
}

export function useNamePrompt() {
  return useContext(NamePromptContext)
}
