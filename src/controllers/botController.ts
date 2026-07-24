import { Bot, Context, InputFile } from "grammy";
import { userService } from "../services/userService";
import { resetRequestService } from "../services/resetRequestService";
import { getPrisma, DEFAULT_BRANCH, branchLabel, type Branch } from "../database/prismaClient";
import type { PrismaClient } from "@prisma/client";
import path from "path";
import fs from "fs";

const MARKETPLACE_DEFAULTS: Record<string, string> = {
  marketplace_pinduoduo:
    `<code>八 {code}\n广东省佛山市南海区里水镇大石社区石紫岗工业区石一石二工业路27号321国际仓\n13763369694 八{code}</code>\n\n` +
    `Скопируйте адрес и вставьте в приложении. Сверьте с шаблоном ниже.\n` +
    `Чтобы ваши посылки не потерялись, обязательно отправьте скриншот заполненного адреса на проверку и получите подтверждение от нашего менеджера.\n` +
    `Только после подтверждения адреса, Карго несет ответственность за ваши посылки.`,
  marketplace_taobao:
    `<code>八 {code}\n广东省佛山市南海区里水镇大石社区石紫岗工业区石一石二工业路27号321国际仓\n13763369694 八{code}</code>\n\n` +
    `Скопируйте адрес и вставьте в приложении. Сверьте с шаблоном ниже.\n` +
    `Чтобы ваши посылки не потерялись, обязательно отправьте скриншот заполненного адреса на проверку и получите подтверждение от нашего менеджера.\n` +
    `Только после подтверждения адреса, Карго несет ответственность за ваши посылки.`,
  marketplace_1688:
    `<code>八 {code}\n广东省佛山市南海区里水镇大石社区石紫岗工业区石一石二工业路27号321国际仓\n13763369694 八{code}</code>\n\n` +
    `Скопируйте адрес и вставьте в приложении. Сверьте с шаблоном ниже.\n` +
    `Чтобы ваши посылки не потерялись, обязательно отправьте скриншот заполненного адреса на проверку и получите подтверждение от нашего менеджера.\n` +
    `Только после подтверждения адреса, Карго несет ответственность за ваши посылки.`,
  marketplace_poizon:
    `<code>八 {code}\n广东省佛山市南海区里水镇大石社区石紫岗工业区石一石二工业路27号321国际仓\n13763369694 八{code}</code>\n\n` +
    `Скопируйте адрес и вставьте в приложении. Сверьте с шаблоном ниже.\n` +
    `Чтобы ваши посылки не потерялись, обязательно отправьте скриншот заполненного адреса на проверку и получите подтверждение от нашего менеджера.\n` +
    `Только после подтверждения адреса, Карго несет ответственность за ваши посылки.`,
};

async function getMarketplaceText(db: PrismaClient, settingKey: string, code: string): Promise<string> {
  const setting = await db.setting.findUnique({ where: { key: settingKey } });
  const template = setting?.value ?? MARKETPLACE_DEFAULTS[settingKey] ?? "";
  return template.replace(/\{code\}/g, code);
}

function resolveMarketplaceFile(branch: Branch, settingKey: string, type: "photo" | "video"): string {
  const name = settingKey.replace("marketplace_", "");
  const uploadsDir = "/app/uploads";
  try {
    const files = fs.readdirSync(uploadsDir);
    const branchFile = files.find(f => f.startsWith(`${branch}_${name}_${type}.`));
    if (branchFile) return path.join(uploadsDir, branchFile);
    if (branch === DEFAULT_BRANCH) {
      // Обратная совместимость: файлы, загруженные до поддержки филиалов, без префикса
      const legacyFile = files.find(f => f.startsWith(`${name}_${type}.`));
      if (legacyFile) return path.join(uploadsDir, legacyFile);
    }
  } catch {}
  // fallback to bundled asset
  return type === "photo"
    ? path.join(__dirname, "../assets/pinduoduo_photo.jpg")
    : path.join(__dirname, "../assets/pinduoduo_video.MP4");
}

