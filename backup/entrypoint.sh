#!/bin/sh
# Сервис бэкапов: собирает конфиг rclone из секретов и раз в сутки запускает backup.sh.
#
# Хранилище — любой S3-совместимый бакет. По умолчанию Cloudflare R2 (бесплатно 10 ГБ, без платы за трафик);
# для Backblaze B2 и других — свои S3_PROVIDER (имя провайдера в rclone или Other), S3_ENDPOINT и S3_REGION.
set -eu

# Без настроек S3 бэкап не запустится: сообщаем в Telegram и ждём, а не уходим в цикл перезапусков
missing=""
for v in S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
  eval "[ -n \"\${$v:-}\" ]" || missing="$missing $v"
done
if [ -n "$missing" ]; then
  echo "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"level\":\"error\",\"event\":\"backup.misconfigured\",\"missing\":\"${missing# }\"}"
  chat_id="$(PGCONNECT_TIMEOUT=5 psql "${DATABASE_URL:-}" -XAtc \
    "SELECT value FROM settings WHERE key = 'backup_alert_chat_id'" 2>/dev/null || true)"
  if [ -n "$chat_id" ] && [ -n "${BOT_TOKEN:-}" ]; then
    curl -fsS --max-time 20 "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${chat_id}" \
      --data-urlencode "text=⚠️ Бэкапы БД не работают: не заданы переменные${missing}" >/dev/null || true
  fi
  exec sleep infinity
fi
export RCLONE_CONFIG=/tmp/rclone.conf

# no_check_bucket: токену R2 с доступом к одному бакету нельзя создавать и проверять бакеты
umask 077
cat > "$RCLONE_CONFIG" <<CONF
[s3]
type = s3
provider = ${S3_PROVIDER:-Cloudflare}
access_key_id = ${S3_ACCESS_KEY_ID}
secret_access_key = ${S3_SECRET_ACCESS_KEY}
endpoint = ${S3_ENDPOINT}
region = ${S3_REGION:-auto}
no_check_bucket = true
CONF

# Ручной запуск: docker compose exec backup /backup/backup.sh
if [ "${1:-}" = "once" ]; then
  exec /backup/backup.sh
fi

BACKUP_TIME="${BACKUP_TIME:-03:00}"   # по часовому поясу TZ

# Сразу после старта — один бэкап: проверка, что доступ к бакету работает
if [ "${BACKUP_ON_START:-1}" = "1" ]; then
  /backup/backup.sh || true
fi

while true; do
  now="$(date +%s)"
  next="$(date -d "$(date +%Y-%m-%d) ${BACKUP_TIME}" +%s)"
  [ "$next" -gt "$now" ] || next=$((next + 86400))
  echo "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"level\":\"info\",\"event\":\"backup.scheduled\",\"next\":\"$(date -d "@$next" '+%Y-%m-%d %H:%M %Z')\"}"
  sleep $((next - now))
  /backup/backup.sh || true
done
