# Family Hub

Ứng dụng nhắc việc và quản lý gia đình. PWA chạy trên điện thoại lẫn máy tính,
backend tự chủ trên VPS. Kế hoạch đầy đủ: [docs/PLAN.md](docs/PLAN.md).

## Trạng thái

| Phase | Nội dung | Trạng thái |
|---|---|---|
| 0 | Monorepo, DB, auth, model gia đình | ✅ xong |
| 1 | Việc định kỳ + checklist + thống kê + **engine nhắc + Telegram + Web Push** | ✅ xong |
| 2 | Giỗ âm lịch / sinh nhật / **sự kiện nhiều ngày có giờ** + nhắc trước N ngày; **lịch tháng dương ↔ âm** có sự kiện | ✅ xong |
| 3 | Ghi chú kiểu Keep (bao gồm nhắc bảo dưỡng) | ✅ xong |
| 3b | Nhật ký (viết tay + tự tổng hợp) | ✅ xong |
| 3c | Đăng nhập 2 bước (TOTP), passkey (WebAuthn), tải dữ liệu JSON | ✅ xong |
| 4 | Biểu đồ nâng cao (heatmap, theo tuần/nhóm, theo thứ, lọc thành viên) | ✅ xong |
| 5 | Học tập **theo từng con**: thời khoá biểu, bài tập (môn/hạn tuỳ chọn, ảnh đề bài), điểm, dashboard phụ huynh | ✅ xong |
| 6 | Nhập bằng giọng nói + LLM | ❌ bỏ — chủ nhà quyết định không cần AI, chỉ cần nhắc theo lịch |
| 7 | Push native (FCM) + vỏ Capacitor + local notification | ✅ code xong, **chưa build app lần nào** |
| 8 | Agent máy tính: thời lượng dùng app, nhật ký tự động từ máy | ✅ xong |

Engine nhắc nhở đã chạy: sinh lịch trước 14 ngày (việc hàng ngày) / 60 ngày
(giỗ, sinh nhật), gửi qua Telegram và/hoặc Web Push, tự huỷ khi bạn đã tick
xong, tự thử lại khi gửi hỏng.

Có thêm tổng kết cuối ngày (tuỳ chọn, tự đặt giờ): điểm lại hôm nay làm được
gì và nhắc viết nhật ký. Đây là loại thông báo duy nhất có nội dung tính **lúc
gửi** thay vì lúc sinh lịch — ngày chưa xảy ra thì chưa biết bạn làm được gì.

Nhắc sự kiện chỉ gửi cho thành viên **phụ huynh** — giỗ chạp và sinh nhật là
việc người lớn chuẩn bị, không cần dựng con dậy lúc 8h sáng.

Sự kiện dương lịch có hai dạng: **lặp hàng năm** (sinh nhật, lễ) và **một lần**
(chuyến đi 3–4/10). Cả hai đều có thể **kéo dài nhiều ngày** và ghi **giờ diễn
ra** (5:30–18:00) — giờ này khác `remindAtTime`, là giờ bắn thông báo. Sự kiện
nhiều ngày:

- nhắc theo **ngày bắt đầu** (trước 7/3/1 ngày rồi sáng ngày khởi hành), không
  bắn thêm cho ngày giữa — chuyến 2 ngày mà nhắc 2 lần thì thành ồn;
- hiện ở **mọi ngày nó phủ** trên lịch tháng, ngày tiếp diễn có dấu `↳` và nhãn
  "ngày 2/3"; sự kiện vắt qua biên tháng vẫn hiện đúng ở tháng sau;
- còn nằm trong "Sắp tới" khi **đang diễn ra** (bắt đầu hôm qua, kết thúc mai);
- lặp hàng năm thì được vắt qua giao thừa (28/12 → 2/1), khi đó ngày kết thúc
  được tính sang năm sau.

Giỗ âm lịch không có ngày kết thúc: một ngày giỗ là một ngày.

**Dương lịch là mặc định** ở form thêm sự kiện — phần lớn thứ người ta thêm
(chuyến đi, lịch hẹn, sinh nhật) đều theo dương; âm lịch để dành cho giỗ chạp.
Bấm "+ Thêm sự kiện ngày 3/10" ngay trong ô ngày ở trang Lịch thì form mở ra với
ngày đó điền sẵn và ở chế độ "một lần" (`/su-kien?ngay=YYYY-MM-DD`).

