import { Bot, Context, InputFile } from "grammy";
import { userService } from "../services/userService";
import prisma from "../database/prismaClient";
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

async function getMarketplaceText(settingKey: string, code: string): Promise<string> {
  const setting = await prisma.setting.findUnique({ where: { key: settingKey } });
  const template = setting?.value ?? MARKETPLACE_DEFAULTS[settingKey] ?? "";
  return template.replace(/\{code\}/g, code);
}

function resolveMarketplaceFile(settingKey: string, type: "photo" | "video"): string {
  const name = settingKey.replace("marketplace_", "");
  const uploadsDir = "/app/uploads";
  try {
    const files = fs.readdirSync(uploadsDir);
    const found = files.find(f => f.startsWith(`${name}_${type}.`));
    if (found) return path.join(uploadsDir, found);
  } catch {}
  // fallback to bundled asset
  return type === "photo"
    ? path.join(__dirname, "../assets/pinduoduo_photo.jpg")
    : path.join(__dirname, "../assets/pinduoduo_video.MP4");
}

type RegStep =
  | { step: "phone" }
  | { step: "name"; phone: string }
  | { step: "track_search" };

const regState = new Map<number, RegStep>();

async function getMenuKeyboard() {
  const hasPromo = await prisma.promoCode.findFirst({ where: { claimed_by: null } });
  const rows: { text: string }[][] = [
    [{ text: "📦 Мои посылки" }, { text: "🚫 Запрещенные товары" }],
    [{ text: "📍 Адреса" }, { text: "👤 Профиль" }],
    [{ text: "💬 Поддержка" }, { text: "📋 Шаблон заполнения" }],
  ];
  if (hasPromo) rows.push([{ text: "🎁 Получить промокод" }]);
  return { keyboard: rows, resize_keyboard: true, persistent: true };
}

async function getManagersKeyboard() {
  const settings = await prisma.setting.findMany({
    where: { key: { in: ["manager_1_name", "manager_1_url", "manager_2_name", "manager_2_url"] } },
  });
  const s: Record<string, string> = {};
  for (const row of settings) s[row.key] = row.value;

  return {
    inline_keyboard: [[
      { text: s.manager_1_name || "Лидия",    url: s.manager_1_url || "https://wa.me/996550867414" },
      { text: s.manager_2_name || "Виктория", url: s.manager_2_url || "https://wa.me/996556969906" },
    ]],
  };
}

function buildProfile(code: string, fullName: string, phone: string): string {
  return (
    `✅ Вы успешно зарегистрированы\n\n` +
    `📃 Ваш профиль\n\n` +
    `🪪 Персональный КОД: <b>${code}</b>\n` +
    `👤 ФИО: ${fullName}\n` +
    `📞 Номер: ${phone}`
  );
}

