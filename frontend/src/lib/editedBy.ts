import { readString, writeString } from './storage'

const KEY = 'aiRadar.editedBy'

export function getEditedBy(): string | null {
  return readString(KEY)
}

export function setEditedBy(name: string): void {
  writeString(KEY, name.trim())
}

/** True once the person has entered a name OR explicitly skipped (empty string). */
export function hasChosenName(): boolean {
  return getEditedBy() !== null
}