**Sinh nhật đi thẳng từ hồ sơ thành viên.** Khai `birthday` trong Cài đặt →
Gia đình là có ngay một `Event` gắn với người đó qua `birthdayUserId` (một
người tối đa một cái), nên nó dùng chung toàn bộ engine đã có: hiện trên lịch
tháng, nhắc trước 7 ngày / 1 ngày / đúng ngày. Đổi tên hay đổi ngày sinh thì sự
kiện theo kịp; xoá ngày sinh, tắt hoặc gỡ tài khoản thì sự kiện biến mất.
Sự kiện loại này **không sửa hay xoá được ở trang Sự kiện** — cho sửa cả hai
chỗ thì hai nơi sẽ lệch nhau ngay lần đầu ai đó sửa nhầm chỗ.

Ba kênh gửi: **Telegram** (chính), **Web Push** (trình duyệt), và **push
native** qua FCM cho app điện thoại. Kênh nào chưa cấu hình thì tự tắt, app
vẫn chạy. Kênh được tính lại lúc gửi chứ không chốt lúc sinh lịch — xem phần
Quy ước bên dưới.

**App điện thoại (phase 7)** — vỏ Capacitor ở [apps/mobile](apps/mobile/README.md).
Code đã xong và kênh FCM có test, nhưng **chưa build lần nào**: cần máy Mac có
Xcode, Android SDK, và tài khoản Apple Developer (99 USD/năm) để cài lên iPhone
lâu dài. Trong app, nhắc nhở đi hai đường chồng nhau: push từ server (nội dung
mới, cần mạng) và local notification app tự đặt trước 3 ngày (đúng giờ kể cả
mất mạng). Trùng thì hệ điều hành gộp lại.

**Agent máy tính (phase 8)** — [apps/agent](apps/agent/README.md). Tiến trình
nền không có dependency nào, đọc tên app đang dùng và số phút rồi gửi về server.
Kết quả ở **Học tập → Máy tính** và thành một dòng trong nhật ký. Nó chỉ **đọc
và báo cáo** — không chặn, không chụp màn hình, không đọc nội dung cửa sổ. Chặn
và giới hạn giờ giao cho Screen Time / Family Link ở tầng hệ điều hành.

> Con thấy đúng những gì bố mẹ thấy về máy mình, và tự gỡ máy được bất cứ lúc
> nào. Hãy nói với con là máy có cài — lý do ở `docs/PLAN.md` mục 1.

Bảo mật tài khoản (Cài đặt → Bảo mật & dữ liệu):
- **2 bước**: TOTP chuẩn RFC 6238, tự viết ([lib/totp.ts](apps/server/src/lib/totp.ts)),
  bí mật mã hoá AES-GCM bằng `SESSION_SECRET`, 8 mã khôi phục lưu dạng hash.
  Sai 5 lần trong 15 phút thì khoá. Tắt cần cả mật khẩu lẫn mã.
- **Passkey**: `@simplewebauthn`, discoverable credential nên đăng nhập không
  cần gõ email; tự nó là đa yếu tố nên bỏ qua bước TOTP. rpID lấy từ
  `WEB_ORIGIN` — đổi domain là passkey cũ vô hiệu (đúng thiết kế WebAuthn).
- **Tải dữ liệu**: `GET /export` trả JSON theo đúng quyền xem trong app —
  phụ huynh cả nhà, con của mình; nhật ký riêng tư của người khác không lọt ra.

