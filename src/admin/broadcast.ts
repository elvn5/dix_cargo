import { Bot, Context, InputFile, InputMediaBuilder } from "grammy";
import type { PrismaClient } from "@prisma/client";

/** Файл-вложение рассылки, загруженный админом. */
export interface BroadcastFile {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}

export interface BroadcastResult {
  total: number;
  sent: number;
  failed: number;
}

// Telegram: caption у медиа ≤ 1024 символов, обычное сообщение ≤ 4096.
export const TG_CAPTION_LIMIT = 1024;
export const TG_MESSAGE_LIMIT = 4096;
// Небольшая пауза между пользователями, чтобы не упереться в лимиты Telegram (~30 msg/s).
const SEND_DELAY_MS = 40;
// Максимум медиа в одном альбоме Telegram.
const MEDIA_GROUP_SIZE = 10;

/**
 * Разрешённые Telegram HTML-теги и их канонический вид.
 * Редактор в админке уже отдаёт чистый Telegram HTML — этот санитайзер служит
 * защитой на сервере: выкидывает любые посторонние теги (<div>, <span> без спойлера,
 * <script> и т.п.), оставляя их текстовое содержимое, и нормализует переносы строк.
 */
const TG_TAGS: Record<string, string> = {
  b: "b", strong: "b",
  i: "i", em: "i",
  u: "u", ins: "u",
  s: "s", strike: "s", del: "s",
  code: "code", pre: "pre",
  a: "a",
  blockquote: "blockquote",
  "tg-spoiler": "tg-spoiler",
};

/**
 * Оставляет только теги, которые понимает Telegram parse_mode=HTML.
 * Реализован через стек открытых тегов, поэтому на выходе теги всегда парные:
 * посторонний открывающий тег выкидывается вместе со своим закрытием, а «висячие»
 * закрывающие теги отбрасываются — одно кривое сообщение не сломает всю рассылку.
 * Текст и HTML-сущности не трогаем (редактор уже их экранирует).
 */
export function sanitizeTelegramHtml(input: string): string {
  const tagRe = /<(\/?)([a-zA-Z0-9-]+)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  const stack: string[] = [];
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;

  const closeName = (name: string): string => {
    if (name === "span") return "span";
    return TG_TAGS[name] ?? name;
  };

  while ((m = tagRe.exec(input)) !== null) {
    out += input.slice(last, m.index);
    last = tagRe.lastIndex;

    const [, slash, rawName, attrs] = m;
    const name = rawName.toLowerCase();

    if (name === "br") {
      if (!slash) out += "\n";
      continue;
    }

    if (slash) {
      const canon = closeName(name);
      if (stack.length && stack[stack.length - 1] === canon) {
        stack.pop();
        out += `</${canon}>`;
      }
      // иначе — висячий/чужой закрывающий тег: пропускаем
      continue;
    }

    // Открывающий тег
    if (name === "span") {
      if (/tg-spoiler/i.test(attrs)) {
        stack.push("span");
        out += '<span class="tg-spoiler">';
      }
      continue;
    }

    const canon = TG_TAGS[name];
    if (!canon) continue; // посторонний тег — убираем, содержимое останется

    if (canon === "a") {
      const href = /href\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? /href\s*=\s*'([^']*)'/i.exec(attrs)?.[1] ?? "";
      if (!/^(https?:|tg:)/i.test(href.trim())) continue; // без валидной ссылки — только текст
      stack.push("a");
      out += `<a href="${href.trim().replace(/"/g, "&quot;")}">`;
      continue;
    }

    stack.push(canon);
    out += `<${canon}>`;
  }

  out += input.slice(last);
  // Закрываем всё, что осталось открытым (на случай незакрытых тегов).
  while (stack.length) out += `</${stack.pop()}>`;
  return out;
}

