# Family Hub — agent máy tính

Phase 8. Một tiến trình nền nhỏ chạy trên máy tính, cứ 20 giây ghi nhận đang
dùng app nào, cứ 5 phút gửi tổng của cả ngày về server. Kết quả hiện ở
**Học tập → Máy tính** và thành một dòng trong nhật ký hằng ngày.

**Không có dependency nào.** Chỉ cần Node 22 — thứ máy đã có sẵn nếu bạn từng
chạy app này.

## Nó làm gì và không làm gì

| Làm | Không làm |
|---|---|
| Đọc tên app đang ở trên cùng | Chụp màn hình |
| Đếm số phút mỗi app | Đọc nội dung cửa sổ, URL, gõ phím |
| Bỏ qua lúc rời máy trên 2 phút | Chặn hoặc giới hạn app |
| Gửi tên app + số phút | Gửi file, ảnh, hay bất cứ thứ gì khác |

Chặn và giới hạn giờ là việc của **Screen Time** (Apple) và **Family Link**
(Google) — chúng chạy ở tầng hệ điều hành, con không gỡ được. Agent này cố ý
không đụng vào đó; lý do ở [docs/PLAN.md](../../docs/PLAN.md) mục 1.

> **Nói với con là máy có cài cái này.** Ở tuổi 10–12, minh bạch giữ được lòng
> tin; phát hiện ra bị theo dõi ngầm thì mất hẳn. Trong app, con thấy đúng
> những gì bố mẹ thấy về máy mình, và tự gỡ máy được bất cứ lúc nào.

## Vì sao là Node chứ không phải Tauri

Kế hoạch ban đầu ghi "agent Tauri". Đổi sang Node khi bắt tay làm, vì:

- Tauri cần Rust toolchain trên máy build, và trên macOS còn phải ký +
  notarize thì máy mới chịu chạy. Rất nhiều công cho một tiến trình không có
  giao diện.
- Phần việc thật sự chỉ là: gọi vài lệnh có sẵn của hệ điều hành, cộng số,
  `fetch` một cái. Không có gì cần tới Rust.
- Node đã có trên máy dev; cài agent lên máy con chỉ là copy thư mục.

Đổi lại: không có icon ở khay hệ thống. Nếu sau này thực sự cần giao diện
(nút tạm dừng cho con chẳng hạn) thì `src/tracker.js` và `src/sampler.js` là
phần khó, và chúng độc lập với cách đóng gói.

## Cài

1. Trong app: **Học tập → Máy tính → Thêm máy** (phụ huynh chọn được máy của
   con). Copy token — **chỉ hiện một lần**.
2. Chép thư mục `apps/agent` sang máy cần theo dõi.
3. Tạo `~/.family-hub-agent/config.json`:

```json
{
  "server": "https://reminder.nguyenvando.com",
  "token": "token vừa copy"
}
```

4. Chạy thử: `node agent.js`. Phải thấy `đã kết nối ... — máy "..."`.

Hoặc không cần file config: `FH_SERVER=... FH_TOKEN=... node agent.js`.

### macOS: phải cấp quyền

Lần chạy đầu macOS sẽ hỏi quyền **Accessibility** (agent dùng AppleScript để
đọc tên app đang active). Không cấp thì agent vẫn chạy nhưng mọi mẫu đều rỗng —
báo cáo sẽ trống trơn mà không báo lỗi gì.

**Cài đặt hệ thống → Quyền riêng tư & Bảo mật → Trợ năng** → bật cho Terminal
(hoặc app bạn dùng để chạy agent).

### Chạy nền khi khởi động máy

**macOS** — `~/Library/LaunchAgents/com.nguyenvando.familyhub.agent.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.nguyenvando.familyhub.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/TEN/family-hub-agent/agent.js</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>/tmp/fh-agent.log</string>
</dict></plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.nguyenvando.familyhub.agent.plist
```

**Windows** — Task Scheduler → Create Task → Trigger *At log on* → Action
`node.exe` với argument là đường dẫn `agent.js`, tick *Run whether user is
logged on or not* thì **bỏ**, vì cần phiên đồ hoạ mới đọc được cửa sổ active.

**Linux** — `~/.config/systemd/user/fh-agent.service`, rồi
`systemctl --user enable --now fh-agent`. Cần `xprop` (gói `x11-utils`), và
`xprintidle` nếu muốn bỏ qua lúc rời máy.

## Cách nó đếm

- Mẫu mỗi **20 giây**, cộng dồn bằng **giây**, chỉ quy ra phút lúc gửi. Làm
  tròn ngay từng mẫu thì mỗi lần chuyển app mất một khúc, cuối ngày hụt hàng
  chục phút.
- Không thao tác quá **2 phút** thì không tính — bật màn hình rồi đi ăn cơm
  không phải là dùng máy.
- Gửi **tổng cộng dồn của cả ngày**, không gửi phần chênh lệch. Nhờ vậy mất
  mạng rồi gửi bù, hay agent bị kill giữa chừng, đều không làm số cộng đôi.
  Cũng vì thế mà không cần retry: lần gửi sau đã mang đủ phần vừa hụt.
- Trạng thái ghi ra `~/.family-hub-agent/state.json` sau mỗi mẫu. Khởi động
  lại thì đọc lại — không có bước này, agent bật lúc 3 giờ chiều sẽ gửi một
  báo cáo chỉ có buổi chiều và **xoá** buổi sáng khỏi server.
- Qua nửa đêm (giờ VN) thì gửi nốt hôm qua rồi mới bắt đầu ngày mới.

## Test

```bash
node --test test/*.test.js
```

Phần cộng dồn, ranh giới nửa đêm và khôi phục trạng thái đều thuần logic nên
test được hết mà không cần máy thật. Phần đọc hệ điều hành
(`src/sampler.js`) thì không — mọi lỗi ở đó được nuốt thành "không biết", và
agent bỏ qua mẫu đó thay vì chết.

## Gỡ

Trong app: **Học tập → Máy tính → Gỡ**. Token mất tác dụng ngay và toàn bộ
dữ liệu đã báo cáo của máy đó bị xoá theo. Rồi tắt tiến trình trên máy.
