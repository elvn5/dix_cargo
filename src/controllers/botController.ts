import { Bot, Context, InputFile } from "grammy";
import { userService } from "../services/userService";
import prisma from "../database/prismaClient";
import path from "path";

type RegStep =
  | { step: "phone" }
  | { step: "name"; phone: string };

const regState = new Map<number, RegStep>();

const MENU_KEYBOARD = {
  keyboard: [
    [{ text: "📦 Мои посылки" }, { text: "🚫 Запрещенные товары" }],
    [{ text: "📍 Адреса" }, { text: "👤 Профиль" }],
    [{ text: "💬 Поддержка" }, { text: "📋 Шаблон заполнения" }],
  ],
  resize_keyboard: true,
  persistent: true,
};

const MANAGERS_KEYBOARD = {
  inline_keyboard: [
    [
      { text: "Лидия",    url: "https://wa.me/996550867414" },
      { text: "Виктория", url: "https://wa.me/996556969906" },
    ],
  ],
};

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
          reply_markup: MENU_KEYBOARD,
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


  // ── Адрес Pinduoduo ───────────────────────────────────────────────────────────
  bot.callbackQuery("address_pinduoduo", async (ctx) => {
    await ctx.answerCallbackQuery();

    const telegramId = ctx.from?.id;
    const user = telegramId
      ? await userService.findUserByTelegramId(BigInt(telegramId))
      : null;
    const code = user?.client_code ?? "????";

    const addressLines =
      `八 ${code}\n` +
      `广东省佛山市南海区里水镇大石社区石紫岗工业区石一石二工业路27号321国际仓\n` +
      `13763369694 八${code}`;

    const infoText =
      `Скопируйте адрес и вставьте в приложении. Сверьте с шаблоном ниже.\n` +
      `Чтобы ваши посылки не потерялись, обязательно отправьте скриншот заполненного адреса на проверку и получите подтверждение от нашего менеджера.\n` +
      `Только после подтверждения адреса, Карго несет ответственность за ваши посылки.`;

    await ctx.reply(`<code>${addressLines}</code>\n\n${infoText}`, {
      parse_mode: "HTML",
    });

    const photoPath = path.join(__dirname, "../assets/pinduoduo_photo.jpg");
    await ctx.replyWithPhoto(new InputFile(photoPath));

    const videoPath = path.join(__dirname, "../assets/pinduoduo_video.MP4");
    await ctx.replyWithVideo(new InputFile(videoPath));

    await ctx.reply("📩 Готово? Отправьте скриншот на проверку:", {
      reply_markup: MANAGERS_KEYBOARD,
    });
  });

  for (const key of ["address_taobao", "address_1688", "address_poizon"] as const) {
    bot.callbackQuery(key, async (ctx) => {
      await ctx.answerCallbackQuery();

      const telegramId = ctx.from?.id;
      const user = telegramId
        ? await userService.findUserByTelegramId(BigInt(telegramId))
        : null;
      const code = user?.client_code ?? "????";

      const addressLines =
        `八 ${code}\n` +
        `广东省佛山市南海区里水镇大石社区石紫岗工业区石一石二工业路27号321国际仓\n` +
        `13763369694 八${code}`;

      const infoText =
        `Скопируйте адрес и вставьте в приложении. Сверьте с шаблоном ниже.\n` +
        `Чтобы ваши посылки не потерялись, обязательно отправьте скриншот заполненного адреса на проверку и получите подтверждение от нашего менеджера.\n` +
        `Только после подтверждения адреса, Карго несет ответственность за ваши посылки.`;

      await ctx.reply(`<code>${addressLines}</code>\n\n${infoText}`, { parse_mode: "HTML" });

      const photoPath = path.join(__dirname, "../assets/pinduoduo_photo.jpg");
      await ctx.replyWithPhoto(new InputFile(photoPath));

      const videoPath = path.join(__dirname, "../assets/pinduoduo_video.MP4");
      await ctx.replyWithVideo(new InputFile(videoPath));

      await ctx.reply("📩 Готово? Отправьте скриншот на проверку:", {
        reply_markup: MANAGERS_KEYBOARD,
      });
    });
  }

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

    // Шаги регистрации
    const state = regState.get(senderId);
    if (!state) {
      await ctx.reply("Отправьте /start для начала работы.");
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
            { parse_mode: "HTML", reply_markup: MENU_KEYBOARD }
          );
          return;
        }

        const newUser = await userService.createUser(
          BigInt(senderId),
          state.phone,
          text
        );

        await ctx.reply(
          buildProfile(newUser.client_code, newUser.full_name, newUser.phone),
          { parse_mode: "HTML", reply_markup: MANAGERS_KEYBOARD }
        );
        await ctx.reply("Выберите раздел:", { reply_markup: MENU_KEYBOARD });
      } catch (error) {
        console.error("[Registration] Ошибка при создании пользователя:", error);
        await ctx.reply("⚠️ Произошла ошибка при регистрации. Попробуйте позже.");
      }
    }
  });
}

// ── Обработчики кнопок меню ───────────────────────────────────────────────────

async function handlePackages(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await userService.findUserByTelegramId(BigInt(telegramId));
  if (!user) {
    await ctx.reply("❌ Вы не зарегистрированы. Отправьте /start.");
    return;
  }

  const packages = await prisma.package.findMany({
    where: { user_id: user.id },
    orderBy: { created_at: "desc" },
  });

  if (packages.length === 0) {
    await ctx.reply("📦 <b>Мои посылки</b>\n\nУ вас пока нет посылок.", { parse_mode: "HTML" });
    return;
  }

  const STATUS_LABEL: Record<string, string> = {
    IN_OFFICE:  "🏢 В офисе",
    IN_TRANSIT: "🚚 В пути",
    DELIVERED:  "✅ Выдан",
  };

  const lines = packages.map((p) =>
    `📦 <code>${p.track_code}</code>\n` +
    `   Статус: ${STATUS_LABEL[p.status]}\n` +
    `   Добавлена: ${p.created_at.toLocaleDateString("ru-RU")}`
  ).join("\n\n");

  await ctx.reply(`📦 <b>Мои посылки</b>\n\n${lines}`, { parse_mode: "HTML" });
}

async function handleForbidden(ctx: Context) {
  const setting = await prisma.setting.findUnique({ where: { key: "forbidden_items" } });
  const text = setting?.value ?? "⚠️ Информация временно недоступна.";

  await ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Лидия",    url: "https://wa.me/996550867414" },
          { text: "Виктория", url: "https://wa.me/996556969906" },
        ],
      ],
    },
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
  await ctx.reply(
    "💬 <b>Поддержка</b>\n\nСвяжитесь с нами любым удобным способом:\n\n" +
      "📍 Адрес: Бишкек, Айбек-Ата 1/2\n" +
      "🕒 График работы: Ежедневно с 9:00 до 19:00\n" +
      "📌 Локация на карте: <a href=\"https://go.2gis.com/bwSnG\">AsDi Cargo</a>",
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Лидия",    url: "https://wa.me/996550867414" },
            { text: "Виктория", url: "https://wa.me/996556969906" },
          ],
          [
            {
              text: "📸 Instagram: dix_cargo",
              url: "https://www.instagram.com/dix_cargo/",
            },
          ],
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
