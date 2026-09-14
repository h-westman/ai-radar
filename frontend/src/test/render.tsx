import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render as baseRender } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router'
import { NamePromptProvider } from '../components/NamePrompt'
import { ToastProvider } from '../components/Toasts'
import { routes } from '../router'

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  })
}

export function queryWrapper(client = createTestQueryClient()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

export function renderRoutes(initialPath: string, extraRoutes: RouteObject[] = []) {
  const router = createMemoryRouter([...extraRoutes, ...routes], {
    initialEntries: [initialPath],
  })
  const client = createTestQueryClient()
  const result = baseRender(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <NamePromptProvider>
          <RouterProvider router={router} />
        </NamePromptProvider>
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { router, client, ...result }
}

export function renderWithProviders(ui: ReactElement) {
  const router = createMemoryRouter([{ path: '*', element: ui }], { initialEntries: ['/'] })
  const client = createTestQueryClient()
  const result = baseRender(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <NamePromptProvider>
          <RouterProvider router={router} />
        </NamePromptProvider>
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { router, client, ...result }
}
