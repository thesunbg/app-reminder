/**
 * Seed dữ liệu mẫu cho phát triển.
 *   pnpm db:seed
 * An toàn khi chạy lại: dùng upsert theo email.
 */
import { db } from './db.js'
import { hashPassword } from './lib/password.js'
import { addDays, vnToday } from './lib/time.js'
import { RRULE_PRESETS } from './lib/recurrence.js'

const PARENT_EMAIL = 'bo@giadinh.local'
const CHILD_EMAIL = 'con@giadinh.local'
const PASSWORD = 'matkhau123'

async function main() {
  const family = (await db.family.findFirst()) ?? (await db.family.create({ data: { name: 'Gia đình Đỗ' } }))

  const hash = await hashPassword(PASSWORD)
  const parent = await db.user.upsert({
    where: { email: PARENT_EMAIL },
    update: {},
    create: {
      familyId: family.id, email: PARENT_EMAIL, name: 'Bố', role: 'PARENT',
      passwordHash: hash, avatarColor: '#2563eb', diaryPrivate: false,
    },
  })
  const child = await db.user.upsert({
    where: { email: CHILD_EMAIL },
    update: {},
    create: {
      familyId: family.id, email: CHILD_EMAIL, name: 'Bé Su', role: 'CHILD',
      passwordHash: hash, avatarColor: '#f59e0b', birthday: '2015-06-12',
    },
  })

  const start = addDays(vnToday(), -30)
  const routines = [
    { title: 'Học tiếng Anh', category: 'Học', color: '#2563eb', durationMin: 60, timeOfDay: '06:00', rrule: RRULE_PRESETS.daily, ownerId: parent.id, targetPerWeek: 7 },
    { title: 'Học tiếng Trung', category: 'Học', color: '#dc2626', durationMin: 60, timeOfDay: '21:00', rrule: RRULE_PRESETS.weekdays, ownerId: parent.id, targetPerWeek: 5 },
    { title: 'Tập thể dục', category: 'Sức khoẻ', color: '#16a34a', durationMin: 30, timeOfDay: '05:30', rrule: RRULE_PRESETS.daily, ownerId: parent.id },
    { title: 'Đọc sách', category: 'Học', color: '#7c3aed', durationMin: 30, timeOfDay: '22:00', rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR', ownerId: parent.id },
    { title: 'Làm bài tập về nhà', category: 'Học', color: '#f59e0b', durationMin: 90, timeOfDay: '19:00', rrule: RRULE_PRESETS.weekdays, ownerId: child.id },
    { title: 'Luyện chữ', category: 'Học', color: '#0891b2', durationMin: 20, timeOfDay: '20:30', rrule: 'FREQ=WEEKLY;BYDAY=TU,TH,SA', ownerId: child.id },
  ]

  for (const r of routines) {
    const existing = await db.routine.findFirst({ where: { familyId: family.id, title: r.title, ownerId: r.ownerId } })
    if (existing) continue
    await db.routine.create({ data: { ...r, familyId: family.id, startDate: start } })
  }

  // sinh log ngẫu nhiên 30 ngày qua để biểu đồ có dữ liệu
  const { occurrencesBetween } = await import('./lib/recurrence.js')
  const all = await db.routine.findMany({ where: { familyId: family.id } })
  let created = 0
  for (const r of all) {
    for (const date of occurrencesBetween(r.rrule, r.startDate, start, addDays(vnToday(), -1))) {
      const roll = Math.random()
      if (roll > 0.82) continue // 18% bỏ trống
      const status = roll > 0.7 ? 'PARTIAL' : 'DONE'
      const res = await db.taskLog.upsert({
        where: { routineId_date: { routineId: r.id, date } },
        update: {},
        create: {
          routineId: r.id, date, status,
          actualMin: status === 'DONE' ? r.durationMin : Math.round(r.durationMin * 0.5),
        },
      })
      if (res) created++
    }
  }

  // sự kiện mẫu: một ngày giỗ âm lịch và hai sinh nhật dương lịch
  const events = [
    { title: 'Giỗ ông nội', type: 'DEATH_ANNIVERSARY' as const, calendar: 'LUNAR' as const,
      lunarDay: 15, lunarMonth: 7, remindBeforeDays: [7, 3, 1, 0], note: 'Cúng ở nhà bác cả' },
    { title: 'Giỗ bà ngoại', type: 'DEATH_ANNIVERSARY' as const, calendar: 'LUNAR' as const,
      lunarDay: 20, lunarMonth: 10, remindBeforeDays: [7, 1, 0] },
    { title: 'Sinh nhật Bé Su', type: 'BIRTHDAY' as const, calendar: 'SOLAR' as const,
      solarDate: '06-12', remindBeforeDays: [7, 1, 0] },
    { title: 'Ngày cưới', type: 'OTHER' as const, calendar: 'SOLAR' as const,
      solarDate: '11-28', remindBeforeDays: [14, 3, 0] },
  ]
  for (const e of events) {
    const existing = await db.event.findFirst({ where: { familyId: family.id, title: e.title } })
    if (existing) continue
    await db.event.create({ data: { ...e, familyId: family.id } })
  }

  // ghi chú mẫu: văn bản, checklist, và một ghi chú bảo dưỡng có lặp
  const dueIn = (d: number) => addDays(vnToday(), d)
  const notes: Array<{ data: Record<string, unknown>; items?: string[] }> = [
    { data: { title: 'Thay dầu xe SH', body: 'Mốc 5.000 km · tiệm Hùng ngõ 82', color: 'orange',
              labels: ['Xe cộ'], remindDate: dueIn(12), remindBeforeDays: [3, 0], recurIntervalDays: 180 } },
    { data: { title: 'Đóng học phí cho Su', body: 'Chuyển khoản trường, kỳ 1', color: 'red',
              labels: ['Con cái'], shared: true, remindDate: dueIn(4), remindBeforeDays: [1, 0] } },
    { data: { title: 'Đi chợ cuối tuần', kind: 'CHECKLIST', color: 'green', labels: ['Nhà cửa'], shared: true },
      items: ['Rau cải', 'Thịt bò', 'Sữa cho Su', 'Giấy ăn'] },
    { data: { title: 'Ý tưởng cho kỳ nghỉ hè', body: 'Sa Pa hoặc Quy Nhơn\nĐi 4 ngày, tránh cuối tuần lễ', color: 'blue', labels: ['Gia đình'] } },
    { data: { title: '', body: 'Mật khẩu wifi tầng 2: nha-minh-2024', color: 'yellow' } },
    { data: { title: 'Gia hạn bảo hiểm xe', color: 'purple', labels: ['Xe cộ'],
              remindDate: dueIn(45), remindBeforeDays: [7, 1, 0], recurIntervalDays: 365 } },
  ]
  for (const n of notes) {
    const existing = await db.note.findFirst({ where: { familyId: family.id, title: n.data.title as string, body: (n.data.body as string) ?? '' } })
    if (existing) continue
    await db.note.create({
      data: {
        ...n.data,
        familyId: family.id,
        ownerId: parent.id,
        items: n.items ? { create: n.items.map((text, i) => ({ text, sortOrder: i })) } : undefined,
      } as never,
    })
  }

  // nhật ký mẫu vài ngày gần đây
  const diaryTexts = [
    'Sáng dậy sớm chạy bộ quanh hồ. Chiều họp dự án hơi căng nhưng xong sớm.\nTối kèm Su làm toán, con hiểu nhanh hơn tuần trước.',
    'Hôm nay mưa cả ngày. Ở nhà đọc hết cuốn sách đang dở.',
    'Đưa cả nhà về quê thăm ông bà. Bà nấu canh cua, Su ăn hai bát.',
    'Ngày bình thường. Học tiếng Trung được 45 phút thì buồn ngủ.',
    'Sửa xong cái vòi nước rỉ ở bếp, loay hoay mất hai tiếng nhưng vui.',
  ]
  for (let i = 0; i < diaryTexts.length; i++) {
    const d = addDays(vnToday(), -(i + 1))
    await db.diaryEntry.upsert({
      where: { userId_date_source: { userId: parent.id, date: d, source: 'MANUAL' } },
      create: { userId: parent.id, date: d, source: 'MANUAL', content: diaryTexts[i]!, mood: [5, 3, 5, 3, 4][i] ?? 3 },
      update: {},
    })
  }

  const { materializeEventOccurrences } = await import('./notifications/events.js')
  await materializeEventOccurrences()

  console.log(`✅ Seed xong.
   Gia đình : ${family.name}
   Phụ huynh: ${PARENT_EMAIL} / ${PASSWORD}
   Con      : ${CHILD_EMAIL} / ${PASSWORD}
   Routine  : ${all.length}, task log: ~${created}
   Sự kiện  : ${await db.event.count({ where: { familyId: family.id } })}
   Ghi chú  : ${await db.note.count({ where: { familyId: family.id } })}
   Nhật ký  : ${await db.diaryEntry.count({ where: { userId: parent.id } })}`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
