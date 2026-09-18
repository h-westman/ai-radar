import { describe, expect, it } from 'vitest'
import { parseId } from './ids'

describe('parseId', () => {
  it('reads a bare positive integer', () => {
    expect(parseId('12')).toBe(12)
  })

  it('rejects a legacy id-slug ref', () => {
    expect(parseId('12-platform')).toBeNull()
  })

  it('rejects non-numeric, empty and undefined input', () => {
    expect(parseId('org')).toBeNull()
    expect(parseId('')).toBeNull()
    expect(parseId(undefined)).toBeNull()
  })

  it('rejects zero and negative ids', () => {
    expect(parseId('0')).toBeNull()
    expect(parseId('-3')).toBeNull()
  })
})
