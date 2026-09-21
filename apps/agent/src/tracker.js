/**
 * Cộng dồn thời lượng theo app trong ngày. Phần này thuần logic, không đụng
 * hệ điều hành lẫn mạng — nhờ vậy test được toàn bộ mà không cần máy thật.
 *
 * Đơn vị lưu trong bộ nhớ là **giây**; chỉ quy ra phút lúc gửi. Mẫu lấy mỗi
 * 20 giây, làm tròn sang phút ngay từ đầu thì phần lẻ của mỗi lần chuyển app
 * mất sạch, và cuối ngày tổng hụt đi hàng chục phút.
 */

/** Việt Nam: UTC+7 cố định, không DST. Giống hệt quy ước của server. */
const VN_OFFSET_MS = 7 * 60 * 60_000

/** Ngày "YYYY-MM-DD" theo giờ VN. Server lưu ngày theo giờ VN, agent phải khớp. */
export function vnDate(now = Date.now()) {
  return new Date(now + VN_OFFSET_MS).toISOString().slice(0, 10)
}

export class Tracker {
  /** @param {string} [date] ngày đang cộng dồn */
  constructor(date = vnDate()) {
    this.date = date
    /** @type {Map<string, number>} tên app -> số giây */
    this.seconds = new Map()
  }

  /**
   * Ghi nhận `sec` giây cho app đang active.
   *
   * @param {string|null} app tên app, null khi không xác định được hoặc máy đang rảnh
   * @param {number} sec
   * @param {number} [now]
   * @returns {{date: string, samples: Array<{app: string, minutes: number}>}|null}
   *   ngày vừa kết thúc, nếu lần gọi này vắt qua nửa đêm — người gọi phải gửi
   *   nốt nó đi trước khi bỏ. Không trả về thì không có gì kết thúc.
   */
  add(app, sec, now = Date.now()) {
    const today = vnDate(now)
    let finished = null

    if (today !== this.date) {
      // Qua ngày mới. Trả lại ngày cũ để gửi lần cuối — nếu chỉ reset, phần
      // dùng máy sau lần gửi cuối cùng của hôm qua sẽ mất luôn.
      finished = this.seconds.size > 0 ? this.report() : null
      this.date = today
      this.seconds = new Map()
    }

    if (app && sec > 0) {
      this.seconds.set(app, (this.seconds.get(app) ?? 0) + sec)
    }
    return finished
  }

  /**
   * Báo cáo hiện tại, dạng server chờ nhận: **tổng cộng dồn của cả ngày**,
   * không phải phần chênh so với lần gửi trước.
   */
  report() {
    const samples = []
    for (const [app, sec] of this.seconds) {
      const minutes = Math.round(sec / 60)
      // Dưới 30 giây thì làm tròn thành 0; gửi đi chỉ tổ làm rác báo cáo.
      if (minutes > 0) samples.push({ app, minutes })
    }
    samples.sort((a, b) => b.minutes - a.minutes)
    return { date: this.date, samples }
  }

  toJSON() {
    return { date: this.date, seconds: Object.fromEntries(this.seconds) }
  }

  /**
   * Dựng lại từ file trạng thái.
   *
   * Cần cho đúng tính "gửi tổng cả ngày": agent khởi động lại lúc 3 giờ chiều
   * mà quên sạch buổi sáng thì lần gửi tiếp theo sẽ **xoá** buổi sáng khỏi
   * server, vì server lấy số mới đè số cũ.
   *
   * Trạng thái của ngày khác hôm nay thì bỏ — nó đã được gửi xong rồi.
   */
  static fromJSON(raw, now = Date.now()) {
    const today = vnDate(now)
    const t = new Tracker(today)
    if (!raw || typeof raw !== 'object' || raw.date !== today) return t
    for (const [app, sec] of Object.entries(raw.seconds ?? {})) {
      if (typeof sec === 'number' && Number.isFinite(sec) && sec > 0) t.seconds.set(app, sec)
    }
    return t
  }
}
