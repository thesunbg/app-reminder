import type { FastifyReply, FastifyRequest } from 'fastify'

/**
 * @fastify/cookie gắn cookies/setCookie/clearCookie vào request & reply lúc chạy
 * thông qua module augmentation. Nhưng AppRouter được web import kiểu type-only,
 * và web không cài @fastify/cookie nên augmentation đó không nạp ở phía web
 * → typecheck của web sẽ đỏ. Khai báo tường minh ở đây để kiểu của router
 * đứng độc lập, không phụ thuộc augmentation.
 */
export type CookieOptions = {
  httpOnly?: boolean
  sameSite?: 'lax' | 'strict' | 'none'
  secure?: boolean
  path?: string
  maxAge?: number
}

type WithCookies = { cookies?: Record<string, string | undefined> }
type WithCookieSetters = {
  setCookie(name: string, value: string, options?: CookieOptions): unknown
  clearCookie(name: string, options?: CookieOptions): unknown
}

export function readCookie(req: FastifyRequest, name: string): string | undefined {
  return (req as FastifyRequest & WithCookies).cookies?.[name]
}

export function writeCookie(res: FastifyReply, name: string, value: string, options: CookieOptions): void {
  ;(res as FastifyReply & WithCookieSetters).setCookie(name, value, options)
}

export function dropCookie(res: FastifyReply, name: string, options: CookieOptions = { path: '/' }): void {
  ;(res as FastifyReply & WithCookieSetters).clearCookie(name, options)
}
