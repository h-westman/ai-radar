import { describe, expect, it } from 'vitest'
import { idFromRef, toRef } from './refs'

describe('refs', () => {
  it('formats id-slug refs', () => {
    expect(toRef(12, 'claude-code')).toBe('12-claude-code')
  })

  it('parses the id and ignores the slug', () => {
    expect(idFromRef('12-claude-code')).toBe(12)
    expect(idFromRef('12-renamed-since')).toBe(12)
    expect(idFromRef('12')).toBe(12)
  })

  it('returns null for garbage', () => {
    expect(idFromRef(undefined)).toBeNull()
    expect(idFromRef('abc')).toBeNull()
    expect(idFromRef('-3-x')).toBeNull()
  })
})
