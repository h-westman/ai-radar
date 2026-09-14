import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { NamePromptProvider } from './components/NamePrompt'
import { ToastProvider } from './components/Toasts'
import { router } from './router'
import './styles/global.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 2 } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <NamePromptProvider>
          <RouterProvider router={router} />
        </NamePromptProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
)
