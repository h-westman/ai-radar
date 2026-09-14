import { useEffect, useState, type RefObject } from 'react'
import type { Size } from '../chart/geometry'

export function useElementSize(
  ref: RefObject<HTMLElement | null>,
  fallback: Size = { width: 640, height: 480 },
): Size {
  const [size, setSize] = useState<Size>(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setSize({ width, height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return size
}
