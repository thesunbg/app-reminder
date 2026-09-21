/**
 * Gửi báo cáo lên server.
 *
 * Không có hàng đợi ngoài, không thử lại theo kiểu phức tạp: báo cáo là **tổng
 * cộng dồn của cả ngày**, nên một lần gửi hỏng chỉ có nghĩa là lần gửi sau
 * (5 phút nữa) mang theo đủ cả phần vừa hụt. Xây retry ở đây là giải một bài
 * toán mà thiết kế dữ liệu đã giải rồi.
 */

export class AgentClient {
  /**
   * @param {string} server ví dụ https://reminder.nguyenvando.com
   * @param {string} token token của máy, lấy ở Cài đặt → Máy tính
   */
  constructor(server, token) {
    this.base = server.replace(/\/+$/, '')
    this.token = token
  }

  get headers() {
    return { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' }
  }

  /** Kiểm tra token lúc khởi động, để sai thì báo ngay chứ không im lặng cả ngày. */
  async ping() {
    const res = await fetch(`${this.base}/agent/ping`, { headers: this.headers })
    if (res.status === 401) throw new Error('Token không hợp lệ — tạo lại ở Cài đặt → Máy tính')
    if (!res.ok) throw new Error(`Server trả ${res.status}`)
    return res.json()
  }

  /**
   * @param {{date: string, samples: Array<{app: string, minutes: number}>}} report
   * @returns {Promise<number>} số dòng server đã ghi
   */
  async send(report) {
    const res = await fetch(`${this.base}/agent/report`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(report),
    })
    if (res.status === 401) throw new Error('Token không còn hiệu lực — máy có thể đã bị gỡ')
    if (!res.ok) throw new Error(`Server trả ${res.status}: ${await res.text().catch(() => '')}`)
    const body = await res.json()
    return body.rows ?? 0
  }
}
