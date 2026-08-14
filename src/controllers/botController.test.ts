import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient, User } from "@prisma/client";
import type { Bot, Context } from "grammy";

vi.mock("../database/prismaClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../database/prismaClient")>();
  return { ...actual, getPrisma: vi.fn() };
});

import { registerControllers, __resetRegStateForTests } from "./botController";
import { getPrisma } from "../database/prismaClient";

// ── Test harness: a fake Bot that just records registered handlers ─────────────

type Handler = (ctx: any) => unknown;

class FakeBot {
  handlers: { kind: "command" | "on" | "callbackQuery"; trigger: any; fn: Handler }[] = [];
  api = { sendMessage: vi.fn(), setMyCommands: vi.fn() };
  command(name: string, fn: Handler) { this.handlers.push({ kind: "command", trigger: name, fn }); }
  on(event: string, fn: Handler) { this.handlers.push({ kind: "on", trigger: event, fn }); }
  callbackQuery(trigger: string | RegExp, fn: Handler) { this.handlers.push({ kind: "callbackQuery", trigger, fn }); }
  catch() {}
}

function setupBot() {
  const bot = new FakeBot();
  registerControllers(bot as unknown as Bot<Context>);
  return bot;
}

function findHandler(bot: FakeBot, kind: "command" | "on" | "callbackQuery", trigger: string) {
  const found = bot.handlers.find((h) => h.kind === kind && String(h.trigger) === trigger || (h.trigger instanceof RegExp && h.trigger.test(trigger)));
  if (!found) throw new Error(`No ${kind} handler matching "${trigger}"`);
  return found.fn;
}

function findRegexHandler(bot: FakeBot, kind: "callbackQuery", pattern: RegExp) {
  const found = bot.handlers.find((h) => h.kind === kind && String(h.trigger) === String(pattern));
  if (!found) throw new Error(`No ${kind} handler matching ${pattern}`);
  return found.fn;
}

function fakeCtx(overrides: Record<string, unknown> = {}) {
  return {
    from: { id: 111 },
    reply: vi.fn().mockResolvedValue(undefined),
    replyWithPhoto: vi.fn().mockResolvedValue(undefined),
    replyWithVideo: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as any;
}

function fakeDb(overrides: Record<string, any> = {}) {
  const base = {
    user: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
    },
    package: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    promoCode: {
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    setting: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    accessResetRequest: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
    },
  };
  for (const [model, methods] of Object.entries(overrides)) {
    Object.assign((base as any)[model], methods);
  }
  return base as unknown as PrismaClient;
}

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    telegram_id: 111n,
    phone: "500100500",
    full_name: "Иван Иванов",
    client_code: "DIX-0001",
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  } as User;
}

const getPrismaMock = vi.mocked(getPrisma);

beforeEach(() => {
  getPrismaMock.mockReset();
  getPrismaMock.mockImplementation(() => fakeDb());
  __resetRegStateForTests();
});

// ── /start ───────────────────────────────────────────────────────────────────

