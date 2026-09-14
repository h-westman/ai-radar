export type ToolbarAction = 'bold' | 'heading' | 'list' | 'link' | 'code'

type Result = { value: string; selectionStart: number; selectionEnd: number }

function wrap(text: string, start: number, end: number, before: string, after: string, placeholder: string): Result {
  const selected = text.slice(start, end) || placeholder
  const value = text.slice(0, start) + before + selected + after + text.slice(end)
  return { value, selectionStart: start + before.length, selectionEnd: start + before.length + selected.length }
}

function prefixLines(text: string, start: number, end: number, prefix: string): Result {
  const lineStart = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1
  const endIndex = text.indexOf('\n', end)
  const lineEnd = endIndex === -1 ? text.length : endIndex
  const block = text.slice(lineStart, lineEnd)
  const prefixed = block
    .split('\n')
    .map((line) => prefix + line)
    .join('\n')
  const value = text.slice(0, lineStart) + prefixed + text.slice(lineEnd)
  return { value, selectionStart: lineStart, selectionEnd: lineStart + prefixed.length }
}

export function applyMarkdownAction(text: string, start: number, end: number, action: ToolbarAction): Result {
  switch (action) {
    case 'bold':
      return wrap(text, start, end, '**', '**', 'bold text')
    case 'heading':
      return prefixLines(text, start, start, '## ')
    case 'list': {
      // A selection ending exactly after a newline should not bullet the next line.
      const effectiveEnd = end > start && text[end - 1] === '\n' ? end - 1 : end
      return prefixLines(text, start, effectiveEnd, '- ')
    }
    case 'link': {
      const label = text.slice(start, end) || 'link text'
      const value = text.slice(0, start) + `[${label}](https://)` + text.slice(end)
      const urlStart = start + label.length + 3
      return { value, selectionStart: urlStart, selectionEnd: urlStart + 'https://'.length }
    }
    case 'code':
      return text.slice(start, end).includes('\n')
        ? wrap(text, start, end, '```\n', '\n```', '')
        : wrap(text, start, end, '`', '`', 'code')
  }
}
