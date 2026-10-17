import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient, User } from "@prisma/client";
import type { Bot, Context } from "grammy";
import { notifyStatusChange, notifyResetDecision, notifyInTransit } from "./notify";

function fakeDb(user: Partial<User> | null) {
  return {
    user: { findUnique: vi.fn().mockResolvedValue(user) },
  } as unknown as PrismaClient;
}

function fakeBot() {
  return { api: { sendMessage: vi.fn().mockResolvedValue(undefined) } } as unknown as Bot<Context>;
}

describe("notifyStatusChange", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing when the user doesn't exist", async () => {
    const bot = fakeBot();
    const db = fakeDb(null);
    await notifyStatusChange(bot, db, 1, "DIX-0001", ["TRACK1"], "IN_OFFICE");
    expect(bot.api.sendMessage).not.toHaveBeenCalled();
  });

  it("does nothing when the user was never linked to Telegram (negative id)", async () => {
    const bot = fakeBot();
    const db = fakeDb({ telegram_id: -123n });
    await notifyStatusChange(bot, db, 1, "DIX-0001", ["TRACK1"], "IN_OFFICE");
    expect(bot.api.sendMessage).not.toHaveBeenCalled();
  });

  it("sends a single-package IN_OFFICE message", async () => {
    const bot = fakeBot();
    const db = fakeDb({ telegram_id: 555n });
    await notifyStatusChange(bot, db, 1, "DIX-0001", ["TRACK1"], "IN_OFFICE", 2.5, 500);

    expect(bot.api.sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, opts] = (bot.api.sendMessage as any).mock.calls[0];
    expect(chatId).toBe(555);
    expect(text).toContain("Ваша посылка прибыла в офис");
    expect(text).toContain("DIX-0001");
    expect(text).toContain("TRACK1");
    expect(text).toContain("2.5 кг");
    expect(text).toContain("500");
    expect(opts).toEqual({ parse_mode: "HTML" });
  });

  it("sends a pluralized message for multiple packages", async () => {
    const bot = fakeBot();
    const db = fakeDb({ telegram_id: 555n });
    await notifyStatusChange(bot, db, 1, "DIX-0001", ["TRACK1", "TRACK2"], "IN_OFFICE");

    const [, text] = (bot.api.sendMessage as any).mock.calls[0];
    expect(text).toContain("2 посылок прибыли в офис");
    expect(text).toContain("TRACK1");
    expect(text).toContain("TRACK2");
  });

  it("sends a DELIVERED message", async () => {
    const bot = fakeBot();
    const db = fakeDb({ telegram_id: 555n });
    await notifyStatusChange(bot, db, 1, "DIX-0001", ["TRACK1"], "DELIVERED");

    const [, text] = (bot.api.sendMessage as any).mock.calls[0];
    expect(text).toContain("Ваша посылка выдана");
  });

  it("sends a pluralized DELIVERED message for multiple packages", async () => {
    const bot = fakeBot();
    const db = fakeDb({ telegram_id: 555n });
    await notifyStatusChange(bot, db, 1, "DIX-0001", ["TRACK1", "TRACK2"], "DELIVERED");

    const [, text] = (bot.api.sendMessage as any).mock.calls[0];
    expect(text).toContain("2 посылок выдано");
  });

  it("omits weight/price lines when not provided", async () => {
    const bot = fakeBot();
    const db = fakeDb({ telegram_id: 555n });
    await notifyStatusChange(bot, db, 1, "DIX-0001", ["TRACK1"], "IN_OFFICE");

    const [, text] = (bot.api.sendMessage as any).mock.calls[0];
    expect(text).not.toContain("Вес:");
    expect(text).not.toContain("К оплате:");
  });

  it("swallows errors instead of throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const bot = fakeBot();
    (bot.api.sendMessage as any).mockRejectedValue(new Error("network down"));
    const db = fakeDb({ telegram_id: 555n });

    await expect(
      notifyStatusChange(bot, db, 1, "DIX-0001", ["TRACK1"], "IN_OFFICE")
    ).resolves.toBeUndefined();
  });
});

describe("notifyInTransit", () => {
  it("skips users not linked to Telegram", async () => {
    const bot = fakeBot();
    expect(await notifyInTransit(bot, -1n, "DIX-0001", ["T1"])).toBe(false);
    expect(bot.api.sendMessage).not.toHaveBeenCalled();
  });

  it("sends all tracks in one message", async () => {
    const bot = fakeBot();
    expect(await notifyInTransit(bot, 555n, "DIX-0001", ["T1", "T2"])).toBe(true);
    expect(bot.api.sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, opts] = (bot.api.sendMessage as any).mock.calls[0];
    expect(chatId).toBe(555);
    expect(text).toContain("2 посылок в пути");
    expect(text).toContain("T1");
    expect(text).toContain("T2");
    expect(opts).toEqual({ parse_mode: "HTML" });
  });

  it("caps the track list to stay within Telegram limits", async () => {
    const bot = fakeBot();
    const tracks = Array.from({ length: 60 }, (_, i) => `TRACK${i}`);
    await notifyInTransit(bot, 555n, "DIX-0001", tracks);
    const [, text] = (bot.api.sendMessage as any).mock.calls[0];
    expect(text).toContain("60 посылок в пути");
    expect(text).toContain("…и ещё 10");
    expect(text).not.toContain("TRACK55");
  });

  it("returns false when Telegram rejects the message", async () => {
    const bot = fakeBot();
    (bot.api.sendMessage as any).mockRejectedValueOnce(new Error("blocked"));
    expect(await notifyInTransit(bot, 555n, "DIX-0001", ["T1"])).toBe(false);
  });
});

describe("notifyResetDecision", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends an approval message", async () => {
    const bot = fakeBot();
    await notifyResetDecision(bot, 555n, true);

    expect(bot.api.sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, opts] = (bot.api.sendMessage as any).mock.calls[0];
    expect(chatId).toBe(555);
    expect(text).toContain("успешно сброшен");
    expect(opts).toEqual({ parse_mode: "HTML" });
  });

  it("sends a rejection message", async () => {
    const bot = fakeBot();
    await notifyResetDecision(bot, 555n, false);

    const [, text] = (bot.api.sendMessage as any).mock.calls[0];
    expect(text).toContain("отклонена");
  });

  it("swallows errors instead of throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const bot = fakeBot();
    (bot.api.sendMessage as any).mockRejectedValue(new Error("network down"));

    await expect(notifyResetDecision(bot, 555n, true)).resolves.toBeUndefined();
  });
});