describe("/start", () => {
  it("does nothing without a from id", async () => {
    const bot = setupBot();
    const handler = findHandler(bot, "command", "start");
    const ctx = fakeCtx({ from: undefined });
    await handler(ctx);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("shows the profile for an already-registered user", async () => {
    const user = fakeUser();
    getPrismaMock.mockImplementation(() => fakeDb({ user: { findUnique: vi.fn().mockResolvedValue(user) } }));

    const bot = setupBot();
    const handler = findHandler(bot, "command", "start");
    const ctx = fakeCtx();
    await handler(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("DIX-0001"),
      expect.objectContaining({ parse_mode: "HTML" })
    );
  });

  it("prompts branch selection for a new user", async () => {
    const bot = setupBot();
    const handler = findHandler(bot, "command", "start");
    const ctx = fakeCtx();
    await handler(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Выберите ваш филиал"),
      expect.objectContaining({
        reply_markup: expect.objectContaining({
          inline_keyboard: [[
            expect.objectContaining({ callback_data: "branch_bishkek" }),
            expect.objectContaining({ callback_data: "branch_kant" }),
          ]],
        }),
      })
    );
  });
});

describe("branch selection callback", () => {
  it("prompts for a phone number after choosing a branch", async () => {
    const bot = setupBot();
    const handler = findRegexHandler(bot, "callbackQuery", /^branch_(bishkek|kant)$/);
    const ctx = fakeCtx({ match: ["branch_kant", "kant"] });

    await handler(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("г. Кант"), expect.any(Object));
  });
});

// ── Меню-команды ─────────────────────────────────────────────────────────────

describe("menu commands", () => {
  it("/packages shows the status filter keyboard", async () => {
    const bot = setupBot();
    const handler = findHandler(bot, "command", "packages");
    const ctx = fakeCtx();
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Мои посылки"), expect.any(Object));
  });

  it("/forbidden shows the configured text", async () => {
    getPrismaMock.mockImplementation(() =>
      fakeDb({ setting: { findUnique: vi.fn().mockResolvedValue({ key: "forbidden_items", value: "Нельзя вывозить золото" } as any) } })
    );
    const bot = setupBot();
    const handler = findHandler(bot, "command", "forbidden");
    const ctx = fakeCtx();
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith("Нельзя вывозить золото", expect.any(Object));
  });

  it("/addresses shows the Bishkek office address", async () => {
    const bot = setupBot();
    const handler = findHandler(bot, "command", "addresses");
    const ctx = fakeCtx();
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Айбек-Ата"), expect.any(Object));
  });

  it("/addresses uses the text configured in the admin panel", async () => {
    getPrismaMock.mockImplementation(() => fakeDb({
      setting: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockImplementation(({ where }: any) =>
          where.key === "addresses_text" ? { key: "addresses_text", value: "Свой текст адресов" } : null),
      },
    }));
    const bot = setupBot();
    const handler = findHandler(bot, "command", "addresses");
    const ctx = fakeCtx();
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith("Свой текст адресов", expect.any(Object));
  });

  it("/profile tells an unregistered user to /start", async () => {
    const bot = setupBot();
    const handler = findHandler(bot, "command", "profile");
    const ctx = fakeCtx();
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("не зарегистрированы"));
  });

  it("/profile shows the profile for a registered user", async () => {
    getPrismaMock.mockImplementation(() => fakeDb({ user: { findUnique: vi.fn().mockResolvedValue(fakeUser()) } }));
    const bot = setupBot();
    const handler = findHandler(bot, "command", "profile");
    const ctx = fakeCtx();
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("DIX-0001"), expect.any(Object));
  });

  it("/support shows the support text and manager buttons", async () => {
    const bot = setupBot();
    const handler = findHandler(bot, "command", "support");
    const ctx = fakeCtx();
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Поддержка"), expect.any(Object));
  });

  it("/support uses the text configured in the admin panel", async () => {
    getPrismaMock.mockImplementation(() => fakeDb({
      setting: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockImplementation(({ where }: any) =>
          where.key === "support_text" ? { key: "support_text", value: "Свой текст поддержки" } : null),
      },
    }));
    const bot = setupBot();
    const handler = findHandler(bot, "command", "support");
    const ctx = fakeCtx();
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith("Свой текст поддержки", expect.any(Object));
  });

  it("/template shows the marketplace picker", async () => {
    const bot = setupBot();
    const handler = findHandler(bot, "command", "template");
    const ctx = fakeCtx();
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("маркетплейс"), expect.any(Object));
  });
});

describe("template/instruction callbacks", () => {
  it("template_pinduoduo replies with the warehouse address and instructions menu", async () => {
    const bot = setupBot();
    const handler = findHandler(bot, "callbackQuery", "template_pinduoduo");
    const ctx = fakeCtx();
    await handler(ctx);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledTimes(2);
  });

  it("template_taobao replies with the Taobao template", async () => {
    const bot = setupBot();
    const handler = findHandler(bot, "callbackQuery", "template_taobao");
    const ctx = fakeCtx();
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Taobao"), expect.any(Object));
  });

  it("instruction_1688 replies with a placeholder", async () => {
    const bot = setupBot();
    const handler = findHandler(bot, "callbackQuery", "instruction_1688");
    const ctx = fakeCtx();
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("1688"), expect.any(Object));
  });
});

