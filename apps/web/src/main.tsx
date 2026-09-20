import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { httpBatchLink } from '@trpc/client'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import superjson from 'superjson'
import App from './App'
import './index.css'
import { trpc } from './lib/trpc'

function Root() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: (count, err) => {
              // không retry lỗi xác thực
              const code = (err as { data?: { code?: string } })?.data?.code
              if (code === 'UNAUTHORIZED' || code === 'FORBIDDEN') return false
              return count < 2
            },
            refetchOnWindowFocus: true,
          },
        },
      }),
  )
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [httpBatchLink({ url: '/trpc', transformer: superjson, fetch: (u, o) => fetch(u, { ...o, credentials: 'include' }) })],
    }),
  )

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </trpc.Provider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
