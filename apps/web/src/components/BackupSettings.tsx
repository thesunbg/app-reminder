/**
 * Sao lưu & khôi phục — dành riêng cho quản trị gia đình.
 *
 * Trang này tồn tại cho đúng một ngày: ngày máy chủ mất, hoặc ngày ai đó lỡ
 * tay xoá mất một mảng dữ liệu. Vì vậy nó ưu tiên *không làm hỏng thêm*:
 *  - mặc định chọn chế độ "bù phần thiếu", chế độ không xoá gì;
 *  - luôn chạy xem trước trước khi cho bấm khôi phục, để người dùng nhìn thấy
 *    con số thật chứ không phải đoán;
 *  - "dựng lại từ đầu" bắt gõ tay chữ xác nhận, y như lúc gỡ thành viên.
 *
 * Đi qua fetch thẳng chứ không qua tRPC: file có thể vài chục MB (kèm ảnh đề
 * bài), vượt xa giới hạn thân request chung của server — xem
 * `apps/server/src/backup/route.ts`.
 */
import { useState } from 'react'
import { Card, ErrorNote, Spinner } from '@/components/ui'
import { trpc } from '@/lib/trpc'
import type { BackupCounts } from '@server/backup/format'

type Mode = 'merge' | 'replace'

const CONFIRM = 'DUNG LAI'

/**
 * Nhãn cho từng bảng. Gõ lại ở đây thay vì import từ server (import giá trị là
 * kéo code server vào bundle trình duyệt), nhưng kiểu thì lấy từ server — thêm
 * bảng mới vào backup mà quên thêm nhãn là typecheck đỏ ngay.
 */
const LABELS: Record<keyof BackupCounts, string> = {
  users: 'Thành viên',
  routines: 'Việc định kỳ',
  taskLogs: 'Lượt tick',
  events: 'Sự kiện',
  eventOccurrences: 'Lần xảy ra',
  notes: 'Ghi chú',
  noteItems: 'Mục trong ghi chú',
  diary: 'Nhật ký',
  classSchedule: 'Tiết học',
  studyRecords: 'Bài tập & điểm',
  studyAttachments: 'Ảnh đề bài',
  healthRecords: 'Sổ sức khoẻ',
  agentDevices: 'Máy có agent',
  screenReports: 'Thời lượng dùng máy',
}

type Report = {
  ok: true
  mode: Mode
  applied: boolean
  file: BackupCounts
  restored: BackupCounts
  skipped: BackupCounts
  admins: string[]
  warnings: string[]
}

async function callRestore(body: unknown): Promise<Report> {
  const res = await fetch('/backup/restore', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => null)) as (Report & { error?: string; detail?: string }) | null
  if (!res.ok || !json?.ok) {
    throw new Error([json?.error ?? `Máy chủ trả lỗi ${res.status}`, json?.detail].filter(Boolean).join(' — '))
  }
  return json
}

