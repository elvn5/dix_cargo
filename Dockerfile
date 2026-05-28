# ──────────────────────────────────────────────
# Stage 0: Development (hot reload)
# ──────────────────────────────────────────────
FROM node:22-alpine AS development

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

RUN npx prisma generate

COPY tsconfig.json ./

COPY docker-entrypoint.dev.sh ./
RUN chmod +x docker-entrypoint.dev.sh

ENTRYPOINT ["./docker-entrypoint.dev.sh"]

# ──────────────────────────────────────────────
# Stage 1: Builder
# ──────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

RUN npm install -g npm@11

# Копируем только манифесты для кэширования слоя зависимостей
COPY package*.json ./
COPY prisma ./prisma/

# Устанавливаем ВСЕ зависимости (включая devDependencies для сборки)
RUN npm install

# Генерируем Prisma Client
RUN npx prisma generate

# Копируем исходный код и компилируем TypeScript
COPY tsconfig.json ./
COPY src ./src/
RUN npm run build

# ──────────────────────────────────────────────
# Stage 2: Production
# ──────────────────────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

ARG APP_VERSION=dev
ENV NODE_ENV=production
ENV APP_VERSION=${APP_VERSION}

RUN npm install -g npm@11

# Копируем манифесты и устанавливаем ТОЛЬКО prod-зависимости
COPY package*.json ./
COPY prisma ./prisma/
RUN npm install --omit=dev

# Генерируем Prisma Client для prod-окружения
RUN npx prisma generate

# Копируем скомпилированный JS из builder-стадии
COPY --from=builder /app/dist ./dist

# Копируем статические файлы (фото, видео для бота)
COPY src/assets ./dist/assets

# Скрипт запуска: сначала мигрируем, потом стартуем бота
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
