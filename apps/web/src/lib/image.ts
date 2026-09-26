/**
 * Nén ảnh ngay trên máy trước khi gửi lên.
 *
 * Ảnh chụp từ điện thoại thường 3–8MB, mà cái cần lưu chỉ là "đọc được đề
 * bài". Thu về 1600px cạnh dài và JPEG chất lượng 0.8 cho ra ~200–400KB: đủ
 * nét để đọc chữ trên bảng, mà DB (nơi ảnh được lưu, xem model StudyAttachment)
 * không phình lên và mạng nhà cũng không nghẹn khi con ngồi ở lớp.
 */
const MAX_EDGE = 1600
const QUALITY = 0.8

export type PreparedImage = {
  mime: 'image/jpeg'
  /** base64, KHÔNG có tiền tố data: */
  data: string
  width: number
  height: number
  /** kích thước sau nén, byte — để hiện cho người dùng và chặn sớm nếu quá to */
  size: number
  /** dùng cho thẻ <img> xem trước, chưa cần lên mạng */
  previewUrl: string
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Không đọc được ảnh'))
    }
    img.src = url
  })
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) throw new Error('Chỉ nhận tệp ảnh')
  const img = await loadImage(file)

  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
  const width = Math.max(1, Math.round(img.naturalWidth * scale))
  const height = Math.max(1, Math.round(img.naturalHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Trình duyệt không hỗ trợ xử lý ảnh')
  // ảnh chụp giấy hay có nền trong suốt sau khi xoay/cắt; JPEG không có kênh
  // alpha nên tô trắng trước, nếu không phần đó ra màu đen
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)

  const dataUrl = canvas.toDataURL('image/jpeg', QUALITY)
  const data = dataUrl.slice(dataUrl.indexOf(',') + 1)
  // base64 dài 4 ký tự cho mỗi 3 byte; trừ phần đệm '=' ở cuối
  const size = Math.round((data.length * 3) / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0)

  return { mime: 'image/jpeg', data, width, height, size, previewUrl: dataUrl }
}