type RegStep =
  | { step: "select_branch" }
  | { step: "phone"; branch: Branch }
  | { step: "name"; phone: string; branch: Branch }
  | { step: "track_search"; branch: Branch };

const regState = new Map<number, RegStep>();

/** Test-only: clears in-progress registration state between test cases. */
export function __resetRegStateForTests(): void {
  regState.clear();
}

function branchSelectKeyboard() {
  return {
    inline_keyboard: [[
      { text: "🏙 г. Бишкек", callback_data: "branch_bishkek" },
      { text: "🏙 г. Кант", callback_data: "branch_kant" },
    ]],
  };
}

async function getMenuKeyboard(db: PrismaClient) {
  const hasPromo = await db.promoCode.findFirst({ where: { claimed_by: null } });
  const rows: { text: string }[][] = [
    [{ text: "📦 Мои посылки" }, { text: "🚫 Запрещенные товары" }],
    [{ text: "📍 Адреса" }, { text: "👤 Профиль" }],
    [{ text: "💬 Поддержка" }, { text: "📋 Шаблон заполнения" }],
  ];
  if (hasPromo) rows.push([{ text: "🎁 Получить промокод" }]);
  return { keyboard: rows, resize_keyboard: true, persistent: true };
}

const DEFAULT_MANAGERS = [
  { name: "Лидия", url: "https://wa.me/996550867414" },
  { name: "Виктория", url: "https://wa.me/996556969906" },
];

async function getManagersKeyboard(db: PrismaClient) {
  let managers: { name: string; url: string }[] = [];

  const row = await db.setting.findUnique({ where: { key: "manager_buttons" } });
  if (row) {
    try {
      const parsed = JSON.parse(row.value);
      if (Array.isArray(parsed)) managers = parsed;
    } catch {
      // игнорируем повреждённое значение
    }
  }

  if (managers.length === 0) {
    const legacy = await db.setting.findMany({
      where: { key: { in: ["manager_1_name", "manager_1_url", "manager_2_name", "manager_2_url"] } },
    });
    if (legacy.length > 0) {
      const s: Record<string, string> = {};
      for (const legacyRow of legacy) s[legacyRow.key] = legacyRow.value;
      managers = [
        { name: s.manager_1_name || DEFAULT_MANAGERS[0].name, url: s.manager_1_url || DEFAULT_MANAGERS[0].url },
        { name: s.manager_2_name || DEFAULT_MANAGERS[1].name, url: s.manager_2_url || DEFAULT_MANAGERS[1].url },
      ];
    } else {
      managers = DEFAULT_MANAGERS;
    }
  }

  const rows: { text: string; url: string }[][] = [];
  for (let i = 0; i < managers.length; i += 2) {
    rows.push(managers.slice(i, i + 2).map(m => ({ text: m.name, url: m.url })));
  }
  return { inline_keyboard: rows };
}

/** Определяет базу филиала для текущего пользователя; если он ещё не зарегистрирован — база филиала по умолчанию. */
async function resolveDbForCtx(ctx: Context): Promise<PrismaClient> {
  const telegramId = ctx.from?.id;
  if (telegramId) {
    const found = await userService.findUserAnyBranch(BigInt(telegramId));
    if (found) return getPrisma(found.branch);
  }
  return getPrisma(DEFAULT_BRANCH);
}

async function sendRegistrationAddress(ctx: Context, db: PrismaClient, code: string): Promise<void> {
  const text = await getMarketplaceText(db, "marketplace_pinduoduo", code);
  const fullText = `Ваш адрес:\n\n${text}`;

  const codeEnd = fullText.indexOf("</code>");
  if (codeEnd !== -1) {
    const addressPart = fullText.slice(0, codeEnd + "</code>".length);
    const restPart    = fullText.slice(codeEnd + "</code>".length).trimStart();
    await ctx.reply(addressPart, { parse_mode: "HTML" });
    if (restPart) await ctx.reply(restPart, { parse_mode: "HTML" });
  } else {
    await ctx.reply(fullText, { parse_mode: "HTML" });
  }
}

