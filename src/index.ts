import "dotenv/config";
import { Bot } from "grammy";
import { registerControllers } from "./controllers/botController";
import { createAdminApp } from "./admin/server";
import prisma from "./database/prismaClient";

// ─── Валидация переменных окружения ───────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is not defined in environment variables.");
}

// ─── Инициализация бота ────────────────────────────────────────────────────────
const bot = new Bot(BOT_TOKEN);

// ─── Подключение контроллеров ──────────────────────────────────────────────────
registerControllers(bot);

// ─── Глобальный обработчик ошибок ─────────────────────────────────────────────
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`[Bot] Ошибка при обработке обновления ${ctx.update.update_id}:`);
  console.error(err.error);
});

// ─── Запуск ───────────────────────────────────────────────────────────────────
async function main() {
  await prisma.$connect();
  console.log("✅ Соединение с базой данных установлено.");

  const { app, port } = createAdminApp();
  app.listen(port, () => console.log(`🖥️  Админ-панель: http://localhost:${port}/admin`));

  await bot.api.setMyCommands([
    { command: "start",     description: "Регистрация / главное меню" },
    { command: "packages",  description: "📦 Мои посылки" },
    { command: "forbidden", description: "🚫 Запрещенные товары" },
    { command: "addresses", description: "📍 Адреса" },
    { command: "profile",   description: "👤 Профиль" },
    { command: "support",   description: "💬 Поддержка" },
    { command: "template",  description: "📋 Шаблон заполнения" },
  ]);

  bot.start({
    onStart: (botInfo) => {
      console.log(`🤖 Бот @${botInfo.username} запущен.`);
    },
  });
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────
async function shutdown() {
  console.log("⏹️  Завершение работы...");
  await bot.stop();
  await prisma.$disconnect();
  console.log("✅ Бот остановлен, соединение с БД закрыто.");
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

main().catch((err) => {
  console.error("❌ Критическая ошибка при запуске:", err);
  process.exit(1);
});