export default function BackupSettings() {
  const me = trpc.auth.me.useQuery()
  const [withPhotos, setWithPhotos] = useState(true)

  const [file, setFile] = useState<{ name: string; data: unknown } | null>(null)
  const [mode, setMode] = useState<Mode>('merge')
  const [confirm, setConfirm] = useState('')
  const [preview, setPreview] = useState<Report | null>(null)
  const [done, setDone] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Đổi key là <input type="file"> được vẽ lại từ đầu. Không có nó thì chọn
  // lại đúng file vừa chọn sẽ không bắn onChange, và giao diện đứng im.
  const [slot, setSlot] = useState(0)

  if (!me.data?.isAdmin) return null

  const clear = () => {
    setFile(null)
    setPreview(null)
    setDone(null)
    setConfirm('')
    setError(null)
  }

  /** Như `clear` nhưng vẽ lại luôn ô chọn file — đừng gọi từ trong onChange của nó. */
  const reset = () => {
    clear()
    setSlot((n) => n + 1)
  }

  const pick = async (picked: File | undefined) => {
    clear()
    if (!picked) return
    setBusy(true)
    try {
      const data: unknown = JSON.parse(await picked.text())
      setFile({ name: picked.name, data })
      setPreview(await callRestore({ mode, dryRun: true, data }))
    } catch (err) {
      setError(err instanceof SyntaxError ? 'File này không phải JSON đọc được' : (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const changeMode = async (next: Mode) => {
    setMode(next)
    setDone(null)
    setError(null)
    if (!file) return
    setBusy(true)
    try {
      setPreview(await callRestore({ mode: next, dryRun: true, data: file.data }))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const report = await callRestore({ mode, confirm, data: file.data, dryRun: false })
      // Dọn khay chọn file: để nguyên thì còn lại một nút khôi phục đã bấm rồi
      // và một bảng số liệu cũ, rất dễ bấm lần thứ hai mà không định làm vậy.
      reset()
      setDone(report)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const blocked = mode === 'replace' && confirm.trim().toUpperCase() !== CONFIRM

  return (
    <Card className="mb-4 flex flex-col gap-5 p-4">
      <div>
        <h2 className="font-semibold">Sao lưu & khôi phục</h2>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Một file duy nhất chứa đủ dữ liệu cả nhà để dựng lại từ đầu trên máy chủ trắng.
        </p>
      </div>

      {/* ---------- tải xuống ---------- */}
      <section className="flex flex-col gap-2">
        <p className="text-sm font-semibold">Tải bản sao lưu</p>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Gồm thành viên, việc định kỳ, sự kiện, ghi chú, nhật ký (cả phần riêng tư), học tập, sổ sức khoẻ
          và thời lượng dùng máy. <strong>File có chứa hash mật khẩu của cả nhà — giữ nó như giữ mật khẩu.</strong>
        </p>
        <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
          <input type="checkbox" checked={withPhotos} onChange={(e) => setWithPhotos(e.target.checked)} />
          Kèm ảnh đề bài (bỏ đi thì file nhẹ hơn nhiều)
        </label>
        <a className="btn btn-ghost self-start !py-1.5 text-xs" href={withPhotos ? '/backup' : '/backup?anh=0'} download>
          Tải file sao lưu
        </a>
      </section>

      {/* ---------- khôi phục ---------- */}
      <section className="flex flex-col gap-3 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
        <div>
          <p className="text-sm font-semibold">Khôi phục từ file</p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Chọn file rồi xem trước sẽ thay đổi những gì, sau đó mới bấm khôi phục.
          </p>
        </div>

        <input
          key={slot}
          className="text-xs"
          type="file"
          accept="application/json,.json"
          onChange={(e) => void pick(e.target.files?.[0])}
        />

        {file && (
          <div className="flex flex-col gap-3 rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
            <p className="truncate text-xs" style={{ color: 'var(--muted)' }}>📄 {file.name}</p>

            <div className="flex flex-col gap-2">
              <ModeOption
                checked={mode === 'merge'}
                onSelect={() => void changeMode('merge')}
                title="Bù phần thiếu"
                hint="Chỉ chèn những dòng chưa có. Không xoá, không ghi đè thứ gì đang có."
              />
              <ModeOption
                checked={mode === 'replace'}
                onSelect={() => void changeMode('replace')}
                title="Dựng lại từ đầu"
                hint="Xoá sạch dữ liệu hiện tại rồi chép nguyên file vào. Mọi người bị đăng xuất và đăng nhập lại bằng mật khẩu ghi trong file."
              />
            </div>

            {busy && <Spinner label="Đang tính toán" />}
            {preview && !busy && <Counts report={preview} title="Xem trước — chưa ghi gì vào máy chủ" />}

            {mode === 'replace' && (
              <label className="flex flex-col gap-1 text-xs">
                <span style={{ color: 'var(--muted)' }}>Gõ <strong>{CONFIRM}</strong> để xác nhận xoá dữ liệu hiện tại</span>
                <input
                  className="input-base"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder={CONFIRM}
                  autoComplete="off"
                />
              </label>
            )}

            <button
              className="btn btn-primary self-start !py-1.5 text-xs"
              onClick={() => void apply()}
              disabled={busy || blocked || !preview}
            >
              {mode === 'replace' ? 'Xoá hết và dựng lại' : 'Chèn phần còn thiếu'}
            </button>
          </div>
        )}

        {error && <ErrorNote message={error} />}

        {done && (
          <div className="flex flex-col gap-2 rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
            <Counts report={done} title="✓ Đã khôi phục xong" />
            {done.mode === 'replace' && (
              <p className="text-xs" style={{ color: 'var(--warn)' }}>
                Mọi phiên đăng nhập cũ đã mất hiệu lực. Tải lại trang và đăng nhập lại bằng{' '}
                <strong>{done.admins.join(', ')}</strong> với mật khẩu tại thời điểm sao lưu.
              </p>
            )}
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Lịch nhắc được dựng lại trong vòng 15 phút, không cần làm gì thêm.
            </p>
            <button className="btn btn-ghost self-start !py-1.5 text-xs" onClick={() => location.reload()}>
              Tải lại trang
            </button>
          </div>
        )}
      </section>
    </Card>
  )
}

function ModeOption({ checked, onSelect, title, hint }: { checked: boolean; onSelect: () => void; title: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <input className="mt-1" type="radio" name="backup-mode" checked={checked} onChange={onSelect} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs" style={{ color: 'var(--muted)' }}>{hint}</span>
      </span>
    </label>
  )
}

/** Bảng "trong file / sẽ chèn / bỏ qua". Chỉ hiện dòng nào có số, đỡ rối mắt. */
function Counts({ report, title }: { report: Report; title: string }) {
  const rows = (Object.keys(LABELS) as (keyof BackupCounts)[]).filter((t) => report.file[t] > 0)

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold">{title}</p>
      <table className="w-full text-xs">
        <thead style={{ color: 'var(--muted)' }}>
          <tr className="text-left">
            <th className="font-normal">Bảng</th>
            <th className="w-16 text-right font-normal">Trong file</th>
            <th className="w-16 text-right font-normal">{report.applied ? 'Đã chèn' : 'Sẽ chèn'}</th>
            <th className="w-16 text-right font-normal">Bỏ qua</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t}>
              <td className="py-0.5">{LABELS[t]}</td>
              <td className="text-right tabular-nums">{report.file[t]}</td>
              <td className="text-right tabular-nums font-semibold">{report.restored[t]}</td>
              <td className="text-right tabular-nums" style={{ color: 'var(--muted)' }}>{report.skipped[t]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {report.warnings.map((w) => (
        <p key={w} className="text-xs" style={{ color: 'var(--warn)' }}>⚠ {w}</p>
      ))}
    </div>
  )
}