describe("marketplace address callback", () => {
  it("sends the address, photo, video and manager buttons for a registered user", async () => {
    getPrismaMock.mockImplementation(() => fakeDb({ user: { findUnique: vi.fn().mockResolvedValue(fakeUser()) } }));
    const bot = setupBot();
    const handler = findHandler(bot, "callbackQuery", "address_pinduoduo");
    const ctx = fakeCtx();
    await handler(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("DIX-0001"), expect.any(Object));
    expect(ctx.replyWithPhoto).toHaveBeenCalled();
    expect(ctx.replyWithVideo).toHaveBeenCalled();
  });

  it("falls back to a placeholder code for an unregistered user", async () => {
    const bot = setupBot();
    const handler = findHandler(bot, "callbackQuery", "address_taobao");
    const ctx = fakeCtx();
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("????"), expect.any(Object));
  });
});

describe("reset_request callback", () => {
  it("creates a reset request and confirms submission", async () => {
    const create = vi.fn().mockResolvedValue({ id: 1 });
    getPrismaMock.mockImplementation(() => fakeDb({
      user: { findUnique: vi.fn().mockResolvedValue(fakeUser({ id: 42 })) },
      accessResetRequest: { findFirst: vi.fn().mockResolvedValue(null), create },
    }));

    const bot = setupBot();
    const handler = findRegexHandler(bot, "callbackQuery", /^reset_request:(bishkek|kant):(\d+)$/);
    const ctx = fakeCtx({ from: { id: 999 }, match: ["reset_request:kant:42", "kant", "42"] });
    await handler(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({ data: { user_id: 42, requested_telegram_id: 999n } });
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Заявка на сброс доступа отправлена"));
  });

  it("updates the existing pending request instead of duplicating it", async () => {
    const update = vi.fn().mockResolvedValue({ id: 7 });
    getPrismaMock.mockImplementation(() => fakeDb({
      user: { findUnique: vi.fn().mockResolvedValue(fakeUser({ id: 42 })) },
      accessResetRequest: { findFirst: vi.fn().mockResolvedValue({ id: 7, user_id: 42, requested_telegram_id: 111n, status: "PENDING" }), update },
    }));

    const bot = setupBot();
    const handler = findRegexHandler(bot, "callbackQuery", /^reset_request:(bishkek|kant):(\d+)$/);
    const ctx = fakeCtx({ from: { id: 999 }, match: ["reset_request:kant:42", "kant", "42"] });
    await handler(ctx);

    expect(update).toHaveBeenCalledWith({ where: { id: 7 }, data: { requested_telegram_id: 999n } });
  });

  it("tells the user when the account no longer exists", async () => {
    getPrismaMock.mockImplementation(() => fakeDb({ user: { findUnique: vi.fn().mockResolvedValue(null) } }));

    const bot = setupBot();
    const handler = findRegexHandler(bot, "callbackQuery", /^reset_request:(bishkek|kant):(\d+)$/);
    const ctx = fakeCtx({ from: { id: 999 }, match: ["reset_request:kant:42", "kant", "42"] });
    await handler(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Не удалось найти аккаунт"));
  });
});

// ── Пакеты (пагинация) ────────────────────────────────────────────────────────

describe("package filter/pagination callbacks", () => {
  it("pkg_filter tells an unregistered user to /start", async () => {
    const bot = setupBot();
    const handler = findRegexHandler(bot, "callbackQuery", /^pkg_filter:(.+)$/);
    const ctx = fakeCtx({ match: ["pkg_filter:IN_OFFICE", "IN_OFFICE"] });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("не зарегистрированы"));
  });

  it("pkg_filter shows a page of packages for a registered user", async () => {
    getPrismaMock.mockImplementation(() =>
      fakeDb({
        user: { findUnique: vi.fn().mockResolvedValue(fakeUser()) },
        package: {
          count: vi.fn().mockResolvedValue(1),
          findMany: vi.fn().mockResolvedValue([
            { track_code: "T1", created_at: new Date(), updated_at: new Date() },
          ]),
        },
      })
    );
    const bot = setupBot();
    const handler = findRegexHandler(bot, "callbackQuery", /^pkg_filter:(.+)$/);
    const ctx = fakeCtx({ match: ["pkg_filter:IN_OFFICE", "IN_OFFICE"] });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("T1"), expect.any(Object));
  });

  it("pkg_filter shows an empty state", async () => {
    getPrismaMock.mockImplementation(() => fakeDb({ user: { findUnique: vi.fn().mockResolvedValue(fakeUser()) } }));
    const bot = setupBot();
    const handler = findRegexHandler(bot, "callbackQuery", /^pkg_filter:(.+)$/);
    const ctx = fakeCtx({ match: ["pkg_filter:IN_OFFICE", "IN_OFFICE"] });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("посылок нет"));
  });

  it("pkg_page shows a specific page", async () => {
    getPrismaMock.mockImplementation(() =>
      fakeDb({
        user: { findUnique: vi.fn().mockResolvedValue(fakeUser()) },
        package: {
          count: vi.fn().mockResolvedValue(10),
          findMany: vi.fn().mockResolvedValue([{ track_code: "T2", created_at: new Date(), updated_at: new Date() }]),
        },
      })
    );
    const bot = setupBot();
    const handler = findRegexHandler(bot, "callbackQuery", /^pkg_page:(\w+):(\d+)$/);
    const ctx = fakeCtx({ match: ["pkg_page:IN_TRANSIT:1", "IN_TRANSIT", "1"] });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("T2"), expect.any(Object));
  });

  it("pkg_search tells an unregistered user to /start", async () => {
    const bot = setupBot();
    const handler = findHandler(bot, "callbackQuery", "pkg_search");
    const ctx = fakeCtx();
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("не зарегистрированы"));
  });
});

