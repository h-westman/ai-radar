import { Crepe } from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import { useEffect, useRef } from 'react'
import styles from './Editor.module.css'

type Props = { value: string; onChange: (value: string) => void; label: string }

/** Uncontrolled after mount: change `key` to load a different value. */
export default function RichEditor({ value, onChange, label }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const initialValue = useRef(value)

  useEffect(() => {
    const crepe = new Crepe({ root: rootRef.current!, defaultValue: initialValue.current })
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => onChangeRef.current(markdown))
    })
    void crepe.create()
    return () => {
      void crepe.destroy()
    }
  }, [])

  return <div ref={rootRef} role="group" aria-label={label} className={styles.rich} />
}