function buildProfile(code: string, fullName: string, phone: string): string {
  return (
    `✅ Вы успешно зарегистрированы\n\n` +
    `📃 Ваш профиль\n\n` +
    `🪪 Персональный КОД: <b>${code}</b>\n` +
    `👤 ФИО: ${fullName}\n` +
    `📞 Номер: ${phone}\n\n` +
    `По возникшим вопросам обратитесь к специалисту ⬇️`
  );
}

export function registerControllers(bot: Bot<Context>): void {
  // ── /start ──────────────────────────────────────────────────────────────────
  bot.command("start", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const existing = await userService.findUserAnyBranch(BigInt(telegramId));

    if (existing) {
      const db = getPrisma(existing.branch);
      await ctx.reply(
        buildProfile(
          existing.user.client_code,
          existing.user.full_name,
          existing.user.phone
        ),
        {
          parse_mode: "HTML",
          reply_markup: await getMenuKeyboard(db),
        }
      );
      return;
    }

    regState.set(telegramId, { step: "select_branch" });

    await ctx.reply(
      "👋 Добро пожаловать!\n\nВыберите ваш филиал для регистрации:",
      {
        reply_markup: branchSelectKeyboard(),
      }
    );
  });

  // ── Выбор филиала ─────────────────────────────────────────────────────────────
  bot.callbackQuery(/^branch_(bishkek|kant)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const branch = ctx.match[1] as Branch;
    regState.set(telegramId, { step: "phone", branch });

    await ctx.reply(
      `✅ Филиал: <b>${branchLabel(branch)}</b>\n\n` +
        "Для регистрации укажите номер телефона в формате <b>XXX123456</b>\n" +
        "где XXX — код оператора\n" +
        "  Пример: <code>500100500</code>",
      {
        parse_mode: "HTML",
        reply_markup: { remove_keyboard: true },
      }
    );
  });

  // ── Заявка на сброс доступа ───────────────────────────────────────────────────
  bot.callbackQuery(/^reset_request:(bishkek|kant):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const senderId = ctx.from?.id;
    if (!senderId) return;

    const branch = ctx.match[1] as Branch;
    const userId = Number(ctx.match[2]);
    const db = getPrisma(branch);

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) {
      await ctx.reply("⚠️ Не удалось найти аккаунт для сброса. Обратитесь к менеджеру.");
      return;
    }

    await resetRequestService.createOrUpdate(db, userId, BigInt(senderId));

    await ctx.reply("✅ Заявка на сброс доступа отправлена. Ожидайте одобрения от администратора.");
  });

  // ── Команды меню ─────────────────────────────────────────────────────────────
  bot.command("packages", (ctx) => handlePackages(ctx));
  bot.command("forbidden", (ctx) => handleForbidden(ctx));
  bot.command("addresses", (ctx) => handleAddresses(ctx));
  bot.command("profile", (ctx) => handleProfile(ctx));
  bot.command("support", (ctx) => handleSupport(ctx));
  bot.command("template", (ctx) => handleTemplate(ctx));

  // ── Callback-кнопки ───────────────────────────────────────────────────────────
  // ── Шаблоны маркетплейсов ────────────────────────────────────────────────────
  const TEMPLATE =
    "ФИО получателя: \n" +
    "Номер телефона: \n" +
    "Адрес доставки: \n" +
    "Описание товара: \n" +
    "Примерный вес (кг): \n" +
    "Трек-номер (если есть): ";

  bot.callbackQuery("template_pinduoduo", async (ctx) => {
    await ctx.answerCallbackQuery();

    await ctx.reply(
      `📩 Скопируйте ниже адрес склада:\n\n` +
      `<code>ТУТ ДОЛЖЕН БЫТЬ АДРЕС СКЛАДА</code>\n\n` +
      `Скопируйте адрес и вставьте в приложении. Сверьте с шаблоном ниже\n` +
      `Чтобы ваши посылки не потерялись, обязательно отправьте скриншот заполненного адреса на проверку и получите подтверждение от нашего менеджера.\n\n` +
      `Только после подтверждения адреса, Dix Cargo несет ответственность за ваши посылки 📦`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "💬 Связаться с менеджером", url: "https://wa.me/996550867414" }],
          ],
        },
      }
    );

    await ctx.reply("📖 Инструкция по заполнению маркетплейсов:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Pinduoduo", callback_data: "instruction_pinduoduo" }],
          [{ text: "Taobao",    callback_data: "instruction_taobao" }],
          [{ text: "1688",      callback_data: "instruction_1688" }],
        ],
      },
    });
  });

  bot.callbackQuery("template_taobao", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(`📋 <b>Шаблон — Taobao</b>\n\n<code>${TEMPLATE}</code>`, { parse_mode: "HTML" });
  });

  bot.callbackQuery("template_1688", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(`📋 <b>Шаблон — 1688</b>\n\n<code>${TEMPLATE}</code>`, { parse_mode: "HTML" });
  });

  // ── Инструкции маркетплейсов ─────────────────────────────────────────────────
  bot.callbackQuery("instruction_pinduoduo", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("📖 <b>Инструкция — Pinduoduo</b>\n\nСкоро здесь появится инструкция.", { parse_mode: "HTML" });
  });

  bot.callbackQuery("instruction_taobao", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("📖 <b>Инструкция — Taobao</b>\n\nСкоро здесь появится инструкция.", { parse_mode: "HTML" });
  });

  bot.callbackQuery("instruction_1688", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("📖 <b>Инструкция — 1688</b>\n\nСкоро здесь появится инструкция.", { parse_mode: "HTML" });
  });


  // ── Адреса маркетплейсов ──────────────────────────────────────────────────────
  const MARKETPLACE_CALLBACKS: Record<string, string> = {
    address_pinduoduo: "marketplace_pinduoduo",
    address_taobao:    "marketplace_taobao",
    address_1688:      "marketplace_1688",
    address_poizon:    "marketplace_poizon",
  };

  for (const [callbackKey, settingKey] of Object.entries(MARKETPLACE_CALLBACKS)) {
    bot.callbackQuery(callbackKey, async (ctx) => {
      await ctx.answerCallbackQuery();

      const telegramId = ctx.from?.id;
      const found = telegramId ? await userService.findUserAnyBranch(BigInt(telegramId)) : null;
      const branch = found?.branch ?? DEFAULT_BRANCH;
      const db = getPrisma(branch);
      const code = found?.user.client_code ?? "????";

      const text = await getMarketplaceText(db, settingKey, code);

      // Send the address block (<code>…</code>) as a separate message for easy copying,
      // then send the rest of the instructions as a second message.
      const codeEnd = text.indexOf("</code>");
      if (codeEnd !== -1) {
        const addressPart = text.slice(0, codeEnd + "</code>".length);
        const restPart    = text.slice(codeEnd + "</code>".length).trimStart();
        await ctx.reply(addressPart, { parse_mode: "HTML" });
        if (restPart) await ctx.reply(restPart, { parse_mode: "HTML" });
      } else {
        await ctx.reply(text, { parse_mode: "HTML" });
      }

      await ctx.replyWithPhoto(new InputFile(resolveMarketplaceFile(branch, settingKey, "photo")));
      await ctx.replyWithVideo(new InputFile(resolveMarketplaceFile(branch, settingKey, "video")));

      await ctx.reply("📩 Готово? Отправьте скриншот на проверку:", {
        reply_markup: await getManagersKeyboard(db),
      });
    });
  }

  // ── Фильтр посылок ────────────────────────────────────────────────────────────
  const STATUS_LABEL: Record<string, string> = {
    IN_OFFICE:  "🏢 В офисе",
    IN_TRANSIT: "🚚 В пути",
    DELIVERED:  "✅ Выдан",
  };

  const PKG_PAGE_SIZE = 5;

  async function showPackagesPage(
    ctx: Context,
    db: PrismaClient,
    userId: number,
    status: "IN_OFFICE" | "IN_TRANSIT" | "DELIVERED",
    page: number
  ) {
    const total = await db.package.count({ where: { user_id: userId, status } });

    if (total === 0) {
      await ctx.reply(`${STATUS_LABEL[status]}: посылок нет.`);
      return;
    }

    const totalPages = Math.ceil(total / PKG_PAGE_SIZE);
    const safePage = Math.max(0, Math.min(page, totalPages - 1));

    const packages = await db.package.findMany({
      where: { user_id: userId, status },
      orderBy: { created_at: "desc" },
      skip: safePage * PKG_PAGE_SIZE,
      take: PKG_PAGE_SIZE,
    });

    const lines = packages.map((p) =>
      `📦 <b>${p.track_code}</b>\n` +
      `Статус: ${STATUS_LABEL[status].replace(/^\S+\s/, "")}\n` +
      `Дата отправки: ${p.created_at.toLocaleDateString("ru-RU")}` +
      (status !== "IN_TRANSIT" ? `\nДата поступления: ${p.updated_at.toLocaleDateString("ru-RU")}` : "")
    ).join("\n\n");

    const header = `${STATUS_LABEL[status]} — ${total} шт. (стр. ${safePage + 1}/${totalPages})\n\n`;

    const navRow: { text: string; callback_data: string }[] = [];
    if (safePage > 0)
      navRow.push({ text: "← Назад", callback_data: `pkg_page:${status}:${safePage - 1}` });
    if (safePage < totalPages - 1)
      navRow.push({ text: "Вперёд →", callback_data: `pkg_page:${status}:${safePage + 1}` });

    const keyboard = navRow.length > 0 ? { inline_keyboard: [navRow] } : undefined;

    await ctx.reply(header + lines, { parse_mode: "HTML", reply_markup: keyboard });
  }

  bot.callbackQuery(/^pkg_filter:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const telegramId = ctx.from?.id;
    const found = telegramId ? await userService.findUserAnyBranch(BigInt(telegramId)) : null;
    if (!found) { await ctx.reply("❌ Вы не зарегистрированы. Отправьте /start."); return; }
    const status = ctx.match[1] as "IN_OFFICE" | "IN_TRANSIT" | "DELIVERED";
    await showPackagesPage(ctx, getPrisma(found.branch), found.user.id, status, 0);
  });

  bot.callbackQuery(/^pkg_page:(\w+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const telegramId = ctx.from?.id;
    const found = telegramId ? await userService.findUserAnyBranch(BigInt(telegramId)) : null;
    if (!found) { await ctx.reply("❌ Вы не зарегистрированы. Отправьте /start."); return; }
    const status = ctx.match[1] as "IN_OFFICE" | "IN_TRANSIT" | "DELIVERED";
    const page = parseInt(ctx.match[2], 10);
    await showPackagesPage(ctx, getPrisma(found.branch), found.user.id, status, page);
  });

  // ── Поиск по трек-номеру ─────────────────────────────────────────────────────
  bot.callbackQuery("pkg_search", async (ctx) => {
    await ctx.answerCallbackQuery();
    const senderId = ctx.from?.id;
    if (!senderId) return;
    const found = await userService.findUserAnyBranch(BigInt(senderId));
    if (!found) { await ctx.reply("❌ Вы не зарегистрированы. Отправьте /start."); return; }
    regState.set(senderId, { step: "track_search", branch: found.branch });
    await ctx.reply("🔍 Введите трек-номер посылки:");
  });

  // ── Контакт ──────────────────────────────────────────────────────────────────
  bot.on("message:contact", async (ctx) => {
    const contact = ctx.message.contact;
    const senderId = ctx.from?.id;

    if (!senderId || contact.user_id !== senderId) {
      await ctx.reply(
        "❌ Пожалуйста, поделитесь своим собственным контактом.",
        {
          reply_markup: { remove_keyboard: true },
        }
      );
      return;
    }

    const state = regState.get(senderId);
    if (!state || state.step !== "phone") {
      await ctx.reply("Отправьте /start для начала регистрации.", {
        reply_markup: { remove_keyboard: true },
      });
      return;
    }

    regState.set(senderId, { step: "name", phone: contact.phone_number, branch: state.branch });

    await ctx.reply("📝 Введите ваше ФИО (Фамилия Имя Отчество):", {
      reply_markup: { remove_keyboard: true },
    });
  });

  // ── Текстовые сообщения ───────────────────────────────────────────────────────
  bot.on("message:text", async (ctx) => {
    const senderId = ctx.from?.id;
    if (!senderId) return;

    const text = ctx.message.text.trim();

    // Кнопки меню (проверяем до состояния регистрации)
    if (text === "📦 Мои посылки") {
      await handlePackages(ctx);
      return;
    }
    if (text === "🚫 Запрещенные товары") {
      await handleForbidden(ctx);
      return;
    }
    if (text === "📍 Адреса") {
      await handleAddresses(ctx);
      return;
    }
    if (text === "👤 Профиль") {
      await handleProfile(ctx);
      return;
    }
    if (text === "💬 Поддержка") {
      await handleSupport(ctx);
      return;
    }
    if (text === "📋 Шаблон заполнения") {
      await handleTemplate(ctx);
      return;
    }

    if (text === "🎁 Получить промокод") {
      const found = await userService.findUserAnyBranch(BigInt(senderId));
      if (!found) {
        await ctx.reply("❌ Вы не зарегистрированы. Отправьте /start.");
        return;
      }
      const db = getPrisma(found.branch);
      const user = found.user;

      // Атомарно: берём первый свободный код и сразу привязываем к пользователю
      const promo = await db.promoCode.findFirst({ where: { claimed_by: null } });
      if (!promo) {
        await ctx.reply(
          "😔 К сожалению, все промокоды уже разобраны.",
          { reply_markup: await getMenuKeyboard(db) }
        );
        return;
      }

      const claimed = await db.promoCode.updateMany({
        where: { id: promo.id, claimed_by: null },
        data:  { claimed_by: user.id, claimed_at: new Date() },
      });

      if (claimed.count === 0) {
        // Кто-то успел раньше (race condition)
        await ctx.reply(
          "😔 К сожалению, промокод уже был получен другим клиентом.",
          { reply_markup: await getMenuKeyboard(db) }
        );
        return;
      }

      const desc = promo.description ? `\n\n${promo.description}` : "";
      await ctx.reply(
        `🎉 Ваш промокод: <code>${promo.code}</code>${desc}`,
        { parse_mode: "HTML", reply_markup: await getMenuKeyboard(db) }
      );
      return;
    }

    // Шаги регистрации
    const state = regState.get(senderId);
    if (!state) {
      // Зарегистрированный пользователь без активного состояния — ищем по трек-номеру
      const found = await userService.findUserAnyBranch(BigInt(senderId));
      if (!found) {
        await ctx.reply("Отправьте /start для начала работы.");
        return;
      }
      const db = getPrisma(found.branch);

      const pkg = await db.package.findFirst({
        where: { user_id: found.user.id, track_code: text },
      });

      if (!pkg) {
        await ctx.reply(`❌ Посылка с трек-номером <code>${text}</code> не найдена.`, { parse_mode: "HTML" });
        return;
      }

      await ctx.reply(
        `📦 ${pkg.track_code}\n` +
        `Статус посылки: ${STATUS_LABEL[pkg.status]}\n` +
        `Дата отправки: ${pkg.created_at.toLocaleDateString("ru-RU")}` +
        (pkg.status !== "IN_TRANSIT" ? `\nДата поступления: ${pkg.updated_at.toLocaleDateString("ru-RU")}` : ""),
        { parse_mode: "HTML" }
      );
      return;
    }

    if (state.step === "select_branch") {
      await ctx.reply("👆 Пожалуйста, выберите филиал, нажав на одну из кнопок выше.", {
        reply_markup: branchSelectKeyboard(),
      });
      return;
    }

    if (state.step === "track_search") {
      regState.delete(senderId);
      const db = getPrisma(state.branch);

      const found = await userService.findUserAnyBranch(BigInt(senderId));
      if (!found) {
        await ctx.reply("❌ Вы не зарегистрированы. Отправьте /start.");
        return;
      }

      const pkg = await db.package.findFirst({
        where: { user_id: found.user.id, track_code: text },
      });

      if (!pkg) {
        await ctx.reply(`❌ Посылка с трек-номером <code>${text}</code> не найдена.`, { parse_mode: "HTML" });
        return;
      }

      await ctx.reply(
        `📦 ${pkg.track_code}\n` +
        `Статус посылки: ${STATUS_LABEL[pkg.status]}\n` +
        `Дата отправки: ${pkg.created_at.toLocaleDateString("ru-RU")}` +
        (pkg.status !== "IN_TRANSIT" ? `\nДата поступления: ${pkg.updated_at.toLocaleDateString("ru-RU")}` : ""),
        { parse_mode: "HTML" }
      );
      return;
    }

    if (state.step === "phone") {
      if (!/^\d{9}$/.test(text)) {
        await ctx.reply(
          "⚠️ Неверный формат номера.\n\n" +
            "Введите 9 цифр в формате <b>XXX123456</b>, где XXX — код оператора.\n" +
            "Пример: <code>500100500</code>",
          { parse_mode: "HTML" }
        );
        return;
      }

      const db = getPrisma(state.branch);
      const phoneUser = await userService.findUserByPhone(db, text);
      if (phoneUser) {
        if (phoneUser.telegram_id > 0n) {
          // Уже привязан к реальному Telegram-аккаунту
          if (phoneUser.telegram_id === BigInt(senderId)) {
            regState.delete(senderId);
            await ctx.reply(buildProfile(phoneUser.client_code, phoneUser.full_name, phoneUser.phone),
              { parse_mode: "HTML", reply_markup: await getMenuKeyboard(db) });
          } else {
            await ctx.reply(
              "❌ Этот номер телефона уже зарегистрирован.\n\nВведите другой номер или запросите сброс доступа к аккаунту.",
              {
                parse_mode: "HTML",
                reply_markup: {
                  inline_keyboard: [[
                    { text: "Сбросить доступ", callback_data: `reset_request:${state.branch}:${phoneUser.id}` },
                  ]],
                },
              }
            );
          }
          return;
        }
        // Создан администратором — привязываем Telegram
        regState.delete(senderId);
        const linked = await db.user.update({
          where: { id: phoneUser.id },
          data: { telegram_id: BigInt(senderId) },
        });
        await ctx.reply(buildProfile(linked.client_code, linked.full_name, linked.phone),
          { parse_mode: "HTML", reply_markup: await getManagersKeyboard(db) });
        await ctx.reply("Выберите раздел:", { reply_markup: await getMenuKeyboard(db) });
        return;
      }

      // Новый пользователь — переходим к вводу имени
      regState.set(senderId, { step: "name", phone: text, branch: state.branch });
      await ctx.reply("📝 Введите ваше ФИО (Фамилия Имя Отчество):", {
        reply_markup: { remove_keyboard: true },
      });
      return;
    }

    if (state.step === "name") {
      if (text.split(" ").length < 2) {
        await ctx.reply(
          "⚠️ Пожалуйста, введите полное ФИО (минимум фамилия и имя)."
        );
        return;
      }

      regState.delete(senderId);
      const db = getPrisma(state.branch);

      try {
        const existingUser = await userService.findUserByTelegramId(
          db,
          BigInt(senderId)
        );

        if (existingUser) {
          await ctx.reply(
            buildProfile(
              existingUser.client_code,
              existingUser.full_name,
              existingUser.phone
            ),
            { parse_mode: "HTML", reply_markup: await getMenuKeyboard(db) }
          );
          return;
        }

        const newUser = await userService.createUser(db, state.branch, BigInt(senderId), state.phone, text);

        await ctx.reply(
          buildProfile(newUser.client_code, newUser.full_name, newUser.phone),
          { parse_mode: "HTML", reply_markup: await getManagersKeyboard(db) }
        );
        await sendRegistrationAddress(ctx, db, newUser.client_code);
        await ctx.reply("Выберите раздел:", { reply_markup: await getMenuKeyboard(db) });
      } catch (error) {
        console.error("[Registration] Ошибка при создании пользователя:", error);
        await ctx.reply("⚠️ Произошла ошибка при регистрации. Попробуйте позже.");
      }
    }
  });
}

