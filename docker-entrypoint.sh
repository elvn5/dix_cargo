#!/bin/sh
set -e

# Локальный дамп перед миграциями — точка отката, если миграция испортит данные.
# Хранятся последние PREDEPLOY_KEEP дампов каждой базы в томе /app/backups.
predeploy_dump() {
  name="$1"; url="$2"
  dir=/app/backups
  mkdir -p "$dir"
  file="$dir/predeploy_${name}_$(date +%Y-%m-%d_%H%M%S).dump"
  echo "💾 Pre-migration dump ($name) → $file"
  pg_dump --format=custom --no-owner --no-privileges "$url" > "$file"
  ls -1t "$dir"/predeploy_"${name}"_*.dump | tail -n +$((${PREDEPLOY_KEEP:-10} + 1)) | xargs -r rm -f
}

predeploy_dump bishkek "$DATABASE_URL"
if [ -n "$DATABASE_URL_KANT" ]; then
  predeploy_dump kant "$DATABASE_URL_KANT"
fi

echo "⏳ Applying database migrations (Бишкек)..."
npx prisma migrate deploy

if [ -n "$DATABASE_URL_KANT" ]; then
  echo "⏳ Applying database migrations (Кант)..."
  DATABASE_URL="$DATABASE_URL_KANT" npx prisma migrate deploy
fi

echo "🚀 Starting bot..."
exec node dist/index.js
