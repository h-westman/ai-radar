import type { Category } from '../api/types'
import { categoryLabel } from '../lib/categories'
import styles from './CategoryChip.module.css'

export default function CategoryChip({ category }: { category: Category }) {
  return (
    <span className={styles.chip} style={{ ['--chip' as string]: `var(--cat-${category})` }}>
      <span className={styles.dot} aria-hidden="true" />
      {categoryLabel(category)}
    </span>
  )
}
