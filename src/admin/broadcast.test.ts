import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Bot, Context } from "grammy";
import type { PrismaClient } from "@prisma/client";
import {
  sanitizeTelegramHtml,
  plainTextLength,
  sendToChat,
  sendBroadcast,
  type BroadcastFile,
} from "./broadcast";

function fakeBot() {
  const api = {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendPhoto: vi.fn().mockResolvedValue(undefined),
    sendVideo: vi.fn().mockResolvedValue(undefined),
    sendDocument: vi.fn().mockResolvedValue(undefined),
    sendMediaGroup: vi.fn().mockResolvedValue(undefined),
  };
  return { bot: { api } as unknown as Bot<Context>, api };
}

function file(name: string, mimetype: string): BroadcastFile {
  return { buffer: Buffer.from("x"), filename: name, mimetype };
}

function dbWith(users: { telegram_id: bigint }[]) {
  const findMany = vi.fn().mockResolvedValue(users);
  const count = vi.fn().mockResolvedValue(users.length);
  return { db: { user: { findMany, count } } as unknown as PrismaClient, findMany, count };
}

describe("sanitizeTelegramHtml", () => {
  it("keeps Telegram-supported tags", () => {
    expect(sanitizeTelegramHtml("<b>bold</b> <i>it</i> <code>x</code>")).toBe("<b>bold</b> <i>it</i> <code>x</code>");
  });

  it("normalizes aliases to canonical tags", () => {
    expect(sanitizeTelegramHtml("<strong>a</strong><em>b</em><del>c</del><ins>d</ins>")).toBe("<b>a</b><i>b</i><s>c</s><u>d</u>");
  });

  it("removes unsupported tags leaving inner text", () => {
    expect(sanitizeTelegramHtml("<div>hi</div>")).toBe("hi");
    expect(sanitizeTelegramHtml("<span>plain</span>")).toBe("plain");
    expect(sanitizeTelegramHtml("<div>hi</div><script>bad()</script>")).toBe("hibad()");
  });

  it("converts <br> to a newline", () => {
    expect(sanitizeTelegramHtml("a<br>b")).toBe("a\nb");
  });

  it("keeps valid links and strips invalid ones without leaving a stray close tag", () => {
    expect(sanitizeTelegramHtml('<a href="https://x.io">go</a>')).toBe('<a href="https://x.io">go</a>');
    expect(sanitizeTelegramHtml('<a href="javascript:alert(1)">go</a>')).toBe("go");
  });

  it("keeps a tg-spoiler span and drops a plain span", () => {
    expect(sanitizeTelegramHtml('<span class="tg-spoiler">s</span>')).toBe('<span class="tg-spoiler">s</span>');
    expect(sanitizeTelegramHtml('<span style="color:red">s</span>')).toBe("s");
  });

  it("closes tags left open in the input", () => {
    expect(sanitizeTelegramHtml("<b>unclosed")).toBe("<b>unclosed</b>");
  });

  it("drops a dangling close tag", () => {
    expect(sanitizeTelegramHtml("hi</b>")).toBe("hi");
  });
});

describe("plainTextLength", () => {
  it("ignores tags and decodes entities", () => {
    expect(plainTextLength("<b>ab</b>")).toBe(2);
    expect(plainTextLength("a &lt;b&gt; &amp; c")).toBe("a <b> & c".length);
  });
});

describe("sendToChat", () => {
  let ctx: ReturnType<typeof fakeBot>;
  beforeEach(() => { ctx = fakeBot(); });

  it("sends a single image with a short caption via sendPhoto", async () => {
    await sendToChat(ctx.bot, 10, "<b>hi</b>", [file("p.jpg", "image/jpeg")]);
    expect(ctx.api.sendPhoto).toHaveBeenCalledTimes(1);
    expect(ctx.api.sendPhoto.mock.calls[0][2]).toMatchObject({ caption: "<b>hi</b>", parse_mode: "HTML" });
    expect(ctx.api.sendMessage).not.toHaveBeenCalled();
  });

  it("sends text then document when a non-image file is attached", async () => {
    await sendToChat(ctx.bot, 10, "hi", [file("a.pdf", "application/pdf")]);
    expect(ctx.api.sendMessage).toHaveBeenCalledTimes(1);
    expect(ctx.api.sendDocument).toHaveBeenCalledTimes(1);
    expect(ctx.api.sendPhoto).not.toHaveBeenCalled();
  });

  it("sends a media group for multiple images plus a separate text message", async () => {
    await sendToChat(ctx.bot, 10, "hi", [file("a.jpg", "image/jpeg"), file("b.png", "image/png")]);
    expect(ctx.api.sendMessage).toHaveBeenCalledTimes(1);
    expect(ctx.api.sendMediaGroup).toHaveBeenCalledTimes(1);
    expect(ctx.api.sendMediaGroup.mock.calls[0][1]).toHaveLength(2);
  });

  it("sends the image without a caption when text exceeds the caption limit", async () => {
    const longText = "a".repeat(1100);
    await sendToChat(ctx.bot, 10, longText, [file("p.jpg", "image/jpeg")]);
    expect(ctx.api.sendMessage).toHaveBeenCalledTimes(1);
    expect(ctx.api.sendPhoto).toHaveBeenCalledTimes(1);
    expect(ctx.api.sendPhoto.mock.calls[0][2]).toBeUndefined();
  });

  it("sends only a message when there are no files", async () => {
    await sendToChat(ctx.bot, 10, "just text", []);
    expect(ctx.api.sendMessage).toHaveBeenCalledWith(10, "just text", { parse_mode: "HTML" });
  });
});

describe("sendBroadcast", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("sends to every real user and counts successes", async () => {
    const { bot, api } = fakeBot();
    const { db, findMany } = dbWith([{ telegram_id: 1n }, { telegram_id: 2n }]);
    const p = sendBroadcast(bot, db, { text: "hi", files: [] });
    await vi.runAllTimersAsync();
    const res = await p;
    expect(res).toEqual({ total: 2, sent: 2, failed: 0 });
    expect(api.sendMessage).toHaveBeenCalledTimes(2);
    expect(findMany).toHaveBeenCalledWith({ where: { telegram_id: { gt: 0 }, deleted_at: null }, select: { telegram_id: true } });
  });

  it("counts a failed delivery without aborting the rest", async () => {
    const { bot, api } = fakeBot();
    api.sendMessage.mockRejectedValueOnce(new Error("blocked")).mockResolvedValueOnce(undefined);
    const { db } = dbWith([{ telegram_id: 1n }, { telegram_id: 2n }]);
    const p = sendBroadcast(bot, db, { text: "hi", files: [] });
    await vi.runAllTimersAsync();
    const res = await p;
    expect(res).toEqual({ total: 2, sent: 1, failed: 1 });
  });

  it("retries once after a 429 and counts the retry as sent", async () => {
    const { bot, api } = fakeBot();
    api.sendMessage.mockRejectedValueOnce({ parameters: { retry_after: 1 } }).mockResolvedValueOnce(undefined);
    const { db } = dbWith([{ telegram_id: 1n }]);
    const p = sendBroadcast(bot, db, { text: "hi", files: [] });
    await vi.runAllTimersAsync();
    const res = await p;
    expect(res).toEqual({ total: 1, sent: 1, failed: 0 });
    expect(api.sendMessage).toHaveBeenCalledTimes(2);
  });
});
