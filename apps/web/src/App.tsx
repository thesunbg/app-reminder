import { Suspense, lazy, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Spinner } from '@/components/ui'
import { trpc } from '@/lib/trpc'
import Login from '@/pages/Login'
import Diary from '@/pages/Diary'
import Events from '@/pages/Events'
import Notes from '@/pages/Notes'
import Routines from '@/pages/Routines'
import Settings from '@/pages/Settings'
import Today from '@/pages/Today'
import Week from '@/pages/Week'

// recharts nặng (~500 kB) và chỉ dùng ở tab Thống kê → tách chunk riêng.
const Stats = lazy(() => import('@/pages/Stats'))

/**
 * Trên mobile chỉ hiện 4 mục hay dùng nhất; 8 mục nhồi vào thanh dưới ở màn
 * 375px thì mỗi mục còn ~47px, chữ chật và dễ bấm nhầm. Phần còn lại nằm
 * trong bảng "Thêm".
 */
const MOBILE_PRIMARY = ['/', '/nhat-ky', '/ghi-chu', '/su-kien']

const TABS = [
  { to: '/', label: 'Hôm nay', icon: '✓', end: true },
  { to: '/tuan', label: 'Tuần', icon: '▦', end: false },
  { to: '/nhat-ky', label: 'Nhật ký', icon: '✍', end: false },
  { to: '/ghi-chu', label: 'Ghi chú', icon: '📝', end: false },
  { to: '/su-kien', label: 'Ngày lễ', icon: '🕯', end: false },
  { to: '/thong-ke', label: 'Thống kê', icon: '◔', end: false },
  { to: '/quan-ly', label: 'Quản lý', icon: '☰', end: false },
  { to: '/cai-dat', label: 'Cài đặt', icon: '⚙', end: false },
]

export default function App() {
  const me = trpc.auth.me.useQuery()

  if (me.isLoading) {
    return <div className="flex min-h-dvh items-center justify-center"><Spinner /></div>
  }
  if (!me.data) return <Login />

  return (
    <div className="flex min-h-dvh flex-col sm:flex-row">
      {/* Thanh điều hướng: sidebar trên desktop */}
      <nav
        className="hidden shrink-0 flex-col gap-1 p-3 sm:flex sm:w-52"
        style={{ borderRight: '1px solid var(--border)', background: 'var(--surface)' }}
      >
        <div className="mb-4 flex items-center gap-2 px-2 pt-2">
          <span className="text-xl">🏠</span>
          <span className="font-bold">Family Hub</span>
        </div>
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition"
            style={({ isActive }) =>
              isActive
                ? { background: 'var(--brand-soft)', color: 'var(--brand)' }
                : { color: 'var(--muted)' }
            }
          >
            <span className="w-4 text-center">{t.icon}</span>
            {t.label}
          </NavLink>
        ))}
      </nav>

      <main className="min-w-0 flex-1">
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/tuan" element={<Week />} />
          <Route path="/nhat-ky" element={<Diary />} />
          <Route path="/ghi-chu" element={<Notes />} />
          <Route path="/su-kien" element={<Events />} />
          <Route path="/thong-ke" element={<Suspense fallback={<Spinner label="Đang tải biểu đồ…" />}><Stats /></Suspense>} />
          <Route path="/quan-ly" element={<Routines />} />
          <Route path="/cai-dat" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* Thanh tab dưới trên mobile */}
      <MobileNav />
    </div>
  )
}

function MobileNav() {
  const [moreOpen, setMoreOpen] = useState(false)
  const location = useLocation()
  const primary = TABS.filter((t) => MOBILE_PRIMARY.includes(t.to))
  const secondary = TABS.filter((t) => !MOBILE_PRIMARY.includes(t.to))
  const inSecondary = secondary.some((t) => location.pathname.startsWith(t.to))

  const barStyle = {
    background: 'color-mix(in srgb, var(--surface) 92%, transparent)',
    backdropFilter: 'blur(12px)',
    borderTop: '1px solid var(--border)',
    paddingBottom: 'env(safe-area-inset-bottom)',
  }

  return (
    <>
      {moreOpen && (
        <div
          className="fixed inset-0 z-30 sm:hidden"
          style={{ background: 'rgba(0,0,0,.4)' }}
          onClick={() => setMoreOpen(false)}
        >
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl p-3"
            style={{
              background: 'var(--surface)',
              borderTop: '1px solid var(--border)',
              // chừa chỗ cho thanh tab nằm đè lên, nếu không mục cuối bị che
              paddingBottom: 'calc(3.5rem + env(safe-area-inset-bottom))',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full" style={{ background: 'var(--border)' }} />
            {secondary.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                onClick={() => setMoreOpen(false)}
                className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold"
                style={({ isActive }) =>
                  isActive
                    ? { background: 'var(--brand-soft)', color: 'var(--brand)' }
                    : { color: 'var(--text)' }
                }
              >
                <span className="w-5 text-center">{t.icon}</span>
                {t.label}
              </NavLink>
            ))}
          </div>
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-40 flex sm:hidden" style={barStyle}>
        {primary.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold"
            style={({ isActive }) => ({ color: isActive ? 'var(--brand)' : 'var(--muted)' })}
          >
            <span className="text-base leading-none">{t.icon}</span>
            {t.label}
          </NavLink>
        ))}
        <button
          onClick={() => setMoreOpen((v) => !v)}
          aria-label="Thêm mục khác"
          aria-expanded={moreOpen}
          className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold"
          style={{ color: inSecondary || moreOpen ? 'var(--brand)' : 'var(--muted)' }}
        >
          <span className="text-base leading-none">⋯</span>
          Thêm
        </button>
      </nav>
    </>
  )
}