// ── Контакт ──────────────────────────────────────────────────────────────────

describe("message:contact", () => {
  it("rejects a contact that isn't the sender's own", async () => {
    const bot = setupBot();
    const handler = findHandler(bot, "on", "message:contact");
    const ctx = fakeCtx({ message: { contact: { user_id: 999, phone_number: "500100500" } } });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("собственным контактом"), expect.any(Object));
  });

  it("asks to /start when there's no active phone step", async () => {
    const bot = setupBot();
    const handler = findHandler(bot, "on", "message:contact");
    const ctx = fakeCtx({ message: { contact: { user_id: 111, phone_number: "500100500" } } });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("/start"), expect.any(Object));
  });

  it("moves to the name step when a phone step is active", async () => {
    const bot = setupBot();
    // put the user into the "phone" step first, via /start + branch selection
    const startHandler = findHandler(bot, "command", "start");
    await startHandler(fakeCtx());
    const branchHandler = findRegexHandler(bot, "callbackQuery", /^branch_(bishkek|kant)$/);
    await branchHandler(fakeCtx({ match: ["branch_bishkek", "bishkek"] }));

    const contactHandler = findHandler(bot, "on", "message:contact");
    const ctx = fakeCtx({ message: { contact: { user_id: 111, phone_number: "500100500" } } });
    await contactHandler(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("ФИО"), expect.any(Object));
  });
});

// ── Текстовые сообщения / регистрация ────────────────────────────────────────

describe("message:text — menu buttons", () => {
  it("dispatches «📦 Мои посылки» to the packages menu", async () => {
    const bot = setupBot();
    const handler = findHandler(bot, "on", "message:text");
    const ctx = fakeCtx({ message: { text: "📦 Мои посылки" } });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Мои посылки"), expect.any(Object));
  });

  it("dispatches «👤 Профиль» for an unregistered user", async () => {
    const bot = setupBot();
    const handler = findHandler(bot, "on", "message:text");
    const ctx = fakeCtx({ message: { text: "👤 Профиль" } });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("не зарегистрированы"));
  });
});

describe("message:text — promo code claim", () => {
  it("requires registration", async () => {
    const bot = setupBot();
    const handler = findHandler(bot, "on", "message:text");
    const ctx = fakeCtx({ message: { text: "🎁 Получить промокод" } });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("не зарегистрированы"));
  });

  it("reports when no promo codes are left", async () => {
    getPrismaMock.mockImplementation(() => fakeDb({ user: { findUnique: vi.fn().mockResolvedValue(fakeUser()) } }));
    const bot = setupBot();
    const handler = findHandler(bot, "on", "message:text");
    const ctx = fakeCtx({ message: { text: "🎁 Получить промокод" } });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("уже разобраны"), expect.any(Object));
  });

  it("claims an available promo code", async () => {
    getPrismaMock.mockImplementation(() =>
      fakeDb({
        user: { findUnique: vi.fn().mockResolvedValue(fakeUser()) },
        promoCode: {
          findFirst: vi.fn().mockResolvedValue({ id: 5, code: "SUMMER25", description: "Скидка 10%" }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      })
    );
    const bot = setupBot();
    const handler = findHandler(bot, "on", "message:text");
    const ctx = fakeCtx({ message: { text: "🎁 Получить промокод" } });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("SUMMER25"), expect.any(Object));
  });

  it("handles a claim race condition", async () => {
    getPrismaMock.mockImplementation(() =>
      fakeDb({
        user: { findUnique: vi.fn().mockResolvedValue(fakeUser()) },
        promoCode: {
          findFirst: vi.fn().mockResolvedValue({ id: 5, code: "SUMMER25", description: null }),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      })
    );
    const bot = setupBot();
    const handler = findHandler(bot, "on", "message:text");
    const ctx = fakeCtx({ message: { text: "🎁 Получить промокод" } });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("уже был получен"), expect.any(Object));
  });
});

