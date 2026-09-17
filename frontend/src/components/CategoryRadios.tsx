import { useId } from 'react'
import { CATEGORIES, type Category } from '../api/types'
import { CATEGORY_INFO } from '../lib/categories'
import styles from './CategoryRadios.module.css'

export default function CategoryRadios({
  value,
  onChange,
}: {
  value: Category
  onChange: (next: Category) => void
}) {
  const id = useId()
  return (
    <fieldset className={styles.group}>
      <legend>Category</legend>
      {CATEGORIES.map((category) => {
        const info = CATEGORY_INFO[category]
        const optionId = `${id}-${category}`
        return (
          <div key={category} className={styles.option}>
            <input
              type="radio"
              id={optionId}
              name={`${id}-category`}
              value={category}
              checked={value === category}
              aria-describedby={`${optionId}-description`}
              onChange={() => onChange(category)}
            />
            <label htmlFor={optionId} className={styles.name}>
              <span
                className={styles.dot}
                style={{ ['--chip' as string]: `var(--cat-${category})` }}
                aria-hidden="true"
              />
              {info.label}
            </label>
            <p id={`${optionId}-description`} className={styles.description}>
              {info.description[0].toUpperCase() + info.description.slice(1)}, like {info.example}.
            </p>
          </div>
        )
      })}
    </fieldset>
  )
}
