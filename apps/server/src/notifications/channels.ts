/**
 * Một chỗ duy nhất quyết định "người này nhận nhắc qua kênh nào".
 *
 * Trước đây phép tính này nằm rải rác ở sáu file materialize; thêm một kênh
 * là phải sửa đủ sáu chỗ và quên một chỗ thì im lặng mất nhắc. Giờ gom lại đây.
 */

/** Phần thông tin tối thiểu cần để tính kênh — đủ cho cả `select` lẫn bản ghi đầy đủ. */
export type ChannelPrefs = {
  notifyTelegram: boolean
  notifyWebPush: boolean
  notifyNative: boolean
  telegramChatId: string | null
}

/** Các trường cần `select` khi truy vấn user để gọi `plannedChannels`. */
export const channelSelect = {
  notifyTelegram: true,
  notifyWebPush: true,
  notifyNative: true,
  telegramChatId: true,
} as const

/**
 * Kênh dự kiến lúc **sinh lịch**. Đây chỉ là dự đoán: `dispatch` tính lại lúc
 * gửi vì thông báo sinh trước tới 14 ngày và người dùng có thể liên kết
 * Telegram hay cài app trong khoảng đó.
 *
 * Giá trị thật sự quan trọng là mảng **rỗng hay không** — rỗng thì không sinh
 * thông báo, vì người đó đã tắt hết mọi kênh.
 */
export function plannedChannels(u: ChannelPrefs): string[] {
  const channels: string[] = []
  if (u.notifyTelegram && u.telegramChatId) channels.push('telegram')
  if (u.notifyWebPush) channels.push('webpush')
  if (u.notifyNative) channels.push('native')
  return channels
}
