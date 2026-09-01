#!/bin/sh
set -eu

: "${BACKUP_SCHEDULE:=0 23 * * *}"
: "${TZ:=Asia/Tashkent}"
export TZ

if [ -f "/usr/share/zoneinfo/${TZ}" ]; then
  ln -sf "/usr/share/zoneinfo/${TZ}" /etc/localtime
  echo "${TZ}" > /etc/timezone
fi

# busybox crond o'zini ishga tushirgan protsessning environment'ini bolalariga
# meros qilib beradi, shuning uchun docker-compose orqali berilgan barcha
# S3_*/DB_*/RETENTION_DAYS o'zgaruvchilar cron job ichida ham mavjud bo'ladi.
echo "${BACKUP_SCHEDULE} cd /app && node /app/src/backup.js >> /proc/1/fd/1 2>> /proc/1/fd/2" > /etc/crontabs/root

echo "[entrypoint] avto-backup-bot ishga tushdi. Jadval: '${BACKUP_SCHEDULE}' (TZ=${TZ})"
echo "[entrypoint] Qo'lda test qilish uchun: docker exec <konteyner> node src/backup.js --once"

exec crond -f -l 2
