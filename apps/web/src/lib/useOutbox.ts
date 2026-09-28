/**
 * Gửi lại các lần tick đã xếp hàng khi mất mạng.
 *
 * Gửi TUẦN TỰ và theo đúng thứ tự đã xếp: hai lần bấm "Xong" của cùng một việc
 * nghĩa là tick rồi bỏ tick, gửi song song thì thứ tự tới server không đoán
 * được và kết quả cuối cùng thành ngẫu nhiên.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { trpc } from '@/lib/trpc'
import { isOnline, outboxSnapshot, shiftOutbox, subscribeOutbox } from '@/lib/offline'

export function usePendingMarks() {
  return useSyncExternalStore(subscribeOutbox, outboxSnapshot, outboxSnapshot)
}

/** Theo dõi trạng thái mạng của trình duyệt. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb)
      window.addEventListener('offline', cb)
      return () => {
        window.removeEventListener('online', cb)
        window.removeEventListener('offline', cb)
      }
    },
    () => isOnline(),
    () => true, // server-side render: coi như có mạng
  )
}

export function useOutboxFlush() {
  const utils = trpc.useUtils()
  const pending = usePendingMarks()
  const online = useOnline()
  const running = useRef(false)

  const flush = useCallback(async () => {
    if (running.current || !isOnline()) return
    running.current = true
    try {
      // đọc lại hàng đợi sau MỖI lần gửi: người dùng có thể tick thêm trong lúc này
      while (isOnline()) {
        const item = outboxSnapshot()[0]
        if (!item) break
        try {
          await utils.client.routine.mark.mutate({
            routineId: item.routineId,
            date: item.date,
            status: item.status,
          })
          shiftOutbox()
        } catch (err) {
          // Lỗi nghiệp vụ (việc đã xoá, không có quyền, không rơi vào ngày đó)
          // thì bỏ mục này đi, nếu không nó chặn cả hàng mãi mãi. Lỗi mạng thì
          // dừng lại để lần sau thử tiếp.
          if (isOnline()) shiftOutbox()
          else break
        }
      }
    } finally {
      running.current = false
      await utils.routine.invalidate()
      await utils.stats.invalidate()
    }
  }, [utils])

  // có mạng trở lại, hoặc vừa mở app mà hàng đợi còn hàng
  useEffect(() => {
    if (online && pending.length > 0) void flush()
  }, [online, pending.length, flush])

  return { pending, online, flush }
}
