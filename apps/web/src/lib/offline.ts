/**
 * Dùng được khi mất mạng.
 *
 * Hai nửa, tách bạch:
 *  1. **Kho đệm đọc** — ảnh chụp cache của react-query trong localStorage, để
 *     mở app lúc không có mạng vẫn thấy việc hôm nay chứ không phải màn hình
 *     trắng. Chỉ giữ vài truy vấn nhẹ và có hạn dùng.
 *  2. **Hàng đợi ghi (outbox)** — tick việc lúc mất mạng thì xếp hàng rồi gửi
 *     lại khi có mạng.
 *
 * Hàng đợi giữ nguyên THỨ TỰ và không gộp: bấm "Xong" hai lần nghĩa là tick
 * rồi bỏ tick (server coi lần thứ hai là bỏ tick). Gộp lại còn một lần thì kết
 * quả cuối cùng ngược hẳn với ý người dùng.
 *
 * Không thêm thư viện nào: @tanstack/react-query đã có sẵn dehydrate/hydrate,
 * phần còn lại chỉ là localStorage và một danh sách người nghe.
 */
import { dehydrate, hydrate, type DehydratedState, type QueryClient } from '@tanstack/react-query'
import superjson from 'superjson'

const OUTBOX_KEY = 'fh_outbox_v1'
const CACHE_KEY = 'fh_cache_v1'
/** Ảnh chụp cũ hơn ngần này thì bỏ — dữ liệu quá hạn còn tệ hơn màn hình trống. */
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

export type PendingMark = {
  kind: 'mark'
  routineId: string
  date: string
  status: 'DONE' | 'PARTIAL' | 'SKIPPED'
  /** để hiện "xếp hàng lúc 21:05" và để dọn mục quá cũ */
  at: number
}

// ---------- hàng đợi ghi ----------

let cache: PendingMark[] = load()
const listeners = new Set<() => void>()

function load(): PendingMark[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY)
    return raw ? (JSON.parse(raw) as PendingMark[]) : []
  } catch {
    return []
  }
}

function save(next: PendingMark[]) {
  // Mảng mới mỗi lần đổi: useSyncExternalStore so sánh bằng tham chiếu, sửa tại
  // chỗ thì React không vẽ lại và số "đang chờ gửi" đứng im.
  cache = next
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(next))
  } catch {
    // hết chỗ hoặc bị chặn: vẫn giữ trong bộ nhớ cho phiên này
  }
  for (const fn of listeners) fn()
}

export function subscribeOutbox(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function outboxSnapshot(): PendingMark[] {
  return cache
}

export function enqueueMark(item: Omit<PendingMark, 'kind' | 'at'>): void {
  save([...cache, { kind: 'mark', at: Date.now(), ...item }])
}

/** Bỏ mục đầu hàng sau khi gửi xong. */
export function shiftOutbox(): void {
  save(cache.slice(1))
}

export function clearOutbox(): void {
  save([])
}

// ---------- kho đệm đọc ----------

/**
 * Những truy vấn đáng giữ lại để xem offline. Cố ý hẹp: cache càng to thì ghi
 * localStorage càng chậm, mà ngoài màn hình Hôm nay thì offline cũng không làm
 * được gì nhiều.
 */
const PERSIST_PREFIX = ['auth', 'routine', 'stats', 'holiday']

/**
 * Đang ở trạng thái ĐÃ ĐĂNG XUẤT chưa? (`auth.me` trả null khi không có phiên)
 *
 * Cần biết điều này vì ngay sau khi đăng xuất, react-query còn làm vài lượt
 * tải lại; nếu cứ thế ghi tiếp thì ảnh chụp vừa xoá xong lại mọc lại kèm dữ
 * liệu của người vừa đăng xuất.
 */
function loggedOut(client: QueryClient): boolean {
  for (const q of client.getQueryCache().getAll()) {
    const head = (q.queryKey as unknown[])[0]
    if (Array.isArray(head) && head[0] === 'auth' && head[1] === 'me') {
      return q.state.status === 'success' && q.state.data === null
    }
  }
  return false
}

export function persistCache(client: QueryClient): void {
  if (loggedOut(client)) {
    try {
      localStorage.removeItem(CACHE_KEY)
    } catch {
      // bị chặn thì thôi
    }
    return
  }
  try {
    const dumped = dehydrate(client, {
      shouldDehydrateQuery: (q) => {
        if (q.state.status !== 'success') return false
        const head = (q.queryKey as unknown[])[0]
        const first = Array.isArray(head) ? head[0] : head
        return typeof first === 'string' && PERSIST_PREFIX.includes(first)
      },
    })
    localStorage.setItem(CACHE_KEY, superjson.stringify({ at: Date.now(), dumped }))
  } catch {
    // vượt quota hoặc trình duyệt chặn -> bỏ qua, app vẫn chạy bình thường
  }
}

export function restoreCache(client: QueryClient): void {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return
    const { at, dumped } = superjson.parse(raw) as { at: number; dumped: DehydratedState }
    if (Date.now() - at > CACHE_MAX_AGE_MS) {
      localStorage.removeItem(CACHE_KEY)
      return
    }
    hydrate(client, dumped)
  } catch {
    localStorage.removeItem(CACHE_KEY)
  }
}

/**
 * Xoá sạch khi đăng xuất. BẮT BUỘC: ảnh chụp chứa dữ liệu cả nhà, để lại trên
 * máy dùng chung là người kế tiếp mở app thấy luôn mà không cần đăng nhập.
 */
export function clearOfflineData(): void {
  try {
    localStorage.removeItem(CACHE_KEY)
    localStorage.removeItem(OUTBOX_KEY)
  } catch {
    // không xoá được thì cũng không còn gì để làm
  }
  save([])
}

/** Có mạng không — gói lại để test và để chỗ khác không đụng navigator. */
export function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}
