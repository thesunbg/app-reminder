# Family Hub — vỏ app điện thoại (Capacitor)

Phase 7. Bọc PWA thành app iOS/Android thật để có **push native** (APNs/FCM)
và **local notification** — hai thứ Web Push trên iPhone không làm nổi.

Code chạy trong app chính là `apps/web`; thư mục này chỉ có cấu hình vỏ và các
dự án native do `cap add` sinh ra.

> **Chưa build lần nào.** Phần server (kênh FCM) đã có test và chạy được; phần
> dưới đây cần máy macOS có Xcode và/hoặc Android Studio, chưa có trên máy dev
> hiện tại. Coi đây là hướng dẫn đã viết sẵn, chưa phải quy trình đã kiểm chứng.

## Phải có trước

| Cần | Cho | Ghi chú |
|---|---|---|
| Android Studio + JDK 21 | Android | Miễn phí |
| Xcode 16 + macOS | iOS | Chỉ chạy trên máy Mac |
| Apple Developer Program | iOS, cài lâu dài | **99 USD/năm** |
| Một project Firebase | Push cả hai nền | Miễn phí |

Không có tài khoản Apple trả phí thì vẫn cài được lên iPhone bằng *free
provisioning*, nhưng **app hết hạn sau 7 ngày** và phải cắm máy cài lại. Với
một app để nhắc việc thì như vậy là vô dụng — khi đó cứ ở lại PWA + Telegram.

## Thiết lập Firebase (làm một lần)

1. Tạo project ở <https://console.firebase.google.com>.
2. **Android**: Add app → package name `com.nguyenvando.familyhub` → tải
   `google-services.json` → đặt vào `apps/mobile/android/app/`.
3. **iOS**: Add app → bundle ID `com.nguyenvando.familyhub` → tải
   `GoogleService-Info.plist` → kéo vào Xcode (thư mục `App/App`).
4. **iOS, APNs key**: Apple Developer → Keys → tạo key có *Apple Push
   Notifications service* → tải file `.p8` (chỉ tải được **một lần**) → Firebase
   → Project settings → Cloud Messaging → upload key kèm Key ID và Team ID.
5. **Server**: Project settings → Service accounts → *Generate new private key*
   → mở file JSON, nén thành một dòng, dán vào `FCM_SERVICE_ACCOUNT` trong
   `/data/app-reminder/deploy/.env` trên VPS (bọc nháy đơn), rồi
   `docker-compose up -d server`.

Kiểm tra: mở app → Cài đặt → Kênh nhắc nhở → *Thông báo trên app điện thoại* →
**Gửi thử**. Không hiện mục đó nghĩa là server chưa nhận `FCM_SERVICE_ACCOUNT`.

Các file `google-services.json`, `GoogleService-Info.plist` và `.p8` **không
đưa lên git** — `.gitignore` đã chặn sẵn.

## Build

```bash
cd apps/mobile
pnpm install

pnpm add:android      # sinh thư mục android/ (một lần)
pnpm add:ios          # sinh thư mục ios/ (một lần, cần macOS)

pnpm sync             # build apps/web rồi cap sync
pnpm open:android     # mở Android Studio → Run
pnpm open:ios         # mở Xcode → chọn Team ở tab Signing → Run
```

Android còn cần thêm vào `android/app/build.gradle`:

```gradle
apply plugin: 'com.google.gms.google-services'
```

và vào `android/build.gradle`, khối `dependencies` của `buildscript`:

```gradle
classpath 'com.google.gms:google-services:4.4.2'
```

`cap add` không tự thêm hai dòng này, thiếu thì app chạy được nhưng **không
bao giờ lấy được token push** — và lỗi báo ra rất khó đoán.

## App nạp nội dung từ đâu

Mặc định app nạp thẳng <https://reminder.nguyenvando.com> (`server.url` trong
`capacitor.config.ts`) chứ không gói bản build vào máy. Lý do và cách đổi nằm
trong chú thích đầu file đó — tóm tắt: giữ nguyên origin thì cookie đăng nhập
và passkey chạy y như trên trình duyệt, và sửa giao diện không phải build lại
app.

Trỏ sang máy khác khi cần thử:

```bash
CAP_SERVER_URL=http://192.168.1.10:5173 pnpm sync
```

## Nhắc nhở hoạt động thế nào trong app

Hai đường song song, cố ý chồng nhau:

- **Push (FCM)** — server bắn từ `apps/server/src/lib/fcm.ts`. Nội dung luôn
  mới (tổng kết cuối ngày được tính lại lúc gửi), nhưng cần mạng.
- **Local notification** — app xin trước 3 ngày lịch nhắc qua `notify.upcoming`
  rồi tự đặt trên máy. Hệ điều hành bắn đúng giờ kể cả không mạng, kể cả app
  bị kill.

Trùng nội dung thì hệ điều hành gộp lại theo `thread-id`/`group` — người dùng
thấy một dòng. Đăng xuất thì lịch cục bộ bị xoá sạch, để máy không nhắc việc
của người vừa đăng xuất.

Giới hạn cần nhớ: **iOS chỉ giữ 64 local notification đang chờ cho mỗi app**,
xin nhiều hơn thì phần thừa bị bỏ im lặng. Vì vậy `notify.upcoming` chặn ở 60.
