/**
 * Hỏi hệ điều hành: đang dùng app nào, và người dùng có đang ngồi máy không.
 *
 * Chỉ **đọc**. Không có đường nào trong file này chặn, tắt, hay can thiệp vào
 * app đang chạy — đó là ranh giới của cả phase 8 (docs/PLAN.md mục 1).
 *
 * Mỗi nền tảng một lệnh sẵn có của hệ thống, không cài thêm gì:
 *   macOS   — osascript (AppleScript) + ioreg
 *   Windows — PowerShell + user32.dll
 *   Linux   — xprop (+ xprintidle nếu có)
 *
 * Mọi lỗi đều trả về "không biết" thay vì ném ra: agent phải sống qua nhiều
 * tháng trên máy người khác, một lần `xprop` hỏng không được làm chết tiến trình.
 */
import { execFile } from 'node:child_process'
import { platform } from 'node:os'

/** Lệnh thăm dò không bao giờ được treo lâu hơn chu kỳ lấy mẫu. */
const PROBE_TIMEOUT_MS = 5_000

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: PROBE_TIMEOUT_MS, windowsHide: true }, (err, stdout) => {
      resolve(err ? null : String(stdout).trim())
    })
  })
}

// ------------------------------------------------------------------- macOS

const MAC_APP = `tell application "System Events" to get name of first application process whose frontmost is true`
// HIDIdleTime tính bằng nano giây kể từ thao tác cuối cùng.
const MAC_IDLE = `ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print int($NF/1000000000); exit}'`

async function macSample() {
  const [app, idle] = await Promise.all([
    run('osascript', ['-e', MAC_APP]),
    run('/bin/sh', ['-c', MAC_IDLE]),
  ])
  return { app: app || null, idleSec: idle === null ? 0 : Number(idle) || 0 }
}

// ----------------------------------------------------------------- Windows

/**
 * Lấy cả tên app lẫn thời gian rảnh trong **một** lần gọi PowerShell: khởi
 * động PowerShell tốn vài trăm ms, gọi hai lần mỗi 20 giây là lãng phí thấy rõ.
 */
const WIN_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FhProbe {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  public static int IdleSeconds() {
    LASTINPUTINFO lii = new LASTINPUTINFO();
    lii.cbSize = (uint)Marshal.SizeOf(lii);
    if (!GetLastInputInfo(ref lii)) return 0;
    return (int)((Environment.TickCount - (long)lii.dwTime) / 1000);
  }
}
"@
$pid_ = 0
[void][FhProbe]::GetWindowThreadProcessId([FhProbe]::GetForegroundWindow(), [ref]$pid_)
$p = Get-Process -Id $pid_ -ErrorAction SilentlyContinue
$name = if ($p.MainWindowTitle) { $p.ProcessName } else { $p.ProcessName }
Write-Output ("{0}|{1}" -f $name, [FhProbe]::IdleSeconds())
`

async function winSample() {
  const out = await run('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WIN_SCRIPT,
  ])
  if (!out) return { app: null, idleSec: 0 }
  const [app, idle] = out.split('|')
  return { app: app?.trim() || null, idleSec: Number(idle) || 0 }
}

// ------------------------------------------------------------------- Linux

async function linuxSample() {
  const rootProp = await run('xprop', ['-root', '_NET_ACTIVE_WINDOW'])
  const id = rootProp?.match(/(0x[0-9a-f]+)/i)?.[1]
  let app = null
  if (id && id !== '0x0') {
    const cls = await run('xprop', ['-id', id, 'WM_CLASS'])
    // WM_CLASS(STRING) = "code", "Code"  -> lấy phần thứ hai, nó dễ đọc hơn
    const names = cls?.match(/"([^"]+)"/g)?.map((s) => s.slice(1, -1))
    app = names?.[1] ?? names?.[0] ?? null
  }
  // xprintidle không có sẵn trên đa số bản phân phối; thiếu thì coi như đang ngồi máy.
  const idle = await run('xprintidle', [])
  return { app, idleSec: idle === null ? 0 : Math.round(Number(idle) / 1000) || 0 }
}

// --------------------------------------------------------------------------

const SAMPLERS = { darwin: macSample, win32: winSample, linux: linuxSample }

export const supported = () => platform() in SAMPLERS

/**
 * Một lần thăm dò.
 * @returns {Promise<{app: string|null, idleSec: number}>} app = null nghĩa là
 *   không xác định được — người gọi nên bỏ qua mẫu đó chứ đừng đoán.
 */
export async function sample() {
  const fn = SAMPLERS[platform()]
  if (!fn) return { app: null, idleSec: 0 }
  try {
    return await fn()
  } catch {
    return { app: null, idleSec: 0 }
  }
}
