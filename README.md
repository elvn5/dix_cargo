# Cargo Bot

Telegram-бот для карго-компании на базе [grammY](https://grammy.dev/), TypeScript и Prisma ORM. Включает панель администратора на Express.

## Стек

- **Bot:** grammY
- **Backend:** Node.js + TypeScript + Express (REST API под `/api/admin`)
- **Admin UI:** Vue 3 + Vite + Tailwind CSS v4 (SPA, раздаётся Express'ом под `/admin`)
- **Database:** PostgreSQL + Prisma ORM
- **Container:** Docker + Docker Compose
- **CI/CD:** GitHub Actions

---

## Локальная разработка

### Требования

- Docker + Docker Compose
- Node.js 22+

### Запуск

```bash
cp .env.example .env   # заполните переменные
docker compose up -d   # поднимает PostgreSQL + бот с hot-reload
```

Бот стартует с `nodemon`, изменения в `src/` применяются автоматически без перезапуска контейнера.

### Полезные команды

```bash
npm run dev           # запуск без Docker (ts-node)
npm run dev:watch     # запуск с nodemon без Docker
npm run build         # компиляция TypeScript → dist/
npm run start         # запуск скомпилированного кода

npm run db:generate   # генерация Prisma-клиента
npm run db:migrate    # применить миграции (dev)
npm run db:push       # синхронизировать схему без миграций
npm run db:studio     # открыть Prisma Studio
```

### Admin UI (Vue)

Панель администратора — отдельный проект в `admin-ui/` (Vue 3 + Vite + Tailwind CSS v4). Backend раздаёт
уже собранный `admin-ui/dist` под `/admin` и обслуживает JSON API под `/api/admin`.

```bash
cd admin-ui
npm install
npm run dev         # Vite dev-сервер на :5173 с проксированием /api на localhost:3000
npm run build       # сборка в admin-ui/dist — подхватывается Express'ом при следующем запросе
npm run typecheck   # vue-tsc
```

Для прод-сборки Docker-образа `admin-ui` собирается автоматически на отдельном этапе (см. `Dockerfile`).

### Переменные окружения

| Переменная          | Описание                              |
|---------------------|---------------------------------------|
| `BOT_TOKEN`         | Токен Telegram-бота                   |
| `DATABASE_URL`      | Строка подключения к PostgreSQL — филиал **Бишкек** |
| `DATABASE_URL_KANT` | Строка подключения к PostgreSQL — филиал **Кант**   |
| `POSTGRES_USER`     | Пользователь PostgreSQL               |
| `POSTGRES_PASSWORD` | Пароль PostgreSQL (общий для обеих баз)|
| `POSTGRES_DB`       | Имя базы данных филиала Бишкек        |
| `POSTGRES_DB_KANT`  | Имя базы данных филиала Кант          |
| `ADMIN_EMAIL`       | Email для входа в панель админа       |
| `ADMIN_PASSWORD`    | Пароль для входа в панель админа      |
| `ADMIN_COOKIE_SECRET` | Секрет для сессий Express           |
| `ADMIN_PORT`        | Порт панели админа (prod: 3000, staging: 3001) |

### Филиалы

У бота два филиала — **Бишкек** и **Кант**, каждый со своей полностью изолированной базой данных
(`postgres` + `postgres_kant` в `docker-compose.yml`). При регистрации пользователь выбирает
филиал кнопками, дальше все его данные (посылки, промокоды, настройки) живут в базе этого филиала.

В админ-панели переключатель филиала находится в левой панели — он меняет, с какой базой данных
работают все страницы админки (пользователи, посылки, настройки, дамп БД и т.д.) в рамках текущей
сессии.

---

## Git Flow

```
main  ──────────────────────────────────────────► release/x.x.x
  │                                                      │
  ├── feat/my-feature                                    │
  ├── fix/some-bug              (merge via PR)           │
  └── chore/update-deps                                  │
                                               tag + deploy prod
```

### Ветки

| Ветка | Назначение |
|-------|-----------|
| `main` | Основная ветка. Каждый merge → автодеплой на **staging** |
| `feat/*` | Новая функциональность |
| `fix/*` | Исправления багов |
| `chore/*` | Обновления зависимостей, конфигов |
| `release/*` | Релизная ветка. Push сюда → автодеплой на **production** |

### Правила

1. Прямые коммиты в `main` и `release/*` **запрещены**.
2. Любое изменение идёт через Pull Request с ревью.
3. Ветку создавать от актуального `main`:
   ```bash
   git checkout main && git pull
   git checkout -b feat/your-feature
   ```
4. После мержа PR в `main` ветку удалить.
5. Для релиза создать ветку `release/x.x.x` от `main` — CI подберёт версию из имени ветки.

---

## Деплой

### Staging

**Триггер:** любой push (или merge PR) в ветку `main`.

**Что происходит:**
1. GitHub Actions собирает Docker-образ и пушит в `ghcr.io` с тегом `staging`.
2. Образ копируется на сервер вместе с `docker-compose.prod.yml`.
3. На сервере генерируется `.env` из GitHub Secrets.
4. Запускается `docker compose up -d` с проектом `cargo_staging`.

**Порты:** бот — внутри сети, панель админа — `3001`.

### Production

**Триггер:** push в ветку `release/x.x.x`.

**Что происходит:**
1. CI извлекает версию из имени ветки.
2. Собирает образ и пушит с тегами `latest` и `x.x.x`.
3. На сервере запускается `docker compose up -d` с проектом `cargo_prod`.

**Порты:** бот — внутри сети, панель админа — `3000`.

### Схема окружений

```
Developer → PR → main → [CI] → Staging (ghcr.io:staging, port 3001)
                  │
                  └── release/1.2.0 → [CI] → Production (ghcr.io:latest, port 3000)
```

### Ручной деплой (аварийный)

```bash
# На сервере
docker pull ghcr.io/<org>/cargo_bot:latest
docker compose -f docker-compose.prod.yml --project-name cargo_prod up -d
```

### Миграции БД

Миграции применяются автоматически при старте контейнера через `docker-entrypoint.sh`:

```bash
npx prisma migrate deploy && node dist/index.js
```

Накатывать вручную не нужно — ни на staging, ни на prod.
