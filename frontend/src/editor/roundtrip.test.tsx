import { Crepe } from '@milkdown/crepe'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import MarkdownView from './MarkdownView'

const FIXTURE = `## Getting started

Install with \`npm i -g tool\` and read the [docs](https://example.com/docs).

- Spec first
- Then plan
  - nested item

1. One
2. Two

\`\`\`ts
const x = 1
\`\`\`

| Tool | Use |
| ---- | --- |
| Claude Code | Refactors |
`

beforeAll(() => {
  // Minimal browser APIs ProseMirror/Crepe touch that jsdom lacks.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  // jsdom also lacks IntersectionObserver, which Milkdown's code-block view uses
  // to lazy-load CodeMirror language support.
  globalThis.IntersectionObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  } as unknown as typeof IntersectionObserver
  window.matchMedia ??= (() => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia
  const rect = { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }
  Range.prototype.getBoundingClientRect ??= () => ({ ...rect, toJSON() {} }) as DOMRect
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList
  document.elementFromPoint ??= () => null
})

const html = (md: string) => renderToStaticMarkup(<MarkdownView source={md} />)

describe('Milkdown Crepe markdown round-trip (spec §6 criteria)', () => {
  it('preserves headings, lists, links, code blocks and GFM tables', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const crepe = new Crepe({ root, defaultValue: FIXTURE })
    await crepe.create()
    const output = crepe.getMarkdown()
    await crepe.destroy()
    expect(html(output)).toBe(html(FIXTURE))
  })
})