describe("message:text — track lookup without an active step", () => {
  it("asks unregistered users to /start", async () => {
    const bot = setupBot();
    const handler = findHandler(bot, "on", "message:text");
    const ctx = fakeCtx({ message: { text: "TRACK123" } });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("/start"));
  });

  it("reports a package not found", async () => {
    getPrismaMock.mockImplementation(() => fakeDb({ user: { findUnique: vi.fn().mockResolvedValue(fakeUser()) } }));
    const bot = setupBot();
    const handler = findHandler(bot, "on", "message:text");
    const ctx = fakeCtx({ message: { text: "TRACK123" } });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("не найдена"), expect.any(Object));
  });

  it("reports a found package", async () => {
    getPrismaMock.mockImplementation(() =>
      fakeDb({
        user: { findUnique: vi.fn().mockResolvedValue(fakeUser()) },
        package: {
          findFirst: vi.fn().mockResolvedValue({ track_code: "TRACK123", status: "IN_TRANSIT", created_at: new Date(), updated_at: new Date() }),
        },
      })
    );
    const bot = setupBot();
    const handler = findHandler(bot, "on", "message:text");
    const ctx = fakeCtx({ message: { text: "TRACK123" } });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("TRACK123"), expect.any(Object));
  });
});

describe("message:text — registration flow", () => {
  async function startAndSelectBranch(bot: FakeBot, senderId = 111) {
    const startHandler = findHandler(bot, "command", "start");
    await startHandler(fakeCtx({ from: { id: senderId } }));
    const branchHandler = findRegexHandler(bot, "callbackQuery", /^branch_(bishkek|kant)$/);
    await branchHandler(fakeCtx({ from: { id: senderId }, match: ["branch_bishkek", "bishkek"] }));
  }

  it("nudges the user to press a branch button while awaiting selection", async () => {
    const bot = setupBot();
    await findHandler(bot, "command", "start")(fakeCtx());

    const handler = findHandler(bot, "on", "message:text");
    const ctx = fakeCtx({ message: { text: "hello" } });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("выберите филиал"), expect.any(Object));
  });

  it("rejects a malformed phone number", async () => {
    const bot = setupBot();
    await startAndSelectBranch(bot);

    const handler = findHandler(bot, "on", "message:text");
    const ctx = fakeCtx({ message: { text: "abc" } });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Неверный формат"), expect.any(Object));
  });

  it("moves to the name step for a brand-new phone number", async () => {
    const bot = setupBot();
    await startAndSelectBranch(bot);

    const handler = findHandler(bot, "on", "message:text");
    const ctx = fakeCtx({ message: { text: "500100500" } });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("ФИО"), expect.any(Object));
  });

  it("shows the profile when the phone is already linked to this Telegram account", async () => {
    const linked = fakeUser({ telegram_id: 111n });
    getPrismaMock.mockImplementation(() => fakeDb({ user: { findFirst: vi.fn().mockResolvedValue(linked) } }));

    const bot = setupBot();
    await startAndSelectBranch(bot);

    const handler = findHandler(bot, "on", "message:text");
    const ctx = fakeCtx({ message: { text: "500100500" } });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("DIX-0001"), expect.any(Object));
  });

  it("rejects a phone already linked to a different Telegram account, offering a reset button", async () => {
    const linked = fakeUser({ id: 42, telegram_id: 222n });
    getPrismaMock.mockImplementation(() => fakeDb({ user: { findFirst: vi.fn().mockResolvedValue(linked) } }));

    const bot = setupBot();
    await startAndSelectBranch(bot);

    const handler = findHandler(bot, "on", "message:text");
    const ctx = fakeCtx({ message: { text: "500100500" } });
    await handler(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("уже зарегистрирован"),
      expect.objectContaining({
        reply_markup: {
          inline_keyboard: [[{ text: "Сбросить доступ", callback_data: "reset_request:bishkek:42" }]],
        },
      })
    );
  });

  it("links an admin-created (unlinked) account to Telegram", async () => {
    const unlinked = fakeUser({ telegram_id: -1700000000000n });
    const update = vi.fn().mockResolvedValue({ ...unlinked, telegram_id: 111n });
    getPrismaMock.mockImplementation(() => fakeDb({ user: { findFirst: vi.fn().mockResolvedValue(unlinked), update } }));

    const bot = setupBot();
    await startAndSelectBranch(bot);

    const handler = findHandler(bot, "on", "message:text");
    const ctx = fakeCtx({ message: { text: "500100500" } });
    await handler(ctx);

    expect(update).toHaveBeenCalledWith({ where: { id: unlinked.id }, data: { telegram_id: 111n } });
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("DIX-0001"), expect.any(Object));
  });

  it("rejects an incomplete name", async () => {
    const bot = setupBot();
    await startAndSelectBranch(bot);
    const handler = findHandler(bot, "on", "message:text");
    await handler(fakeCtx({ message: { text: "500100500" } }));

    const ctx = fakeCtx({ message: { text: "Иван" } });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("полное ФИО"));
  });

  it("creates the user and sends the profile + registration address", async () => {
    const created = fakeUser();
    getPrismaMock.mockImplementation(() => fakeDb({ user: { create: vi.fn().mockResolvedValue(created) } }));

    const bot = setupBot();
    await startAndSelectBranch(bot);
    const handler = findHandler(bot, "on", "message:text");
    await handler(fakeCtx({ message: { text: "500100500" } }));

    const ctx = fakeCtx({ message: { text: "Иван Иванов" } });
    await handler(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("DIX-0001"), expect.any(Object));
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Ваш адрес"), expect.any(Object));
  });

  it("reports a database error during registration instead of crashing", async () => {
    getPrismaMock.mockImplementation(() => fakeDb({ user: { create: vi.fn().mockRejectedValue(new Error("db down")) } }));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const bot = setupBot();
    await startAndSelectBranch(bot);
    const handler = findHandler(bot, "on", "message:text");
    await handler(fakeCtx({ message: { text: "500100500" } }));

    const ctx = fakeCtx({ message: { text: "Иван Иванов" } });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Произошла ошибка"));
  });

  it("track_search step reports a found package and clears the state", async () => {
    getPrismaMock.mockImplementation(() =>
      fakeDb({
        user: { findUnique: vi.fn().mockResolvedValue(fakeUser()), findFirst: vi.fn().mockResolvedValue(fakeUser()) },
        package: { findFirst: vi.fn().mockResolvedValue({ track_code: "T9", status: "IN_TRANSIT", created_at: new Date(), updated_at: new Date() }) },
      })
    );
    const bot = setupBot();
    const searchHandler = findHandler(bot, "callbackQuery", "pkg_search");
    await searchHandler(fakeCtx());

    const handler = findHandler(bot, "on", "message:text");
    const ctx = fakeCtx({ message: { text: "T9" } });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("T9"), expect.any(Object));
  });

  it("shows the profile again if it's already created mid-flow (race condition)", async () => {
    const existing = fakeUser();
    getPrismaMock.mockImplementation(() => fakeDb({ user: { findUnique: vi.fn().mockResolvedValue(existing) } }));

    const bot = setupBot();
    await startAndSelectBranch(bot);
    const handler = findHandler(bot, "on", "message:text");
    await handler(fakeCtx({ message: { text: "500100500" } }));

    const ctx = fakeCtx({ message: { text: "Иван Иванов" } });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("DIX-0001"), expect.objectContaining({ parse_mode: "HTML" }));
  });
});

