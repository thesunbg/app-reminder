#!/usr/bin/env node
/**
 * Family Hub — agent máy tính (Phase 8).
 *
 * Cứ 20 giây hỏi hệ điều hành đang dùng app nào, cộng dồn, và cứ 5 phút gửi
 * tổng của cả ngày về server. Chỉ có thế.
 *
 * Nó KHÔNG chặn app, KHÔNG giới hạn giờ, KHÔNG chụp màn hình, KHÔNG đọc nội
 * dung cửa sổ. Chỉ tên app và số phút. Việc cưỡng chế giao cho Screen Time /
 * Family Link ở tầng hệ điều hành — xem docs/PLAN.md mục 1.
 *
 * Chạy:
 *   FH_SERVER=https://reminder.nguyenvando.com FH_TOKEN=... node agent.js
 * hoặc đặt sẵn trong ~/.family-hub-agent/config.json
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { AgentClient } from './src/client.js'
import { sample, supported } from './src/sampler.js'
import { Tracker, vnDate } from './src/tracker.js'

const HOME = join(homedir(), '.family-hub-agent')
const CONFIG_FILE = join(HOME, 'config.json')
const STATE_FILE = join(HOME, 'state.json')

const SAMPLE_MS = 20_000
const SEND_MS = 5 * 60_000
/** Không thao tác lâu hơn ngần này thì không tính — người đã rời máy. */
const IDLE_CUTOFF_SEC = 120

const log = (...args) => console.log(new Date().toISOString().slice(11, 19), ...args)

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

async function writeJson(file, data) {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(data, null, 2))
}

async function loadConfig() {
  const file = (await readJson(CONFIG_FILE)) ?? {}
  const server = process.env.FH_SERVER ?? file.server
  const token = process.env.FH_TOKEN ?? file.token
  if (!server || !token) {
    console.error(`Thiếu cấu hình. Đặt biến môi trường FH_SERVER và FH_TOKEN,
hoặc tạo ${CONFIG_FILE}:

  {
    "server": "https://reminder.nguyenvando.com",
    "token": "token lấy ở Cài đặt → Máy tính"
  }
`)
    process.exit(1)
  }
  return { server, token }
}

async function main() {
  if (!supported()) {
    console.error(`Chưa hỗ trợ nền tảng ${process.platform}.`)
    process.exit(1)
  }

  const { server, token } = await loadConfig()
  const client = new AgentClient(server, token)

  try {
    const info = await client.ping()
    log(`đã kết nối ${server} — máy "${info.device}"`)
  } catch (err) {
    console.error(`Không kết nối được: ${err.message}`)
    process.exit(1)
  }

  // Khôi phục phần đã cộng của hôm nay. Không có bước này thì agent khởi động
  // lại lúc 3 giờ chiều sẽ gửi một báo cáo chỉ có buổi chiều, và vì server lấy
  // số mới đè số cũ, buổi sáng bị xoá khỏi báo cáo.
  let tracker = Tracker.fromJSON(await readJson(STATE_FILE))
  if (tracker.seconds.size > 0) log(`khôi phục ${tracker.seconds.size} app của hôm nay`)

  let stopping = false

  /** Gửi một báo cáo; hỏng thì ghi log rồi thôi — lần sau đã mang đủ phần hụt. */
  async function push(report) {
    if (report.samples.length === 0) return
    try {
      const rows = await client.send(report)
      log(`đã gửi ${rows} dòng cho ngày ${report.date}`)
    } catch (err) {
      log(`gửi hỏng (sẽ gửi lại ở lượt sau): ${err.message}`)
    }
  }

  const tick = async () => {
    const { app, idleSec } = await sample()
    const active = idleSec < IDLE_CUTOFF_SEC ? app : null
    const finishedDay = tracker.add(active, SAMPLE_MS / 1000)
    // Ngày vừa sang: gửi nốt hôm qua trước khi nó bị quên.
    if (finishedDay) await push(finishedDay)
    await writeJson(STATE_FILE, tracker.toJSON())
  }

  const flush = async () => {
    await push(tracker.report())
  }

  const timers = [
    setInterval(() => void tick().catch((e) => log(`lỗi lấy mẫu: ${e.message}`)), SAMPLE_MS),
    setInterval(() => void flush(), SEND_MS),
  ]

  const shutdown = async (signal) => {
    if (stopping) return
    stopping = true
    log(`nhận ${signal}, gửi nốt rồi thoát`)
    timers.forEach(clearInterval)
    await writeJson(STATE_FILE, tracker.toJSON())
    await flush()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  log(`đang theo dõi (mẫu mỗi ${SAMPLE_MS / 1000}s, gửi mỗi ${SEND_MS / 60_000} phút), ngày ${vnDate()}`)
  await tick()
}

await main()
