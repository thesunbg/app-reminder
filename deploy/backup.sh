#!/usr/bin/env bash
# Backup DB hằng đêm. Cài vào crontab:
#   0 2 * * * /srv/family-hub/deploy/backup.sh >> /var/log/family-hub-backup.log 2>&1
#
# Dữ liệu gia đình không có bản sao ở đâu khác — tự chủ hạ tầng
# nghĩa là tự chịu trách nhiệm backup. Nhớ thử restore 1 lần/tháng.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/srv/family-hub/deploy/backup}"
KEEP_DAYS="${KEEP_DAYS:-30}"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$BACKUP_DIR/family_hub-$STAMP.sql.gz"

mkdir -p "$BACKUP_DIR"

docker compose -f "$(dirname "$0")/docker-compose.yml" exec -T db \
  pg_dump -U family_hub -d family_hub --clean --if-exists \
  | gzip -9 > "$FILE"

# pg_dump rỗng nghĩa là backup hỏng — đừng để nó âm thầm ghi đè bản tốt
SIZE=$(stat -f%z "$FILE" 2>/dev/null || stat -c%s "$FILE")
if [ "$SIZE" -lt 1024 ]; then
  echo "❌ Backup nghi ngờ hỏng (chỉ $SIZE bytes): $FILE" >&2
  exit 1
fi

echo "✅ $(date '+%F %T') backup ok: $FILE ($((SIZE / 1024)) KB)"

# đẩy lên object storage nếu đã cấu hình rclone
if command -v rclone >/dev/null 2>&1 && [ -n "${RCLONE_REMOTE:-}" ]; then
  rclone copy "$FILE" "$RCLONE_REMOTE" && echo "   → đã đẩy lên $RCLONE_REMOTE"
fi

find "$BACKUP_DIR" -name 'family_hub-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
