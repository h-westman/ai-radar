import { describe, expect, it } from 'vitest'
import { applyMarkdownAction } from './markdownActions'

describe('applyMarkdownAction', () => {
  it('wraps the selection in bold', () => {
    expect(applyMarkdownAction('make this bold', 5, 9, 'bold')).toEqual({
      value: 'make **this** bold',
      selectionStart: 7,
      selectionEnd: 11,
    })
  })

  it('inserts and selects a placeholder when nothing is selected', () => {
    expect(applyMarkdownAction('ab', 1, 1, 'bold')).toEqual({
      value: 'a**bold text**b',
      selectionStart: 3,
      selectionEnd: 12,
    })
  })

  it('turns the current line into a heading', () => {
    expect(applyMarkdownAction('one\ntwo', 5, 5, 'heading').value).toBe('one\n## two')
  })

  it('prefixes every selected line with a bullet', () => {
    expect(applyMarkdownAction('a\nb\nc', 0, 3, 'list').value).toBe('- a\n- b\nc')
  })

  it('wraps the selection in a link and selects the url', () => {
    const result = applyMarkdownAction('see docs', 4, 8, 'link')
    expect(result.value).toBe('see [docs](https://)')
    expect(result.value.slice(result.selectionStart, result.selectionEnd)).toBe('https://')
  })

  it('uses inline code for one line and a fence for several', () => {
    expect(applyMarkdownAction('run npm', 4, 7, 'code').value).toBe('run `npm`')
    expect(applyMarkdownAction('a\nb', 0, 3, 'code').value).toBe('```\na\nb\n```')
  })
})