> **Passkey chưa được bấm thử trên thiết bị thật** — server có test đi hết
> đường đăng ký → đăng nhập bằng authenticator phần mềm (ES256), nhưng
> `navigator.credentials.create()` cần cử chỉ người dùng nên không tự động
> hoá được. Hãy thử "+ Thêm" passkey trên điện thoại sau khi deploy.
>
> **Web Push chưa được kiểm chứng trên thiết bị thật.** Luồng server có test,
> nhưng service worker bị chặn trong môi trường sandbox lúc phát triển. Hãy thử
> nút “Gửi thử” trong Cài đặt trên máy/điện thoại của bạn trước khi tin vào nó.
> Telegram thì đã được kiểm chứng bằng test với Bot API giả.
>
> **Push native (FCM) cũng vậy.** Test dùng service account sinh tại chỗ và
> verify chữ ký RS256, nhưng chưa có request nào đi tới Google thật. Đừng coi
> phase 7 là xong cho tới khi bấm “Gửi thử” trên điện thoại thật.

## Yêu cầu

- Node 22 (`nvm use` sẽ tự lấy từ `.nvmrc`)
- pnpm 10
- PostgreSQL 16 đang chạy (`brew services start postgresql@16`)

## Chạy lần đầu

```bash
nvm use
pnpm install

# tạo database + role
createdb family_hub
psql -d postgres -c "CREATE ROLE family_hub LOGIN PASSWORD 'matkhau-cua-ban' CREATEDB;"
psql -d postgres -c "ALTER DATABASE family_hub OWNER TO family_hub;"

# cấu hình
cp apps/server/.env.example apps/server/.env
# sửa DATABASE_URL cho khớp mật khẩu ở trên
# và đặt SESSION_SECRET="$(openssl rand -hex 32)"

pnpm db:migrate
pnpm db:seed      # tuỳ chọn — tạo dữ liệu mẫu 30 ngày
pnpm dev
```

### Bật nhắc qua Telegram

Đây là kênh chính, nên làm ngay:

1. Trên Telegram nhắn cho **@BotFather** → `/newbot` → đặt tên → nhận token.
2. Dán token vào `apps/server/.env`:
   `TELEGRAM_BOT_TOKEN="123456:ABC-DEF..."`
3. Khởi động lại server. Log phải hiện `Telegram bot đã kết nối`.
4. Mở app → **Cài đặt → Kênh nhắc nhở → Lấy mã liên kết**.
5. Nhắn `/start MÃCỦABẠN` cho bot. Xong.

Mỗi thành viên tự lấy mã và liên kết chat riêng của mình. Không có token thì
kênh Telegram đơn giản là tắt, app vẫn chạy bình thường.

- Web: http://localhost:5173
- API: http://localhost:3001 (`/health` để kiểm tra)

Tài khoản mẫu sau khi seed: `bo@giadinh.local` / `matkhau123`
(và `con@giadinh.local` cùng mật khẩu). Nếu không seed, mở web lần đầu sẽ
hiện màn hình khởi tạo gia đình.

## Cấu trúc

```
apps/server/        Fastify + tRPC + Prisma
  prisma/schema.prisma   toàn bộ model
  src/lib/               time (múi giờ VN), recurrence (RRULE), session, password
  src/lib/lunar.ts       âm lịch VN (Hồ Ngọc Đức, UTC+7)
  src/lib/fcm.ts         push native qua FCM HTTP v1 (tự ký JWT service account)
  src/lib/appCategory.ts xếp tên app vào nhóm cho báo cáo thời lượng
  src/notifications/     engine nhắc: channels, materialize, dispatch, scheduler
  src/screen/            nhận báo cáo từ agent máy tính + tổng hợp
  src/diary/             nhật ký tự động (từ việc đã tick và từ máy tính)
  src/trpc/routers/      auth, family, routine, event, note, diary, notify,
                         stats, study, screen
apps/web/           React 19 + Vite + Tailwind 4 + PWA
  src/pages/             Today, Week, Diary, Notes, Events, Calendar, Stats,
                         Study, Routines, Settings, Login
  src/lib/native.ts      cầu nối Capacitor: push token + local notification
apps/mobile/        vỏ Capacitor (iOS/Android) — ngoài pnpm workspace
apps/agent/         agent máy tính, không dependency — ngoài pnpm workspace
deploy/             docker-compose + Caddy + backup cho VPS
docs/PLAN.md        kế hoạch và các quyết định kiến trúc
```

`apps/mobile` và `apps/agent` **cố ý đứng ngoài pnpm workspace**: một cái chỉ
build trên Mac có Xcode, cái kia không cần cài gì. Để chúng trong workspace thì
hai Dockerfile (chỉ copy `package.json` của server/web) sẽ hỏng vì lockfile lệch.

