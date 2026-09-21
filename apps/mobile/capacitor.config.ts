import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Vỏ native cho PWA (Phase 7).
 *
 * **Mặc định: nạp thẳng site thật** (`server.url`) thay vì gói bản build vào
 * app. Lý do rất thực tế với một app gia đình:
 *
 *  - Session dùng cookie. Nếu webview chạy ở `capacitor://localhost` mà gọi
 *    API sang `reminder.nguyenvando.com` thì đó là cookie bên thứ ba —
 *    Safari trên iOS chặn thẳng tay. Nạp cùng origin thì cookie chạy y như
 *    trên trình duyệt, không phải đổi sang token và viết lại tầng đăng nhập.
 *  - Sửa giao diện chỉ cần push lên main, cron trên VPS deploy như cũ. Không
 *    phải build lại app và không phải đợi App Store duyệt.
 *  - Passkey (WebAuthn) gắn rpID theo `WEB_ORIGIN`; giữ đúng origin thì
 *    passkey đã đăng ký vẫn dùng được trong app.
 *
 * Đổi lại: mở app lần đầu phải có mạng. Chấp nhận được, vì phần nhắc đúng giờ
 * khi mất mạng đã do local notification lo (xem apps/web/src/lib/native.ts),
 * và service worker của PWA vẫn cache được vỏ giao diện.
 *
 * Muốn đóng gói offline hoàn toàn: bỏ khối `server.url` bên dưới, chạy
 * `pnpm sync` (build apps/web vào `webDir`), rồi chuyển đăng nhập sang token
 * thay cho cookie. Đừng chỉ bỏ `server.url` — đăng nhập sẽ hỏng.
 */
const SERVER_URL = process.env.CAP_SERVER_URL ?? 'https://reminder.nguyenvando.com'

const config: CapacitorConfig = {
  appId: 'com.nguyenvando.familyhub',
  appName: 'Family Hub',
  // Chỉ dùng khi bỏ server.url ở dưới. `pnpm sync` sẽ đổ bản build vào đây.
  webDir: '../web/dist',
  server: {
    url: SERVER_URL,
    // HTTPS thật; không cho phép nội dung http lẫn vào.
    cleartext: false,
    // Điều hướng ra ngoài hai domain này thì mở trình duyệt hệ thống, không
    // mở trong app — để link lạ trong ghi chú không chạy trong ngữ cảnh đã
    // đăng nhập của app.
    allowNavigation: ['reminder.nguyenvando.com'],
  },
  ios: {
    // Thanh trạng thái và vùng tai thỏ do CSS của web lo (env(safe-area-inset-*))
    contentInset: 'always',
  },
  android: {
    // Không cho webview nhận nội dung http — kể cả ảnh nhúng trong ghi chú.
    allowMixedContent: false,
  },
  plugins: {
    PushNotifications: {
      // Hiện banner + kêu + đếm badge ngay cả khi app đang mở.
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#4f46e5',
    },
  },
}

export default config