/** Длина видимого текста без HTML-тегов и с раскодированными основными сущностями — для проверки лимитов Telegram. */
export function plainTextLength(html: string): number {
  const text = html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
  return [...text].length;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isImage(f: BroadcastFile): boolean {
  return f.mimetype.startsWith("image/");
}

function isVideo(f: BroadcastFile): boolean {
  return f.mimetype.startsWith("video/");
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Отправляет сообщение одному пользователю.
 * Простой случай (одно фото/видео и короткий текст) — как подпись к медиа.
 * Иначе шлём текст отдельным сообщением, затем медиа-альбомы и документы —
 * так и форматирование полностью сохраняется (до 4096), и нет проблем с лимитом подписи
 * или смешиванием документов с фото в одном альбоме.
 */
export async function sendToChat(
  bot: Bot<Context>,
  chatId: number,
  text: string,
  files: BroadcastFile[],
): Promise<void> {
  const visual = files.filter((f) => isImage(f) || isVideo(f));
  const docs = files.filter((f) => !isImage(f) && !isVideo(f));

  if (visual.length === 1 && docs.length === 0 && plainTextLength(text) <= TG_CAPTION_LIMIT) {
    const f = visual[0];
    const input = new InputFile(f.buffer, f.filename);
    const opts = text ? { caption: text, parse_mode: "HTML" as const } : undefined;
    if (isImage(f)) await bot.api.sendPhoto(chatId, input, opts);
    else await bot.api.sendVideo(chatId, input, opts);
    return;
  }

  if (text) {
    await bot.api.sendMessage(chatId, text, { parse_mode: "HTML" });
  }

  if (visual.length === 1) {
    const f = visual[0];
    const input = new InputFile(f.buffer, f.filename);
    if (isImage(f)) await bot.api.sendPhoto(chatId, input);
    else await bot.api.sendVideo(chatId, input);
  } else if (visual.length > 1) {
    for (const group of chunk(visual, MEDIA_GROUP_SIZE)) {
      const media = group.map((f) => {
        const input = new InputFile(f.buffer, f.filename);
        return isImage(f) ? InputMediaBuilder.photo(input) : InputMediaBuilder.video(input);
      });
      await bot.api.sendMediaGroup(chatId, media);
    }
  }

  for (const f of docs) {
    await bot.api.sendDocument(chatId, new InputFile(f.buffer, f.filename));
  }
}

/** Извлекает retry_after (секунды) из ошибки Telegram 429, если он есть. */
function retryAfter(err: unknown): number | null {
  const params = (err as { parameters?: { retry_after?: number } })?.parameters;
  return typeof params?.retry_after === "number" ? params.retry_after : null;
}

/**
 * Массовая рассылка всем реальным пользователям бота выбранного филиала
 * (у фейковых/незарегистрированных telegram_id ≤ 0). Ошибки по отдельному
 * получателю (заблокировал бота и т.п.) не прерывают рассылку, а считаются как failed.
 */
export async function sendBroadcast(
  bot: Bot<Context>,
  db: PrismaClient,
  payload: { text: string; files: BroadcastFile[] },
): Promise<BroadcastResult> {
  const users = await db.user.findMany({
    where: { telegram_id: { gt: 0 } },
    select: { telegram_id: true },
  });

  let sent = 0;
  let failed = 0;

  for (const user of users) {
    const chatId = Number(user.telegram_id);
    try {
      await sendToChat(bot, chatId, payload.text, payload.files);
      sent++;
    } catch (err) {
      const wait = retryAfter(err);
      if (wait !== null) {
        // Упёрлись в лимит — ждём и пробуем этого пользователя ещё раз.
        await delay((wait + 1) * 1000);
        try {
          await sendToChat(bot, chatId, payload.text, payload.files);
          sent++;
          continue;
        } catch (err2) {
          failed++;
          console.error(`[Broadcast] Не удалось отправить пользователю ${chatId}:`, err2);
          continue;
        }
      }
      failed++;
      console.error(`[Broadcast] Не удалось отправить пользователю ${chatId}:`, err);
    }
    await delay(SEND_DELAY_MS);
  }

  return { total: users.length, sent, failed };
}
