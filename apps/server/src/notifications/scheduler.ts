import { dispatchDue, releaseStuck } from './dispatch.js'
import { materializeDigests } from '../diary/digest.js'
import { materializeEventOccurrences, materializeEvents } from './events.js'
import { materializeRoutines } from './materialize.js'
import { materializeNotes } from './notes.js'
import { pollTelegramOnce } from './telegram-poller.js'
import { telegramEnabled, getMe } from '../lib/telegram.js'
import { webPushEnabled } from '../lib/webpush.js'

const DISPATCH_EVERY_MS = 30_000
const MATERIALIZE_EVERY_MS = 15 * 60_000

/**
 * Bộ lập lịch chạy ngay trong tiến trình server.
 *
 * Không dùng BullMQ/Redis: bảng Notification cộng với FOR UPDATE SKIP LOCKED
 * đã là một hàng đợi bền vững và atomic. Thêm Redis chỉ tạo ra nguồn sự thật
 * thứ hai và một service nữa phải giữ sống, không được lợi gì ở quy mô gia đình.
 */
export function startScheduler(log: { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void }) {
  let stopped = false
  let dispatchRunning = false
  let materializeRunning = false

  // tránh chồng lượt: một lượt chậm không được phép để lượt sau chạy đè
  const guard = (name: string, flagGet: () => boolean, flagSet: (v: boolean) => void, fn: () => Promise<void>) =>
    async () => {
      if (stopped || flagGet()) return
      flagSet(true)
      try { await fn() } catch (err) { log.error({ err, job: name }, 'scheduler job lỗi') } finally { flagSet(false) }
    }

  const runDispatch = guard('dispatch', () => dispatchRunning, (v) => { dispatchRunning = v }, async () => {
    const released = await releaseStuck()
    if (released > 0) log.info({ released }, 'trả lại thông báo kẹt')
    const r = await dispatchDue()
    if (r.claimed > 0) log.info(r, 'dispatch')
  })

  const runMaterialize = guard('materialize', () => materializeRunning, (v) => { materializeRunning = v }, async () => {
    const routines = await materializeRoutines()
    // occurrence phải sinh trước thì materializeEvents mới có gì để đọc
    const occurrences = await materializeEventOccurrences()
    const events = await materializeEvents()
    const notes = await materializeNotes()
    const digests = await materializeDigests()
    if (routines + occurrences + events + notes + digests > 0) {
      log.info({ routines, occurrences, events, notes, digests }, 'sinh thông báo mới')
    }
  })

  const timers = [
    setInterval(() => void runDispatch(), DISPATCH_EVERY_MS),
    setInterval(() => void runMaterialize(), MATERIALIZE_EVERY_MS),
  ]

  void runMaterialize().then(runDispatch)

  // Telegram: long-poll riêng, không dùng setInterval vì mỗi lượt tự chờ tới 30s
  if (telegramEnabled()) {
    void (async () => {
      try {
        const me = await getMe()
        log.info({ bot: me.username ?? me.first_name }, 'Telegram bot đã kết nối')
      } catch (err) {
        log.error({ err: (err as Error).message }, 'Telegram bot không kết nối được')
        return
      }
      while (!stopped) {
        try {
          await pollTelegramOnce(true)
        } catch (err) {
          log.error({ err: (err as Error).message }, 'telegram poll lỗi')
          await new Promise((r) => setTimeout(r, 5_000))
        }
      }
    })()
  }

  log.info(
    { telegram: telegramEnabled(), webpush: webPushEnabled() },
    telegramEnabled() || webPushEnabled()
      ? 'scheduler đã chạy'
      : 'scheduler đã chạy nhưng CHƯA có kênh gửi nào được cấu hình',
  )

  return () => { stopped = true; timers.forEach(clearInterval) }
}