export function registerControllers(bot: Bot<Context>): void {
  // ── /start ──────────────────────────────────────────────────────────────────
  bot.command("start", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const existingUser = await userService.findUserByTelegramId(
      BigInt(telegramId)
    );

    if (existingUser) {
      await ctx.reply(
        buildProfile(
          existingUser.client_code,
          existingUser.full_name,
          existingUser.phone
        ),
        {
          parse_mode: "HTML",
          reply_markup: await getMenuKeyboard(),
        }
      );
      return;
    }

    regState.set(telegramId, { step: "phone" });

    await ctx.reply(
      "👋 Добро пожаловать!\n\n" +
        "Для регистрации укажите номер телефона одним из способов:\n\n" +
        "• Нажмите кнопку «📱 Поделиться контактом»\n" +
        "• Или введите номер вручную в формате <b>XXX123456</b>\n" +
        "  где XXX — код оператора\n" +
        "  Пример: <code>500100500</code>",
      {
        parse_mode: "HTML",
        reply_markup: {
          keyboard: [
            [{ text: "📱 Поделиться контактом", request_contact: true }],
          ],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      }
    );
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
      const user = telegramId
        ? await userService.findUserByTelegramId(BigInt(telegramId))
        : null;
      const code = user?.client_code ?? "????";

      const text = await getMarketplaceText(settingKey, code);
      await ctx.reply(text, { parse_mode: "HTML" });

      await ctx.replyWithPhoto(new InputFile(resolveMarketplaceFile(settingKey, "photo")));
      await ctx.replyWithVideo(new InputFile(resolveMarketplaceFile(settingKey, "video")));

      await ctx.reply("📩 Готово? Отправьте скриншот на проверку:", {
        reply_markup: await getManagersKeyboard(),
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
    userId: number,
    status: "IN_OFFICE" | "IN_TRANSIT" | "DELIVERED",
    page: number
  ) {
    const total = await prisma.package.count({ where: { user_id: userId, status } });

    if (total === 0) {
      await ctx.reply(`${STATUS_LABEL[status]}: посылок нет.`);
      return;
    }

    const totalPages = Math.ceil(total / PKG_PAGE_SIZE);
    const safePage = Math.max(0, Math.min(page, totalPages - 1));

    const packages = await prisma.package.findMany({
      where: { user_id: userId, status },
      orderBy: { created_at: "desc" },
      skip: safePage * PKG_PAGE_SIZE,
      take: PKG_PAGE_SIZE,
    });

    const lines = packages.map((p) =>
      `📦 <b>${p.track_code}</b>\n` +
      `Статус: ${STATUS_LABEL[status].replace(/^\S+\s/, "")}\n` +
      `Дата отправки: ${p.created_at.toLocaleDateString("ru-RU")}\n` +
      `Дата поступления: ${p.updated_at.toLocaleDateString("ru-RU")}`
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
    const user = telegramId ? await userService.findUserByTelegramId(BigInt(telegramId)) : null;
    if (!user) { await ctx.reply("❌ Вы не зарегистрированы. Отправьте /start."); return; }
    const status = ctx.match[1] as "IN_OFFICE" | "IN_TRANSIT" | "DELIVERED";
    await showPackagesPage(ctx, user.id, status, 0);
  });

  bot.callbackQuery(/^pkg_page:(\w+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const telegramId = ctx.from?.id;
    const user = telegramId ? await userService.findUserByTelegramId(BigInt(telegramId)) : null;
    if (!user) { await ctx.reply("❌ Вы не зарегистрированы. Отправьте /start."); return; }
    const status = ctx.match[1] as "IN_OFFICE" | "IN_TRANSIT" | "DELIVERED";
    const page = parseInt(ctx.match[2], 10);
    await showPackagesPage(ctx, user.id, status, page);
  });

  // ── Поиск по трек-номеру ─────────────────────────────────────────────────────
  bot.callbackQuery("pkg_search", async (ctx) => {
    await ctx.answerCallbackQuery();
    const senderId = ctx.from?.id;
    if (!senderId) return;
    regState.set(senderId, { step: "track_search" });
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

    regState.set(senderId, { step: "name", phone: contact.phone_number });

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
      const user = await userService.findUserByTelegramId(BigInt(senderId));
      if (!user) {
        await ctx.reply("❌ Вы не зарегистрированы. Отправьте /start.");
        return;
      }

      // Атомарно: берём первый свободный код и сразу привязываем к пользователю
      const promo = await prisma.promoCode.findFirst({ where: { claimed_by: null } });
      if (!promo) {
        await ctx.reply(
          "😔 К сожалению, все промокоды уже разобраны.",
          { reply_markup: await getMenuKeyboard() }
        );
        return;
      }

      const claimed = await prisma.promoCode.updateMany({
        where: { id: promo.id, claimed_by: null },
        data:  { claimed_by: user.id, claimed_at: new Date() },
      });

      if (claimed.count === 0) {
        // Кто-то успел раньше (race condition)
        await ctx.reply(
          "😔 К сожалению, промокод уже был получен другим клиентом.",
          { reply_markup: await getMenuKeyboard() }
        );
        return;
      }

      const desc = promo.description ? `\n\n${promo.description}` : "";
      await ctx.reply(
        `🎉 Ваш промокод: <code>${promo.code}</code>${desc}`,
        { parse_mode: "HTML", reply_markup: await getMenuKeyboard() }
      );
      return;
    }

    // Шаги регистрации
    const state = regState.get(senderId);
    if (!state) {
      await ctx.reply("Отправьте /start для начала работы.");
      return;
    }

    if (state.step === "track_search") {
      regState.delete(senderId);

      const user = await userService.findUserByTelegramId(BigInt(senderId));
      if (!user) {
        await ctx.reply("❌ Вы не зарегистрированы. Отправьте /start.");
        return;
      }

      const pkg = await prisma.package.findFirst({
        where: { user_id: user.id, track_code: text },
      });

      if (!pkg) {
        await ctx.reply(`❌ Посылка с трек-номером <code>${text}</code> не найдена.`, { parse_mode: "HTML" });
        return;
      }

      const STATUS_LABEL: Record<string, string> = {
        IN_OFFICE:  "В офисе",
        IN_TRANSIT: "В пути",
        DELIVERED:  "Выдан",
      };

      await ctx.reply(
        `📦 ${pkg.track_code}\n` +
        `Статус посылки: ${STATUS_LABEL[pkg.status]}\n` +
        `Дата отправки: ${pkg.created_at.toLocaleDateString("ru-RU")}\n` +
        `Дата поступления: ${pkg.updated_at.toLocaleDateString("ru-RU")}`,
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
      regState.set(senderId, { step: "name", phone: text });
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

      try {
        const existingUser = await userService.findUserByTelegramId(
          BigInt(senderId)
        );

        if (existingUser) {
          await ctx.reply(
            buildProfile(
              existingUser.client_code,
              existingUser.full_name,
              existingUser.phone
            ),
            { parse_mode: "HTML", reply_markup: await getMenuKeyboard() }
          );
          return;
        }

        const phoneUser = await userService.findUserByPhone(state.phone);
        const newUser = phoneUser
          ? await prisma.user.update({
              where: { id: phoneUser.id },
              data: { telegram_id: BigInt(senderId), full_name: text },
            })
          : await userService.createUser(BigInt(senderId), state.phone, text);

        await ctx.reply(
          buildProfile(newUser.client_code, newUser.full_name, newUser.phone),
          { parse_mode: "HTML", reply_markup: await getManagersKeyboard() }
        );
        await ctx.reply("Выберите раздел:", { reply_markup: await getMenuKeyboard() });
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
  const setting = await prisma.setting.findUnique({ where: { key: "forbidden_items" } });
  const text = setting?.value ?? "⚠️ Информация временно недоступна.";

  await ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: await getManagersKeyboard(),
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

  const user = await userService.findUserByTelegramId(BigInt(telegramId));

  if (!user) {
    await ctx.reply("❌ Вы не зарегистрированы. Отправьте /start.");
    return;
  }

  await ctx.reply(
    `📃 <b>Ваш профиль</b>\n\n` +
      `🪪 Персональный КОД: <b>${user.client_code}</b>\n` +
      `👤 ФИО: ${user.full_name}\n` +
      `📞 Номер: ${user.phone}`,
    { parse_mode: "HTML" }
  );
}

async function handleSupport(ctx: Context) {
  const managersKb = await getManagersKeyboard();
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
