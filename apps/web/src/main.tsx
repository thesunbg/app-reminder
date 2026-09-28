import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { httpBatchLink } from '@trpc/client'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import superjson from 'superjson'
import App from './App'
import './index.css'
import { persistCache, restoreCache } from './lib/offline'
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
  // Nạp lại ảnh chụp cache TRƯỚC lần vẽ đầu tiên: mở app lúc mất mạng vẫn thấy
  // việc hôm nay thay vì màn hình trắng. useState(() => …) chạy đúng một lần.
  useState(() => {
    restoreCache(queryClient)
    return null
  })

  useEffect(() => {
    // Ghi lại sau mỗi lần cache đổi, gộp 1 giây một lần — ghi localStorage là
    // đồng bộ, làm mỗi lần fetch thì giao diện khựng.
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsub = queryClient.getQueryCache().subscribe(() => {
      clearTimeout(timer)
      timer = setTimeout(() => persistCache(queryClient), 1000)
    })
    return () => {
      clearTimeout(timer)
      unsub()
    }
  }, [queryClient])

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
