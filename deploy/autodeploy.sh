#!/usr/bin/env bash
# Auto-deploy kiểu PULL: chạy bằng cron trên 202.92.6.143, không cần secret
# nào trên GitHub. Repo public → git pull qua HTTPS; image public trên ghcr.io.
#
#   */2 * * * * /data/app-reminder/deploy/autodeploy.sh >> /var/log/family-hub-deploy.log 2>&1
#
# Chỉ deploy khi image gắn tag ĐÚNG commit HEAD đã có trên ghcr.io — CI build
# mất ~3 phút sau khi push, nên compose mới và image cũ không bao giờ lệch nhau.
# TAG được ghi vào deploy/.env để lần `docker-compose up -d` bằng tay sau đó
# vẫn giữ đúng bản đang chạy. Rollback: sửa TAG trong .env rồi up -d.
set -euo pipefail
# cron chạy với PATH tối giản, docker-compose nằm ở /usr/local/bin
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
# 143 dùng docker-compose v2 (binary rời ở /usr/local/bin) + Docker Engine 26.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

exec 9>/tmp/family-hub-deploy.lock
flock -n 9 || exit 0   # lần trước còn đang chạy

# git 1.8 (CentOS 7) không cập nhật origin/main khi fetch một nhánh → dùng FETCH_HEAD
git fetch -q origin main
git reset -q --hard FETCH_HEAD
SHA=$(git rev-parse HEAD)

CUR=$(grep -E '^TAG=' deploy/.env 2>/dev/null | cut -d= -f2 || true)
[ "$CUR" = "$SHA" ] && exit 0

for svc in server web; do
  if ! docker pull -q "ghcr.io/thesunbg/app-reminder-$svc:$SHA" >/dev/null 2>&1; then
    exit 0   # CI chưa build xong commit này — thử lại lần cron sau
  fi
done

cd deploy
# TAG qua biến môi trường trước; chỉ ghi vào .env khi up -d đã thành công
TAG=$SHA docker-compose up -d --remove-orphans
if grep -qE '^TAG=' .env; then
  sed -i "s/^TAG=.*/TAG=$SHA/" .env
else
  echo "TAG=$SHA" >> .env
fi
docker image prune -f >/dev/null
sleep 8
PORT=$(grep -E '^APP_PORT=' .env | cut -d= -f2)
# web bind 127.0.0.1 nên health check phải gọi đúng loopback
if curl -fsS "http://127.0.0.1:${PORT:-5599}/health" >/dev/null; then
  echo "$(date '+%F %T') ✅ deployed ${SHA:0:7}"
else
  echo "$(date '+%F %T') ❌ health fail sau khi deploy ${SHA:0:7}"
  docker-compose ps
  exit 1
fi
