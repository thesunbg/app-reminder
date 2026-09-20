# Family Hub — Kế hoạch xây dựng

Ứng dụng nhắc việc + quản lý gia đình cá nhân hoá (1 gia đình, ~4-6 tài khoản).

---

## 1. Quyết định nền tảng

### Kết luận: **PWA (web app) trước → đóng gói Capacitor thành app iOS/Android ở phase sau**

Lý do, xét theo từng ràng buộc thực tế:

| Ràng buộc | Web thuần | PWA | App native/Capacitor | Desktop (Tauri/Electron) |
|---|---|---|---|---|
| Nhắc đúng giờ khi không ngồi máy | ✗ | ~ (iOS yếu) | ✓ | ✗ |
| Cài lên cả điện thoại + máy tính, 1 codebase | ✓ | ✓ | ✓ (+web) | ✗ |
| Nhập liệu nhanh bằng giọng nói | ✓ (Web Speech) | ✓ | ✓ (tốt hơn) | ✓ |
| Nhật ký tự động từ thao tác máy tính | ✗ | ✗ | ✗ | ✓ |
| Giám sát máy của con (chặn app, screen time) | ✗ | ✗ | ✗ | ✓ (nhưng rất tốn công) |
| Công sức phát triển | thấp | thấp | +1 tuần | +nhiều |

**Điểm mấu chốt là notification.** Đây là thứ quyết định app sống hay chết, chứ không phải UI.

- Android + desktop: Web Push (VAPID) hoạt động tốt, đủ dùng ngay.
- iOS: Web Push chỉ chạy khi PWA đã "Add to Home Screen" (iOS 16.4+), và độ tin cậy **không cao** — iOS có thể throttle/ngủ. Không có local notification lên lịch chính xác.
- → **Giải pháp phase 1: dùng Telegram Bot làm kênh nhắc chính.** Server bắn tin nhắn Telegram, 100% đến nơi, miễn phí, không cần APNs/Firebase, không cần app store, cả nhà dùng được ngay trong 1 ngày. Web Push là kênh phụ.
- → **Phase 7: bọc Capacitor** để có APNs/FCM thật + local notification. Tái sử dụng ~95% code React, không viết lại.

**Không chọn desktop làm nền tảng chính**: nhắc nhở phải theo bạn ra khỏi nhà. Nhưng desktop vẫn có chỗ đứng ở 2 việc — nhật ký tự động và giám sát máy con — xử lý bằng 1 agent nhỏ riêng (phase 8), không phải app chính.

### Cảnh báo quan trọng về "kiểm soát máy của con"

Tự viết phần mềm giám sát/chặn trên macOS hoặc Windows là một dự án riêng rất nặng: cần quyền hệ thống (TCC/Accessibility trên macOS, driver/service trên Windows), phải ký + notarize, và con bạn lớn lên sẽ tìm cách gỡ được.

Khuyến nghị chia 2 lớp:
- **Lớp cưỡng chế (hard control)**: dùng sẵn **Apple Screen Time / Family Sharing** hoặc **Microsoft Family Safety** / **Google Family Link**. Miễn phí, chạy ở tầng OS, không gỡ được.
- **Lớp theo dõi & đồng hành (app của bạn làm)**: thời khoá biểu, bài tập, tự đánh giá, điểm số, tiến độ, biểu đồ, phụ huynh xem dashboard. Đây mới là phần tạo giá trị và không trùng với OS.

Phase 8 (tuỳ chọn) có thể làm 1 agent Tauri nhẹ chạy trên máy con, chỉ **đọc** app đang active + thời lượng rồi gửi về server — đủ để có báo cáo "hôm nay con dùng 3h YouTube", không cần chặn.

---

## 2. Kiến trúc & stack đề xuất

```
┌─────────────────────────────────────────────┐
│  Client: React + TypeScript + Vite (PWA)    │
│  Tailwind + shadcn/ui, TanStack Query       │
│  Web Speech API (voice) · Recharts (biểu đồ)│
└────────────────┬────────────────────────────┘
                 │ REST/tRPC + WebSocket
┌────────────────▼────────────────────────────┐
│  Server: Node 22 + Fastify (hoặc NestJS)    │
│  Prisma + PostgreSQL                        │
│  Scheduler worker (BullMQ + Redis)          │
│  LLM parser (Claude API) cho lệnh giọng nói │
└────────────────┬────────────────────────────┘
                 │
     ┌───────────┴───────────┬──────────────┐
 Telegram Bot          Web Push (VAPID)   FCM/APNs
 (phase 1)             (phase 1)          (phase 7)
```

