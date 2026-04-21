#!/bin/sh
set -e

echo "⏳ Applying database migrations..."
npx prisma migrate deploy

echo "🚀 Starting bot in development mode (hot reload)..."
exec npx nodemon --watch src --ext ts --exec "ts-node src/index.ts"