describe("message:text — remaining menu buttons", () => {
  it("dispatches «🚫 Запрещенные товары»", async () => {
    const bot = setupBot();
    const handler = findHandler(bot, "on", "message:text");
    const ctx = fakeCtx({ message: { text: "🚫 Запрещенные товары" } });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.any(String), expect.any(Object));
  });

  it("dispatches «📍 Адреса»", async () => {
    const bot = setupBot();
    const handler = findHandler(bot, "on", "message:text");
    const ctx = fakeCtx({ message: { text: "📍 Адреса" } });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Айбек-Ата"), expect.any(Object));
  });

  it("dispatches «💬 Поддержка»", async () => {
    const bot = setupBot();
    const handler = findHandler(bot, "on", "message:text");
    const ctx = fakeCtx({ message: { text: "💬 Поддержка" } });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Поддержка"), expect.any(Object));
  });

  it("dispatches «📋 Шаблон заполнения»", async () => {
    const bot = setupBot();
    const handler = findHandler(bot, "on", "message:text");
    const ctx = fakeCtx({ message: { text: "📋 Шаблон заполнения" } });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("маркетплейс"), expect.any(Object));
  });
});

describe("early returns without a sender id", () => {
  it("message:contact rejects when there's no sender id", async () => {
    const bot = setupBot();
    const handler = findHandler(bot, "on", "message:contact");
    const ctx = fakeCtx({ from: undefined, message: { contact: { user_id: 111, phone_number: "500100500" } } });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("собственным контактом"), expect.any(Object));
  });

  it("message:text does nothing", async () => {
    const bot = setupBot();
    const handler = findHandler(bot, "on", "message:text");
    const ctx = fakeCtx({ from: undefined, message: { text: "hi" } });
    await handler(ctx);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("pkg_search does nothing", async () => {
    const bot = setupBot();
    const handler = findHandler(bot, "callbackQuery", "pkg_search");
    const ctx = fakeCtx({ from: undefined });
    await handler(ctx);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("/profile does nothing", async () => {
    const bot = setupBot();
    const handler = findHandler(bot, "command", "profile");
    const ctx = fakeCtx({ from: undefined });
    await handler(ctx);
    expect(ctx.reply).not.toHaveBeenCalled();
  });
});

describe("non-IN_TRANSIT package replies include the arrival date", () => {
  it("track lookup for a DELIVERED package", async () => {
    getPrismaMock.mockImplementation(() =>
      fakeDb({
        user: { findUnique: vi.fn().mockResolvedValue(fakeUser()) },
        package: {
          findFirst: vi.fn().mockResolvedValue({ track_code: "T9", status: "DELIVERED", created_at: new Date(), updated_at: new Date() }),
        },
      })
    );
    const bot = setupBot();
    const handler = findHandler(bot, "on", "message:text");
    const ctx = fakeCtx({ message: { text: "T9" } });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Дата поступления"), expect.any(Object));
  });

  it("pkg_filter for a DELIVERED package", async () => {
    getPrismaMock.mockImplementation(() =>
      fakeDb({
        user: { findUnique: vi.fn().mockResolvedValue(fakeUser()) },
        package: {
          count: vi.fn().mockResolvedValue(1),
          findMany: vi.fn().mockResolvedValue([{ track_code: "T1", status: "DELIVERED", created_at: new Date(), updated_at: new Date() }]),
        },
      })
    );
    const bot = setupBot();
    const handler = findRegexHandler(bot, "callbackQuery", /^pkg_filter:(.+)$/);
    const ctx = fakeCtx({ match: ["pkg_filter:DELIVERED", "DELIVERED"] });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Дата поступления"), expect.any(Object));
  });
});

describe("promo code claim without a description", () => {
  it("omits the description line when claiming succeeds", async () => {
    getPrismaMock.mockImplementation(() =>
      fakeDb({
        user: { findUnique: vi.fn().mockResolvedValue(fakeUser()) },
        promoCode: {
          findFirst: vi.fn().mockResolvedValue({ id: 5, code: "SUMMER25", description: null }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      })
    );
    const bot = setupBot();
    const handler = findHandler(bot, "on", "message:text");
    const ctx = fakeCtx({ message: { text: "🎁 Получить промокод" } });
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("SUMMER25"), expect.any(Object));
  });
});

describe("getMarketplaceText with a saved setting", () => {
  it("uses the saved template instead of the built-in default", async () => {
    getPrismaMock.mockImplementation(() =>
      fakeDb({
        user: { findUnique: vi.fn().mockResolvedValue(fakeUser()) },
        setting: { findUnique: vi.fn().mockResolvedValue({ key: "marketplace_pinduoduo", value: "Custom address for {code}" }) },
      })
    );
    const bot = setupBot();
    const handler = findHandler(bot, "callbackQuery", "address_pinduoduo");
    const ctx = fakeCtx();
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Custom address for DIX-0001"), expect.any(Object));
  });
});