## Quy ước quan trọng

**Múi giờ.** Mọi `DateTime` trong DB là UTC. Mọi "ngày lịch" (ngày của task log,
ngày giỗ, hạn todo) là chuỗi `"YYYY-MM-DD"` **theo giờ VN**, không phải Date.
Lý do: so sánh ngày bằng chuỗi thì không bao giờ lệch múi giờ, còn `Date` thì có.
Dùng helper trong `apps/server/src/lib/time.ts`, đừng tự viết lại.

**Lặp lại.** Dùng RRULE (RFC 5545) qua `rrule.js`. Ngày được neo ở UTC-midnight
như "floating date" để thứ trong tuần luôn khớp lịch VN.

**Âm lịch.** Đã làm ở [lib/lunar.ts](apps/server/src/lib/lunar.ts) bằng thuật
toán Hồ Ngọc Đức (UTC+7). **Đừng thay bằng thư viện lịch Trung Quốc**: chúng
dùng UTC+8 và sẽ báo sai ngày giỗ ở một số năm.

**Phân quyền.** Hai trục tách rời nhau:

- `role` (`PARENT` / `CHILD`) — vai trò trong nhà: con chỉ thấy dữ liệu của
  mình, phụ huynh thấy cả nhà và nhận nhắc giỗ/sinh nhật.
- `isAdmin` — **quyền trên tài khoản**: chỉ quản trị gia đình mới thêm, sửa
  (tên, email, vai trò, ngày sinh, màu), tắt/bật, đặt lại mật khẩu và gỡ hẳn
  thành viên. Phụ huynh còn lại vẫn xem được cả nhà nhưng không đụng vào tài
  khoản người khác.
- **Việc định kỳ**: nhìn thì cả nhà nhìn được, nhưng *tick / sửa / lưu trữ* thì
  chỉ chủ việc — **trừ việc của con, phụ huynh vẫn tick hộ được** (bố mẹ giao
  việc và theo dõi khi con còn nhỏ). Hai phụ huynh không tick hộ nhau: việc tập
  thể dục của người này mà người kia tick thì con số chẳng còn nghĩa gì. Server
  chặn ở `canEditRoutine`, giao diện dùng cờ `canEdit` để khoá nút sẵn thay vì
  để bấm rồi mới báo lỗi.

Người **bootstrap gia đình** là quản trị. Migration `user_is_admin` gán cờ này
cho phụ huynh được tạo sớm nhất của mỗi gia đình — thiếu bước đó thì sau khi
deploy không ai quản lý được thành viên nữa.

Quản trị không tự khoá mình ra ngoài được: không tự tắt tài khoản, không tự hạ
xuống `CHILD`, không tự xoá.

**Gỡ thành viên có hai mức.** *Tắt tài khoản* (`active: false`) cắt đăng nhập
nhưng giữ nguyên nhật ký, ghi chú, lịch sử tick. *Gỡ hẳn* xoá luôn cả người lẫn
dữ liệu (cascade) và **không khôi phục được ngoài backup hằng đêm** — vì vậy
`removeMember` bắt gõ đúng tên để xác nhận, **kiểm ở server** chứ không chỉ ở
giao diện, và giao diện hiện đúng số bản ghi sắp mất trước khi hỏi.

Nhật ký của con mặc định riêng tư — xem lý do ở `docs/PLAN.md` mục 5.4.

**Bài tập ghi nhanh.** Thứ bắt buộc duy nhất là *nội dung* — ô nhập nhiều dòng,
chép nguyên đề vào cũng được. Môn và hạn nộp đều tuỳ chọn: con ghi vội giữa giờ
ra chơi rồi phân loại sau. Bài **không có hạn thì không được nhắc** (engine chỉ
nhìn `date`), nó chỉ nằm trong danh sách chưa xong và luôn xếp cuối; bài không
hạn cũng không bao giờ bị tính là "quá hạn". Bài thi và điểm thì vẫn bắt buộc có
ngày, vì thiếu ngày là không xếp được vào biểu đồ.

