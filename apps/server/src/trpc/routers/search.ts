/**
 * Tìm kiếm toàn cục.
 *
 * Sau một năm dùng thật, nhà sẽ có vài nghìn ghi chú, dòng nhật ký, bài tập và
 * sự kiện. "Hôm nọ ghi ở đâu ấy" là câu hỏi thường xuyên hơn mọi biểu đồ.
 *
 * Không dấu: gõ "gio ong noi" phải ra "Giỗ ông nội" — người ta tìm bằng bàn
 * phím tiếng Anh nhiều hơn mình tưởng. Dùng hàm `vn_unaccent` tự viết trong
 * migration chứ không dùng extension `unaccent` (cần superuser, máy chủ quản
 * lý có nơi không cho).
 *
 * Quy mô gia đình nên quét bảng là đủ; khi nào chậm thì thêm pg_trgm —
 * `vn_unaccent` đã khai IMMUTABLE nên index hoá được ngay.
 */
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '../../db.js'
import { protectedProcedure, router } from '../trpc.js'

/** Mỗi loại lấy tối đa bấy nhiêu — trang kết quả để tìm, không phải để đọc hết. */
const PER_KIND = 8

export type SearchHit = {
  kind: 'note' | 'diary' | 'study' | 'event' | 'routine'
  id: string
  title: string
  snippet: string
  date: string | null
  /** đường dẫn để bấm vào */
  url: string
  owner: string | null
}

/** Cắt một đoạn quanh vị trí khớp, để người đọc thấy vì sao dòng này hiện ra. */
export function snippetAround(text: string, needle: string, radius = 60): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= radius * 2) return clean
  const at = clean.toLowerCase().indexOf(needle.toLowerCase())
  if (at < 0) return `${clean.slice(0, radius * 2)}…`
  const start = Math.max(0, at - radius)
  const end = Math.min(clean.length, at + needle.length + radius)
  return `${start > 0 ? '…' : ''}${clean.slice(start, end)}${end < clean.length ? '…' : ''}`
}

type Row = { id: string; title: string; body: string; date: string | null; owner: string | null }

/** `vn_unaccent(cột) LIKE %từ khoá%` — mọi truy vấn tìm kiếm đều đi qua đây. */
function like(q: string) {
  return Prisma.sql`'%' || vn_unaccent(${q}) || '%'`
}

export const searchRouter = router({
  all: protectedProcedure
    .input(z.object({ q: z.string().trim().min(2).max(100) }))
    .query(async ({ ctx, input }) => {
      const q = input.q
      const me = ctx.user
      const isParent = me.role === 'PARENT'

      // Nhật ký: của mình luôn xem được; của người khác chỉ khi họ không để
      // riêng tư — đúng luật đang dùng ở /export và ở dashboard con.
      const diaryUsers = await db.user.findMany({
        where: { familyId: me.familyId, OR: [{ id: me.id }, { diaryPrivate: false }] },
        select: { id: true },
      })
      const diaryIds = diaryUsers.map((u) => u.id)

      const childIds = isParent
        ? (await db.user.findMany({ where: { familyId: me.familyId, role: 'CHILD' }, select: { id: true } })).map(
            (u) => u.id,
          )
        : [me.id]

      const [notes, diary, study, events, routines] = await Promise.all([
        // ghi chú: của mình hoặc đã chia sẻ cho cả nhà
        db.$queryRaw<Row[]>`
          SELECT n.id, n.title, n.body, n."remindDate" AS date, u.name AS owner
          FROM "Note" n JOIN "User" u ON u.id = n."ownerId"
          WHERE n."familyId" = ${me.familyId}
            AND (n."ownerId" = ${me.id} OR n.shared = true)
            AND (vn_unaccent(n.title) LIKE ${like(q)} OR vn_unaccent(n.body) LIKE ${like(q)}
                 OR EXISTS (SELECT 1 FROM "NoteItem" i WHERE i."noteId" = n.id AND vn_unaccent(i.text) LIKE ${like(q)}))
          ORDER BY n."updatedAt" DESC LIMIT ${PER_KIND}`,

        db.$queryRaw<Row[]>`
          SELECT d.id, d.date AS title, d.content AS body, d.date, u.name AS owner
          FROM "DiaryEntry" d JOIN "User" u ON u.id = d."userId"
          WHERE d."userId" = ANY(${diaryIds}::text[]) AND vn_unaccent(d.content) LIKE ${like(q)}
          ORDER BY d.date DESC LIMIT ${PER_KIND}`,

        db.$queryRaw<Row[]>`
          SELECT s.id, s.title, COALESCE(s.note, '') AS body, s.date, u.name AS owner
          FROM "StudyRecord" s JOIN "User" u ON u.id = s."childId"
          WHERE s."childId" = ANY(${childIds}::text[])
            AND (vn_unaccent(s.title) LIKE ${like(q)} OR vn_unaccent(COALESCE(s.note, '')) LIKE ${like(q)}
                 OR vn_unaccent(COALESCE(s.subject, '')) LIKE ${like(q)})
          ORDER BY s.date DESC NULLS LAST LIMIT ${PER_KIND}`,

        db.$queryRaw<Row[]>`
          SELECT e.id, e.title, COALESCE(e.note, '') AS body,
                 (SELECT o."solarDate" FROM "EventOccurrence" o
                   WHERE o."eventId" = e.id ORDER BY o."solarDate" DESC LIMIT 1) AS date,
                 NULL AS owner
          FROM "Event" e
          WHERE e."familyId" = ${me.familyId}
            AND (vn_unaccent(e.title) LIKE ${like(q)} OR vn_unaccent(COALESCE(e.note, '')) LIKE ${like(q)})
          ORDER BY e.title LIMIT ${PER_KIND}`,

        db.$queryRaw<Row[]>`
          SELECT r.id, r.title, r.category AS body, NULL AS date, u.name AS owner
          FROM "Routine" r JOIN "User" u ON u.id = r."ownerId"
          WHERE r."familyId" = ${me.familyId} AND r.active = true
            AND (vn_unaccent(r.title) LIKE ${like(q)} OR vn_unaccent(r.category) LIKE ${like(q)})
          ORDER BY r.title LIMIT ${PER_KIND}`,
      ])

      const hits: SearchHit[] = [
        ...notes.map((r) => ({
          kind: 'note' as const, id: r.id,
          title: r.title.trim() || 'Ghi chú không tên',
          snippet: snippetAround(r.body, q), date: r.date, url: '/ghi-chu', owner: r.owner,
        })),
        ...diary.map((r) => ({
          kind: 'diary' as const, id: r.id, title: `Nhật ký ${r.title}`,
          snippet: snippetAround(r.body, q), date: r.date, url: '/nhat-ky', owner: r.owner,
        })),
        ...study.map((r) => ({
          kind: 'study' as const, id: r.id, title: r.title,
          snippet: snippetAround(r.body, q), date: r.date, url: '/hoc-tap', owner: r.owner,
        })),
        ...events.map((r) => ({
          kind: 'event' as const, id: r.id, title: r.title,
          snippet: snippetAround(r.body, q), date: r.date, url: '/su-kien', owner: null,
        })),
        ...routines.map((r) => ({
          kind: 'routine' as const, id: r.id, title: r.title,
          snippet: r.body, date: null, url: '/quan-ly', owner: r.owner,
        })),
      ]

      return { q, total: hits.length, hits }
    }),
})
