#!/bin/sh
# Дамп обеих баз (pg_dump custom, уже сжатый) → загрузка в S3-бакет → очистка старых копий.
#
# Структура в бакете S3_BUCKET:
#   <филиал>/daily/    — каждый день,      хранится BACKUP_KEEP_DAILY_DAYS
#   <филиал>/weekly/   — по воскресеньям,  хранится BACKUP_KEEP_WEEKLY_DAYS
#   <филиал>/monthly/  — 1-го числа,       хранится BACKUP_KEEP_MONTHLY_DAYS
set -eu
set -o pipefail

: "${DATABASE_URL:?}"
REMOTE="${BACKUP_REMOTE:-s3:${S3_BUCKET:?}}"
WORK_DIR="${BACKUP_WORK_DIR:-/tmp/backup}"
KEEP_DAILY="${BACKUP_KEEP_DAILY_DAYS:-14}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY_DAYS:-62}"
KEEP_MONTHLY="${BACKUP_KEEP_MONTHLY_DAYS:-365}"

RCLONE="rclone --config ${RCLONE_CONFIG:-/tmp/rclone.conf} --retries 5 --low-level-retries 10"

# JSON-строка в том же формате, что и журнал бота
log() {
  level="$1"; event="$2"; shift 2
  extra=""
  for kv in "$@"; do extra="$extra,\"${kv%%=*}\":\"${kv#*=}\""; done
  echo "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"level\":\"$level\",\"event\":\"$event\"$extra}"
}

# Chat ID для алертов задаётся в админке (Настройки бота) и хранится в базе Бишкека.
# Последнее прочитанное значение кэшируется: если база недоступна, алерт всё равно уйдёт.
ALERT_CHAT_CACHE="${ALERT_CHAT_CACHE:-/tmp/alert_chat_id}"
refresh_alert_chat_id() {
  id="$(PGCONNECT_TIMEOUT=5 psql "$DATABASE_URL" -XAtc \
    "SELECT value FROM settings WHERE key = 'backup_alert_chat_id'" 2>/dev/null)" || return 0
  printf '%s' "$id" > "$ALERT_CHAT_CACHE"
}

notify() {
  chat_id="$(cat "$ALERT_CHAT_CACHE" 2>/dev/null || true)"
  [ -n "${BOT_TOKEN:-}" ] || { log warn backup.notify_skipped reason=no_bot_token; return 0; }
  [ -n "$chat_id" ] || { log warn backup.notify_skipped reason=no_chat_id; return 0; }
  curl -fsS --max-time 20 "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${chat_id}" \
    --data-urlencode "text=$1" >/dev/null || log error backup.notify_failed
}

alert() { notify "⚠️ Бэкап БД не удался: $1"; }

# Размер в МБ с одним знаком после запятой
human_size() { awk -v b="$1" 'BEGIN { printf "%.1f МБ", b / 1048576 }'; }

REPORT=""

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
  file="$WORK_DIR/${branch}_${stamp}.dump"

  STAGE="dump:$branch"
  pg_dump --format=custom --no-owner --no-privileges --file="$file" "$url"
  size="$(wc -c < "$file" | tr -d ' ')"
  [ "$size" -gt 200 ] || { log error backup.too_small branch="$branch" bytes="$size"; return 1; }

  STAGE="upload:$branch"
  $RCLONE copyto "$file" "$REMOTE/$branch/daily/$(basename "$file")"
  # Недельные и месячные копии — копирование внутри бакета, без повторной загрузки
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
  REPORT="${REPORT}
• ${branch}: $(human_size "$size")"
  rm -f "$file"
}

log info backup.start stamp="$stamp"
refresh_alert_chat_id
backup_one bishkek "$DATABASE_URL"
if [ -n "${DATABASE_URL_KANT:-}" ]; then
  backup_one kant "$DATABASE_URL_KANT"
fi
STAGE="done"
log info backup.done stamp="$stamp"
notify "✅ Бэкап БД выполнен ($stamp)${REPORT}"