// ── Обработчики кнопок меню ───────────────────────────────────────────────────

async function handlePackages(ctx: Context) {
  await ctx.reply("📦 <b>Мои посылки</b>\n\nВыберите статус:", {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🏢 В офисе", callback_data: "pkg_filter:IN_OFFICE" },
          { text: "🚚 В пути",  callback_data: "pkg_filter:IN_TRANSIT" },
          { text: "✅ Выданы",  callback_data: "pkg_filter:DELIVERED" },
        ],
        [
          { text: "🔍 Найти по трек-номеру", callback_data: "pkg_search" },
        ],
      ],
    },
  });
}

async function handleForbidden(ctx: Context) {
  const db = await resolveDbForCtx(ctx);
  const setting = await db.setting.findUnique({ where: { key: "forbidden_items" } });
  const text = setting?.value ?? "⚠️ Информация временно недоступна.";

  await ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: await getManagersKeyboard(db),
  });
}

async function handleAddresses(ctx: Context) {
  await ctx.reply(
    "📍 <b>Наши адреса</b>\n\n" +
      "<b>Бишкек:</b>\n" +
      "🏡 ул. Айбек-Ата, 1/2\n" +
      "📞 +996 550‒86‒74‒14\n" +
      "🕐 Пн–Сб: 9:00–19:00 (обед 13:00–14:00)",
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Pinduoduo", callback_data: "address_pinduoduo" },
            { text: "TaoBao",    callback_data: "address_taobao" },
          ],
          [
            { text: "1688",   callback_data: "address_1688" },
            { text: "Poizon", callback_data: "address_poizon" },
          ],
        ],
      },
    }
  );
}