### Lựa chọn stack

| Thành phần | Đề xuất | Ghi chú |
|---|---|---|
| Frontend | React 19 + TS + Vite + `vite-plugin-pwa` | Offline-first, cài được lên home screen |
| UI | Tailwind + shadcn/ui | Nhanh, đẹp sẵn, responsive |
| State/data | TanStack Query + Zustand | |
| Backend | Fastify + tRPC + Prisma | Type-safe end-to-end với frontend |
| DB | PostgreSQL 16 | Self-host Docker trên VPS ~5$/tháng |
| Queue/scheduler | ~~BullMQ + Redis~~ → **bảng `Notification` + timer trong tiến trình** | Đổi khi làm phase 1: bảng thông báo với `FOR UPDATE SKIP LOCKED` đã là hàng đợi bền vững và atomic. Thêm Redis chỉ tạo nguồn sự thật thứ hai và một service nữa phải giữ sống, không được lợi gì ở quy mô 6 người. |
| Auth | Lucia / Auth.js, session cookie | Đủ cho phạm vi gia đình |
| Âm lịch | Thuật toán **Hồ Ngọc Đức** (múi giờ UTC+7) | **Không dùng thư viện lịch Trung Quốc** — lệch ngày do UTC+8 |
| Lặp lại (dương) | `rrule.js` (RFC 5545) | |
| Biểu đồ | Recharts (hoặc ECharts nếu cần nặng) | |
| Giọng nói | Web Speech API → Claude API (tool use) | STT trên máy, hiểu ý bằng LLM |
| Deploy | Docker Compose trên VPS + Caddy (HTTPS tự động) | |

**Phương án thay thế nếu muốn nhanh hơn nữa**: dùng **Supabase** (Postgres + Auth + Realtime + RLS + Edge Functions + pg_cron) thay cho toàn bộ backend tự viết. Tiết kiệm ~2-3 tuần, đổi lại phụ thuộc nhà cung cấp và scheduler kém linh hoạt hơn BullMQ. Dữ liệu gia đình nhạy cảm → nếu bạn thích tự chủ hoàn toàn thì chọn self-host.

---

## 3. Mô hình dữ liệu (phác thảo)

```
family(id, name, timezone='Asia/Ho_Chi_Minh')
user(id, family_id, name, role: PARENT|CHILD, birthday, telegram_chat_id)
device(id, user_id, push_subscription, platform)

-- Nhóm 1: việc hàng ngày theo thời khoá biểu
routine(id, family_id, owner_id, title, category, duration_min,
        rrule, time_of_day, target_per_week, active, color)
task_log(id, routine_id, date, status: DONE|SKIPPED|PARTIAL,
         actual_minutes, note, completed_at)      -- checklist hằng ngày

-- Nhóm 2: sự kiện định kỳ (giỗ âm lịch, sinh nhật dương lịch)
event(id, family_id, title, type: DEATH_ANNIV|BIRTHDAY|OTHER,
      calendar: LUNAR|SOLAR,
      lunar_day, lunar_month, lunar_leap, solar_date,
      remind_before_days int[],  -- vd [7,3,1,0]
      person_note)
event_occurrence(id, event_id, year, resolved_solar_date)  -- cache đã quy đổi

-- Nhóm 3: ghi chú / bảo dưỡng có hạn
todo(id, family_id, owner_id, title, detail, due_date,
     remind_before_days int[], recur_interval_days,   -- vd thay dầu mỗi 180 ngày
     status: OPEN|DONE, done_at)

-- Nhóm 4: nhật ký
diary_entry(id, user_id, date, content, mood,
            source: MANUAL|AUTO_TASK|AUTO_DEVICE, ref_id)

-- Nhóm 5: theo dõi con
class_schedule(id, child_id, weekday, period, subject, room, teacher,
               start_time, end_time, effective_from, effective_to)
study_record(id, child_id, subject, kind: HOMEWORK|EXAM|SCORE,
             title, score, max_score, date, note)
screen_report(id, child_id, date, app, minutes)    -- phase 8

-- Hạ tầng nhắc
notification(id, user_id, kind, ref_table, ref_id,
             fire_at, channels text[], status, sent_at, payload)
```

Nguyên tắc: **mọi thứ cần nhắc đều đẻ ra dòng trong `notification` với `fire_at` (UTC)**. Worker chỉ quét đúng một bảng này → đơn giản, dễ debug, dễ retry.