**Ảnh đề bài** (tối đa 6 ảnh/bài) lưu **thẳng trong Postgres**, không ra thư mục
trên đĩa: như vậy ảnh đi theo bản dump hằng đêm của `deploy/backup.sh`, không cần
thêm volume, và không có cảnh backup DB thì có mà ảnh thì mất. Trình duyệt nén
ảnh về 1600px/JPEG 0.8 trước khi gửi (`apps/web/src/lib/image.ts`) nên mỗi tấm
chỉ vài trăm KB. Ảnh ra qua `GET /study/anh/:id` — **route REST mới thì phải thêm
một `handle` trong [deploy/Caddyfile](deploy/Caddyfile)**, nếu không nó rơi xuống
nhánh SPA và trả `index.html` kèm mã 200.

**Ghi chú.** Một loại duy nhất (`Note`) phục vụ cả ghi chú tự do, danh sách
việc, và nhắc bảo dưỡng — nhắc nhở chỉ là *trường tuỳ chọn* của ghi chú, không
phải một khái niệm riêng. `recurIntervalDays` làm phần "thay dầu mỗi 180 ngày":
đánh dấu xong thì tự đẻ ghi chú mới cho lần tới.

Ghi chú mặc định **riêng tư của người tạo**; bật `shared` thì cả nhà đọc, tick
checklist và nhận nhắc. Phụ huynh không đọc được ghi chú riêng của con — cùng
lý do với nhật ký, xem `docs/PLAN.md` mục 5.4.

**Nhật ký.** Mỗi ngày có tối đa hai bản ghi: `MANUAL` (bạn viết) và
`AUTO_TASK` (app tự tổng hợp từ việc đã tick, ghi chú đã xong, sự kiện trong
ngày). Hai bản sống song song, bản tự động không bao giờ đè lên thứ bạn viết.

Bản tự động của **ngày đã qua được giữ nguyên**, chỉ ngày hôm nay mới tính lại.
Nếu tính lại mọi lúc thì xoá một routine hôm nay sẽ làm biến mất lịch sử của
tháng trước.

Nhật ký riêng tư theo mặc định, và **chỉ chính chủ đổi được cài đặt này** —
phụ huynh không ép con mở. Bảng "Cả nhà" chỉ hiện có viết hay không, không hiện
nội dung. Lý do ở `docs/PLAN.md` mục 5.4.

**Hàng đợi thông báo.** Bảng `Notification` *là* hàng đợi: mỗi việc cần nhắc
sinh ra một dòng với `fireAt` (UTC), worker nhận việc bằng
`UPDATE ... FOR UPDATE SKIP LOCKED` nên không bao giờ gửi trùng. Không dùng
BullMQ/Redis — xem `apps/server/src/notifications/scheduler.ts` để biết lý do.

**Kênh gửi được tính lại lúc gửi**, không dùng giá trị chốt lúc sinh lịch.
Thông báo sinh trước 14 ngày, người dùng hoàn toàn có thể liên kết Telegram
sau đó; tin vào giá trị cũ thì họ mất nhắc suốt hai tuần.

Thêm một kênh nhắc thì sửa **một chỗ**:
[notifications/channels.ts](apps/server/src/notifications/channels.ts). Trước
đây phép tính này nằm rải rác ở sáu file materialize, quên một chỗ là im lặng
mất nhắc.

**Báo cáo từ agent là "tổng cả ngày", không phải phần chênh lệch.** Agent gửi
tổng cộng dồn nên gửi lại bao nhiêu lần cũng ra cùng kết quả — mất mạng gửi bù
hay agent khởi động lại đều không làm số cộng đôi. Hệ quả bắt buộc: agent phải
ghi trạng thái ra đĩa, nếu không lần bật lại giữa ngày sẽ **xoá** phần đầu ngày
trên server. Khoá unique có cả `deviceId` để hai máy của cùng một người không
đè số nhau.

**Phân loại app ở server, không ở agent.** Sửa
[lib/appCategory.ts](apps/server/src/lib/appCategory.ts) là cả nhà đổi theo, và
`recategorize()` tính lại được dữ liệu cũ vì tên app thô vẫn được giữ nguyên.

## Lệnh hay dùng

