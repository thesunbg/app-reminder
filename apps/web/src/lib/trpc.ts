import { createTRPCReact } from '@trpc/react-query'
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@server/trpc/router'

export const trpc = createTRPCReact<AppRouter>()

/**
 * Suy kiểu từ router thay vì từ useQuery: useQuery là generic overload nên
 * ReturnType<...>['data'] ra {} chứ không ra kiểu thật.
 */
export type RouterOutputs = inferRouterOutputs<AppRouter>
export type RouterInputs = inferRouterInputs<AppRouter>
