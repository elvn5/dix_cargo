#!/bin/sh
# Сервис бэкапов: собирает конфиг rclone из секретов и раз в сутки запускает backup.sh.
set -eu

: "${GDRIVE_CLIENT_ID:?}" "${GDRIVE_CLIENT_SECRET:?}" "${GDRIVE_TOKEN:?}"
export RCLONE_CONFIG=/tmp/rclone.conf

# rclone сам обновляет access token по refresh token и перезаписывает конфиг — поэтому файл в /tmp
umask 077
cat > "$RCLONE_CONFIG" <<CONF
[gdrive]
type = drive
client_id = ${GDRIVE_CLIENT_ID}
client_secret = ${GDRIVE_CLIENT_SECRET}
scope = drive.file
token = ${GDRIVE_TOKEN}
CONF

# Ручной запуск: docker compose exec backup /backup/backup.sh
if [ "${1:-}" = "once" ]; then
  exec /backup/backup.sh
fi

BACKUP_TIME="${BACKUP_TIME:-03:00}"   # по часовому поясу TZ

# Сразу после старта — один бэкап: проверка, что доступ к Drive работает
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
