import type { Category } from '../api/types'
import styles from './CategoryChip.module.css'

const LABELS: Record<Category, string> = {
  tool: 'Tool',
  skill: 'Skill',
  practice: 'Practice',
  workflow: 'Workflow',
}

export default function CategoryChip({ category }: { category: Category }) {
  return (
    <span className={styles.chip} style={{ ['--chip' as string]: `var(--cat-${category})` }}>
      <span className={styles.dot} aria-hidden="true" />
      {LABELS[category]}
    </span>
  )
}
