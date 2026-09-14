import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import styles from './Toasts.module.css'

type ToastInput = {
  message: string
  tone?: 'info' | 'error'
  action?: { label: string; onClick: () => void }
}
type Toast = ToastInput & { id: number }

const ToastContext = createContext<(toast: ToastInput) => void>(() => {})
let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const dismiss = useCallback((id: number) => {
    setToasts((all) => all.filter((t) => t.id !== id))
  }, [])
  const push = useCallback(
    (toast: ToastInput) => {
      const id = nextId++
      setToasts((all) => [...all, { ...toast, id }])
      window.setTimeout(() => dismiss(id), 6000)
    },
    [dismiss],
  )
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className={styles.region} role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`${styles.toast} ${t.tone === 'error' ? styles.error : ''}`}>
            <span>{t.message}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.onClick()
                  dismiss(t.id)
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
