import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './server'

// jsdom has no DragEvent (https://github.com/jsdom/jsdom/issues/2913). Testing Library's
// fireEvent.drop falls back to a plain Event when window.DragEvent is missing, and a plain
// Event constructor ignores non-standard init fields like clientX/clientY, so drop coordinates
// are lost. MouseEvent's constructor does understand clientX/clientY, so extending it recovers
// them; dataTransfer is accepted as a plain init field since nothing else constrains it here.
if (typeof globalThis.DragEvent === 'undefined') {
  class DragEvent extends MouseEvent {
    dataTransfer: DataTransfer | null
    constructor(type: string, init: MouseEventInit & { dataTransfer?: DataTransfer | null } = {}) {
      super(type, init)
      this.dataTransfer = init.dataTransfer ?? null
    }
  }
  globalThis.DragEvent = DragEvent as unknown as typeof globalThis.DragEvent
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
  localStorage.clear()
})
afterAll(() => server.close())
