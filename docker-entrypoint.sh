#!/bin/sh
set -e

echo "⏳ Applying database migrations (Бишкек)..."
npx prisma migrate deploy

if [ -n "$DATABASE_URL_KANT" ]; then
  echo "⏳ Applying database migrations (Кант)..."
  DATABASE_URL="$DATABASE_URL_KANT" npx prisma migrate deploy
fi

echo "🚀 Starting bot..."
exec node dist/index.js
