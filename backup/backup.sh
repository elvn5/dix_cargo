#!/bin/sh
# Дамп обеих баз → шифрование age → загрузка в Google Drive → очистка старых копий.
#
# Структура в Drive (папку создаёт сам rclone — со scope drive.file он видит только свои файлы):
#   dix-backups/<филиал>/daily/    — каждый день,      хранится BACKUP_KEEP_DAILY_DAYS
#   dix-backups/<филиал>/weekly/   — по воскресеньям,  хранится BACKUP_KEEP_WEEKLY_DAYS
#   dix-backups/<филиал>/monthly/  — 1-го числа,       хранится BACKUP_KEEP_MONTHLY_DAYS
set -eu
set -o pipefail

: "${DATABASE_URL:?}" "${BACKUP_AGE_RECIPIENT:?}"
REMOTE="${BACKUP_REMOTE:-gdrive:dix-backups}"
WORK_DIR="${BACKUP_WORK_DIR:-/tmp/backup}"
KEEP_DAILY="${BACKUP_KEEP_DAILY_DAYS:-14}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY_DAYS:-62}"
KEEP_MONTHLY="${BACKUP_KEEP_MONTHLY_DAYS:-365}"

# Удаляем навсегда, а не в корзину Drive — иначе удалённые копии продолжают занимать место
RCLONE="rclone --config ${RCLONE_CONFIG:-/tmp/rclone.conf} --drive-use-trash=false --retries 5 --low-level-retries 10"

# JSON-строка в том же формате, что и журнал бота
log() {
  level="$1"; event="$2"; shift 2
  extra=""
  for kv in "$@"; do extra="$extra,\"${kv%%=*}\":\"${kv#*=}\""; done
  echo "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"level\":\"$level\",\"event\":\"$event\"$extra}"
}

alert() {
  [ -n "${ALERT_CHAT_ID:-}" ] && [ -n "${BOT_TOKEN:-}" ] || return 0
  curl -fsS --max-time 20 "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${ALERT_CHAT_ID}" \
    --data-urlencode "text=⚠️ Бэкап БД не удался: $1" >/dev/null || log error backup.alert_failed
}

STAGE="start"
on_exit() {
  code=$?
  rm -rf "$WORK_DIR"
  if [ "$code" -ne 0 ]; then
    log error backup.failed stage="$STAGE" exit_code="$code"
    alert "этап «$STAGE», код $code. Подробности: docker logs сервиса backup."
  fi
}
trap on_exit EXIT

mkdir -p "$WORK_DIR"
stamp="$(date +%Y-%m-%d_%H%M)"
dow="$(date +%u)"   # 7 = воскресенье
dom="$(date +%d)"

backup_one() {
  branch="$1"; url="$2"
  file="$WORK_DIR/${branch}_${stamp}.dump.age"

  STAGE="dump:$branch"
  pg_dump --format=custom --no-owner --no-privileges "$url" | age --encrypt -r "$BACKUP_AGE_RECIPIENT" > "$file"
  size="$(wc -c < "$file" | tr -d ' ')"
  [ "$size" -gt 200 ] || { log error backup.too_small branch="$branch" bytes="$size"; return 1; }

  STAGE="upload:$branch"
  $RCLONE copyto "$file" "$REMOTE/$branch/daily/$(basename "$file")"
  # Недельные и месячные копии — копирование внутри Drive, без повторной загрузки
  if [ "$dow" = "7" ]; then
    $RCLONE copyto "$REMOTE/$branch/daily/$(basename "$file")" "$REMOTE/$branch/weekly/$(basename "$file")"
  fi
  if [ "$dom" = "01" ]; then
    $RCLONE copyto "$REMOTE/$branch/daily/$(basename "$file")" "$REMOTE/$branch/monthly/$(basename "$file")"
  fi

  STAGE="cleanup:$branch"
  $RCLONE delete --min-age "${KEEP_DAILY}d" "$REMOTE/$branch/daily"
  $RCLONE delete --min-age "${KEEP_WEEKLY}d" "$REMOTE/$branch/weekly" 2>/dev/null || true
  $RCLONE delete --min-age "${KEEP_MONTHLY}d" "$REMOTE/$branch/monthly" 2>/dev/null || true

  log info backup.uploaded branch="$branch" file="$(basename "$file")" bytes="$size"
  rm -f "$file"
}

log info backup.start stamp="$stamp"
backup_one bishkek "$DATABASE_URL"
if [ -n "${DATABASE_URL_KANT:-}" ]; then
  backup_one kant "$DATABASE_URL_KANT"
fi
STAGE="done"
log info backup.done stamp="$stamp"
