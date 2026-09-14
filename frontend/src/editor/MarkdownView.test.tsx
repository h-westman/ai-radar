import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import MarkdownView from './MarkdownView'

describe('MarkdownView', () => {
  it('renders GFM tables', () => {
    const { container } = render(<MarkdownView source={'| a | b |\n| - | - |\n| 1 | 2 |'} />)
    expect(container.querySelector('table td')?.textContent).toBe('1')
  })

  it('never renders raw HTML or script URLs', () => {
    const { container } = render(
      <MarkdownView
        source={'<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[x](javascript:alert(1))'}
      />,
    )
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('a')?.getAttribute('href') ?? '').not.toContain('javascript:')
  })
})