### Xử lý âm lịch cần lưu ý
- Quy đổi theo múi giờ **UTC+7** (Việt Nam), khác lịch Trung Quốc (UTC+8) — có những năm lệch nhau 1 ngày.
- Tháng nhuận: ngày giỗ rơi vào tháng nhuận → cần chính sách rõ (thường cúng theo tháng thường).
- Ngày 30 âm: có tháng chỉ 29 ngày → fallback về ngày 29.
- Chạy job mỗi đầu năm dương lịch để sinh `event_occurrence` cho 2 năm tới.

---

## 4. Lộ trình triển khai

Ước lượng theo kiểu làm ngoài giờ, ~10-15h/tuần.

| Phase | Nội dung | Thời gian | Kết quả dùng được |
|---|---|---|---|
| ~~**0**~~ | ✅ Scaffold repo, DB, auth, model `family`/`user` | xong | Đăng nhập được |
| ~~**1**~~ | ✅ Routine + checklist hằng ngày + **notification engine** + kênh Telegram | xong | **Đã nhắc được việc hàng ngày — dùng thật từ đây** |
| ~~**2**~~ | ✅ Event âm/dương lịch + nhắc trước N ngày | xong | Không quên giỗ, sinh nhật |
| ~~**3**~~ | ✅ Ghi chú kiểu Google Keep — văn bản, checklist, màu, nhãn, ghim, lưu trữ, chia sẻ, và nhắc nhở tuỳ chọn có lặp (bao trùm "thay dầu xe ngày xxx"). ✅ Nhật ký viết tay + tự tổng hợp từ thao tác | xong | Đủ bộ cá nhân |
| **4** | Biểu đồ thống kê (streak, giờ học/tuần, tỉ lệ hoàn thành, heatmap) | 4 ngày | Nhìn thấy tiến bộ |
| **5** | Tài khoản con, thời khoá biểu, điểm/bài tập, dashboard phụ huynh | 1.5 tuần | Theo dõi được con |
| **6** | Nhập bằng giọng nói + LLM parse thành lệnh | 1 tuần | Nhập siêu nhanh |
| **7** | Bọc Capacitor → app iOS/Android, push native, local notification | 1 tuần | App thật trên điện thoại |
| **8** | *(tuỳ chọn)* Agent desktop Tauri: báo cáo app usage, auto-diary từ máy | 1-2 tuần | Nhật ký tự động, báo cáo máy con |

**Tổng: ~9-10 tuần để có bản hoàn chỉnh; ~3 tuần đã có bản dùng thật hàng ngày.**

Nguyên tắc: không làm UI đẹp trước phase 4. Làm đúng engine nhắc nhở trước — đó là phần khó và là lý do tồn tại của app.

---

## 5. Chi tiết vài phần khó

### 5.1 Notification engine
- Mỗi routine/event/todo khi tạo hoặc sửa → sinh trước các bản ghi `notification` cho 30 ngày tới.
- Job `hourly-materialize` bù thêm lịch cho tương lai.
- Job `minute-dispatch`: `SELECT ... WHERE fire_at <= now() AND status='PENDING' FOR UPDATE SKIP LOCKED` → gửi qua các kênh → ghi `sent_at`.
- Retry 3 lần, backoff; log thất bại để không im lặng mất nhắc.
- Nhắc theo mức độ: nhắc trước 10 phút → nhắc lúc đến giờ → nếu chưa tick thì nhắc lại sau 30 phút (nag mode, bật/tắt được).

### 5.2 Giọng nói
1. Bấm nút mic → `webkitSpeechRecognition` với `lang='vi-VN'` → ra text.
2. Gửi text + ngày giờ hiện tại lên server.
3. Server gọi Claude API với **tool use**: các tool `create_routine`, `create_event`, `create_todo`, `add_diary`, `mark_done`, `query_stats`.
4. Trả về bản xem trước → bạn xác nhận 1 chạm → lưu.

Ví dụ: *"Nhắc tôi thay dầu xe ngày 15 tháng sau, trước 3 ngày báo tôi"* → tool `create_todo(title="Thay dầu xe", due_date=..., remind_before_days=[3,0])`.

Đừng viết regex parse tiếng Việt — LLM làm việc này tốt hơn gấp nhiều lần và code ngắn hơn.

### 5.3 Nhật ký tự động
Ba nguồn, tăng dần độ phức tạp:
1. **Từ chính app** (phase 3, dễ): cuối ngày tự tổng hợp "đã hoàn thành: học tiếng Anh 60', học tiếng Trung 45'..." thành 1 entry nháp, bạn sửa/bổ sung.
2. **Từ agent desktop** (phase 8): app nào active bao lâu → gom nhóm thành "làm việc 4h, giải trí 1h".
3. **Từ nguồn ngoài** (sau): Git commit, Google Calendar, Health app — chỉ làm nếu thực sự cần.

