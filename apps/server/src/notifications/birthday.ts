/**
 * Sinh nhật thành viên ↔ sự kiện trên lịch.
 *
 * Khai ngày sinh trong Cài đặt là sự kiện hiện ngay trên lịch và được nhắc như
 * mọi sự kiện khác — không phải gõ lại lần nữa ở trang Sự kiện, cũng không có
 * chuyện hai chỗ lệch nhau.
 *
 * Cách làm: mỗi thành viên có ngày sinh thì có ĐÚNG MỘT `Event` gắn với họ qua
 * `birthdayUserId`. Nhờ vậy nó dùng chung toàn bộ engine đã có (occurrence,
 * lịch tháng, nhắc trước N ngày) thay vì phải chèn một loại sự kiện ảo vào mọi
 * truy vấn.
 */
import { db } from '../db.js'
import { clearEventNotifications, materializeEventOccurrences, materializeEvents } from './events.js'

/** Nhắc sinh nhật: trước một tuần để kịp mua quà, trước một hôm, và đúng ngày. */
const REMIND_BEFORE_DAYS = [7, 1, 0]

/**
 * Tạo / cập nhật / xoá sự kiện sinh nhật cho một thành viên.
 *
 * Xoá khi họ không còn ngày sinh hoặc tài khoản bị tắt: tài khoản đã tắt mà
 * vẫn réo cả nhà chúc mừng thì kỳ.
 */
export async function syncBirthdayEvent(userId: string): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId } })
  if (!user) return

  const existing = await db.event.findUnique({ where: { birthdayUserId: userId } })

  if (!user.birthday || !user.active) {
    if (existing) {
      await clearEventNotifications(existing.id)
      await db.event.delete({ where: { id: existing.id } })
    }
    return
  }

  const data = {
    familyId: user.familyId,
    // đổi tên thành viên thì tên sự kiện đổi theo
    title: `Sinh nhật ${user.name}`,
    type: 'BIRTHDAY' as const,
    calendar: 'SOLAR' as const,
    // giữ nguyên cả năm sinh: lặp hàng năm chỉ dùng phần MM-DD, nhưng có năm
    // thì mới biết người ta tròn bao nhiêu tuổi
    solarDate: user.birthday,
    yearly: true,
    endDate: null,
    lunarDay: null,
    lunarMonth: null,
    lunarLeap: false,
  }

  if (existing) {
    const sameDay = existing.solarDate === user.birthday
    await db.event.update({ where: { id: existing.id }, data })
    if (!sameDay) {
      // ngày đổi -> lịch nhắc và occurrence cũ không còn đúng
      await clearEventNotifications(existing.id)
      await db.eventOccurrence.deleteMany({ where: { eventId: existing.id } })
    }
  } else {
    await db.event.create({
      data: { ...data, birthdayUserId: userId, remindBeforeDays: REMIND_BEFORE_DAYS, remindAtTime: '08:00' },
    })
  }

  await materializeEventOccurrences()
  await materializeEvents()
}