```bash
pnpm dev              # chạy cả server + web
pnpm dev:server       # chỉ API
pnpm dev:web          # chỉ web
pnpm typecheck        # kiểm tra kiểu toàn repo
pnpm build            # build production
pnpm db:studio        # Prisma Studio để xem/sửa dữ liệu
pnpm db:migrate       # tạo migration mới sau khi sửa schema
pnpm test             # test server (179, database riêng family_hub_test) + agent (12)
```

Test chạy trên `family_hub_test`, **không dùng chung DB dev** — dev server có
scheduler chạy mỗi 30 giây và sẽ cướp mất thông báo mà test vừa tạo. Các file
test cũng chạy tuần tự (`--test-concurrency=1`) vì cùng đụng một database.

## Deploy (CI/CD)

Production: **https://reminder.nguyenvando.com**

- Push lên `main` → GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml))
  chạy typecheck + test (Postgres riêng trong CI) → build image server/web đẩy lên
  `ghcr.io/thesunbg/app-reminder-*` gắn tag `latest` và `<sha>`.
- **Deploy kiểu pull**: cron 2 phút/lần trên `202.92.6.143` chạy
  [deploy/autodeploy.sh](deploy/autodeploy.sh): `git reset --hard origin/main`
  (repo public, HTTPS) rồi chỉ `up -d` khi image `:<sha>` của HEAD đã có trên
  ghcr.io. Không có secret nào trên GitHub. Từ push tới chạy ≈ 4–6 phút.
  Log: `/var/log/family-hub-deploy.log`. Rollback: sửa `TAG=` trong
  `deploy/.env` rồi `docker-compose up -d`.
- Server **không build** image: kernel CentOS 7 + seccomp Docker 19.03 trả EPERM
  ngẫu nhiên khi `pnpm install`. Cũng vì thế container chạy `seccomp:unconfined`.
- PR nào cũng chạy test — kể cả PR tạo từ Claude trên điện thoại.
- App và nginx **ở cùng máy `202.92.6.143`**. Web container bind
  `127.0.0.1:5599`, không cổng nào của app lộ ra Internet; nginx + certbot lo
  TLS và domain (`/etc/nginx/site-node/reminder.nguyenvando.com.conf`, bản sao
  để đối chiếu: [deploy/nginx-reminder.conf](deploy/nginx-reminder.conf)).
  Trước đây app chạy ở `202.92.6.172` và 143 chỉ proxy sang — gộp về một máy
  bỏ được một chặng mạng và một máy phải trông.
- **Không còn OneShield trước mặt** (tắt proxy 26/09/2026): domain trỏ thẳng về
  `202.92.6.143`, nên nginx tự lo cert riêng cho `reminder.nguyenvando.com`,
  redirect 80→443, HTTP/2 và HSTS. Sửa vhost thì **comment phải ASCII không
  dấu** — certbot 0.31 ở đó chạy Python 2 và chết với `UnicodeDecodeError`.
- Trong container: Caddy serve PWA tĩnh + proxy `/trpc`, `/health`, `/export`,
  `/agent/*` → server. Scheduler chạy ngay trong tiến trình server nên không có
  service nào khác phải giữ sống.
  **Thêm route REST mới ở server thì phải thêm một `handle` trong
  [deploy/Caddyfile](deploy/Caddyfile)**, nếu không nó rơi xuống nhánh SPA và
  trả về `index.html` kèm mã 200 — client nhận HTML thay vì JSON và hỏng im
  lặng. Đường đi qua `/trpc` thì không dính, vì `/trpc/*` đã được proxy sẵn.

Biến môi trường thật nằm ở `/data/app-reminder/deploy/.env` trên server,
không đi qua git.

Deploy tay khi cần (không muốn chờ cron):

```bash
ssh -p 24700 root@202.92.6.143 /data/app-reminder/deploy/autodeploy.sh
```

Cron backup trên 202.92.6.143:

```bash
crontab -e
# 0 2 * * * /data/app-reminder/deploy/backup.sh >> /var/log/family-hub-backup.log 2>&1
```

Backup không phải việc làm sau. Dữ liệu này không có bản sao ở đâu khác.