### 5.4 Quyền trong gia đình
- Phụ huynh: xem/sửa mọi thứ của con, nhận báo cáo tuần.
- Con: chỉ thấy dữ liệu của mình + việc chung của gia đình; nhật ký của con nên có chế độ **riêng tư** (phụ huynh thấy có entry và độ dài, không thấy nội dung) — sẽ giúp con thực sự viết thay vì viết cho bố mẹ đọc. Đây là quyết định về giá trị nuôi dạy, bạn cân nhắc.

---

## 6. Rủi ro cần canh

| Rủi ro | Giảm thiểu |
|---|---|
| iOS nuốt/hoãn Web Push | Telegram làm kênh chính từ phase 1 |
| Sai ngày âm lịch | Dùng thuật toán Hồ Ngọc Đức + viết unit test đối chiếu 20 mốc giỗ/lễ đã biết |
| Sai múi giờ/DST | Lưu toàn bộ UTC, hiển thị theo `Asia/Ho_Chi_Minh`, test quanh mốc nửa đêm |
| Làm quá nhiều tính năng rồi bỏ dở | Bám phase 1 → dùng thật → mới làm tiếp |
| Con thấy bị giám sát, phản ứng | Minh bạch: nói rõ app ghi nhận gì; giữ nhật ký con riêng tư |
| Mất dữ liệu | `pg_dump` hằng đêm lên object storage, kiểm tra restore 1 lần/tháng |

---

## 7. Quyết định đã chốt (2026-09-20)

| Mục | Chốt | Hệ quả |
|---|---|---|
| Điện thoại | **Hỗn hợp iOS + Android** | Web Push một mình không đủ → **Telegram là kênh nhắc bắt buộc từ phase 1**. Phase 7 (Capacitor) là *bắt buộc*, không phải tuỳ chọn, nếu muốn nhắc chuẩn trên iPhone. |
| Hạ tầng | **Self-host VPS + Docker** | Postgres + Fastify + BullMQ + Redis + Caddy. Bắt buộc có backup `pg_dump` hằng đêm ngay từ phase 0. |
| Kênh nhắc | **Telegram Bot** | Làm trong phase 1. Web Push là kênh phụ cho desktop. |
| Con | Tiểu học, sắp lên cấp 2, **sẽ có máy tính + điện thoại riêng** | Phase 5 làm đầy đủ (tài khoản riêng + tự nhập bài tập). Phase 8 (agent báo cáo app usage) có giá trị thực → nâng từ "tuỳ chọn" lên "nên làm". |

### Điều chỉnh lộ trình theo quyết định trên

- **Phase 0 thêm**: cron `pg_dump` → object storage, và kiểm tra restore được.
- **Phase 7 (Capacitor) nâng độ ưu tiên**: vì có iPhone trong nhà, cân nhắc kéo lên làm ngay sau phase 4 thay vì cuối cùng. Cần Apple Developer Program (99$/năm) để cài lên iPhone lâu dài — nếu không muốn trả, dùng free provisioning nhưng phải cài lại app mỗi 7 ngày (rất phiền) → khi đó cứ ở lại PWA + Telegram.
- **Phase 8 chuyển thành nên làm**: con sắp có máy riêng ở tuổi bắt đầu tự chủ. Nhưng vẫn giữ nguyên tắc ở mục 1: chặn/giới hạn giao cho Screen Time & Family Link; agent của bạn chỉ **đọc và báo cáo**, không chặn.

### Về việc cấp máy riêng cho con ở tuổi này

Gợi ý thiết lập, theo thứ tự làm:
1. Tạo Apple ID / Google account cho con **dưới Family Sharing / Family Link** ngay từ đầu — sau này chuyển sang khó hơn nhiều.
2. Bật Screen Time / Family Link với giới hạn giờ và duyệt cài app. Đây là lớp cưỡng chế.
3. App của bạn làm lớp đồng hành: thời khoá biểu, bài tập, tick hoàn thành, biểu đồ tiến độ.
4. Nói rõ với con app ghi nhận những gì. Ở tuổi 10-12, minh bạch giữ được lòng tin; phát hiện ra bị theo dõi ngầm thì mất hẳn.
5. Giữ nhật ký của con ở chế độ riêng tư (bố mẹ thấy *có viết*, không thấy *viết gì*) — nếu không, con sẽ viết cho bố mẹ đọc chứ không viết cho mình.