async function handleProfile(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const found = await userService.findUserAnyBranch(BigInt(telegramId));

  if (!found) {
    await ctx.reply("❌ Вы не зарегистрированы. Отправьте /start.");
    return;
  }

  const user = found.user;
  await ctx.reply(
    `📃 <b>Ваш профиль</b>\n\n` +
      `🪪 Персональный КОД: <b>${user.client_code}</b>\n` +
      `👤 ФИО: ${user.full_name}\n` +
      `📞 Номер: ${user.phone}`,
    { parse_mode: "HTML" }
  );
}

async function handleSupport(ctx: Context) {
  const db = await resolveDbForCtx(ctx);
  const managersKb = await getManagersKeyboard(db);
  await ctx.reply(
    "💬 <b>Поддержка</b>\n\nСвяжитесь с нами любым удобным способом:\n\n" +
      "📍 Адрес: Бишкек, Айбек-Ата 1/2\n" +
      "🕒 График работы: Ежедневно с 9:00 до 19:00\n" +
      "📌 Локация на карте: <a href=\"https://go.2gis.com/bwSnG\">AsDi Cargo</a>",
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          managersKb.inline_keyboard[0],
          [{ text: "📸 Instagram: dix_cargo", url: "https://www.instagram.com/dix_cargo/" }],
          [{ text: "✈️ Telegram канал", url: "https://t.me/dixcargo" }],
        ],
      },
    }
  );
}

async function handleTemplate(ctx: Context) {
  await ctx.reply("🛍 Выберите маркетплейс:", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Pinduoduo", callback_data: "address_pinduoduo" },
          { text: "TaoBao",    callback_data: "address_taobao" },
        ],
        [
          { text: "1688",   callback_data: "address_1688" },
          { text: "Poizon", callback_data: "address_poizon" },
        ],
      ],
    },
  });
}
