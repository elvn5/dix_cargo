import { Bot, Context } from "grammy";
import type { PrismaClient } from "@prisma/client";
import { logger } from "../utils/logger";

export async function notifyStatusChange(
  bot: Bot<Context>,
  db: PrismaClient,
  userId: number,
  clientCode: string,
  trackCodes: string[],
  status: "IN_OFFICE" | "DELIVERED",
  weight?: number | null,
  price?: number | null,
) {
  try {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user || user.deleted_at || user.telegram_id <= 0n) return;

    const isSingle  = trackCodes.length === 1;
    const trackList = trackCodes.map(t => `• <code>${t}</code>`).join("\n");
    const weightLine = weight != null ? `\n⚖️ Вес: <b>${weight} кг</b>` : "";
    const priceLine  = price  != null ? `\n💰 К оплате: <b>${price.toLocaleString("ru-RU")} сом</b>` : "";
    const extra      = weightLine + priceLine;

    let text: string;
    if (status === "IN_OFFICE") {
      text = isSingle
        ? `📦 Ваша посылка прибыла в офис!\n\n🪪 Код клиента: <b>${clientCode}</b>\n📬 Трек-номер: <b>${trackCodes[0]}</b>${extra}\n\nВы можете забрать её в рабочее время.`
        : `📦 ${trackCodes.length} посылок прибыли в офис!\n\n🪪 Код клиента: <b>${clientCode}</b>\n📬 Трек-номера:\n${trackList}${extra}\n\nВы можете забрать их в рабочее время.`;
    } else {
      text = isSingle
        ? `✅ Ваша посылка выдана!\n\n🪪 Код клиента: <b>${clientCode}</b>\n📬 Трек-номер: <b>${trackCodes[0]}</b>${extra}\n\nСпасибо, что выбрали DIX Cargo!`
        : `✅ ${trackCodes.length} посылок выдано!\n\n🪪 Код клиента: <b>${clientCode}</b>\n📬 Трек-номера:\n${trackList}${extra}\n\nСпасибо, что выбрали DIX Cargo!`;
    }

    await bot.api.sendMessage(Number(user.telegram_id), text, { parse_mode: "HTML" });
  } catch (err) {
    logger.error("notify.status_failed", { user_id: userId, client_code: clientCode, status, error: err });
  }
}

// Сколько трек-номеров перечислять в одном сообщении — чтобы не выйти за лимит Telegram (4096).
const MAX_TRACKS_IN_MESSAGE = 50;

/**
 * Уведомление после импорта: все посылки клиента из файла — одним сообщением.
 * Для клиента без привязанного Telegram (telegram_id <= 0) ничего не шлём.
 * Возвращает true, если сообщение ушло.
 */
export async function notifyInTransit(
  bot: Bot<Context>,
  telegramId: bigint,
  clientCode: string,
  trackCodes: string[],
): Promise<boolean> {
  if (!(telegramId > 0n) || trackCodes.length === 0) return false;
  try {
    const shown = trackCodes.slice(0, MAX_TRACKS_IN_MESSAGE);
    const rest  = trackCodes.length - shown.length;
    const trackList = shown.map(t => `• <code>${t}</code>`).join("\n") + (rest > 0 ? `\n…и ещё ${rest}` : "");

    const text = trackCodes.length === 1
      ? `🚚 Ваша посылка в пути!\n\n🪪 Код клиента: <b>${clientCode}</b>\n📬 Трек-номер: <b>${trackCodes[0]}</b>\n\nМы сообщим, когда она прибудет в офис.`
      : `🚚 ${trackCodes.length} посылок в пути!\n\n🪪 Код клиента: <b>${clientCode}</b>\n📬 Трек-номера:\n${trackList}\n\nМы сообщим, когда они прибудут в офис.`;

    await bot.api.sendMessage(Number(telegramId), text, { parse_mode: "HTML" });
    return true;
  } catch (err) {
    logger.error("notify.in_transit_failed", { telegram_id: telegramId, client_code: clientCode, error: err });
    return false;
  }
}

export async function notifyResetDecision(bot: Bot<Context>, telegramId: bigint, approved: boolean) {
  try {
    const text = approved
      ? "✅ Доступ к аккаунту успешно сброшен. Теперь вы можете пользоваться ботом с этого аккаунта — отправьте /start."
      : "❌ Ваша заявка на сброс доступа отклонена. Обратитесь к менеджеру.";
    await bot.api.sendMessage(Number(telegramId), text, { parse_mode: "HTML" });
  } catch (err) {
    logger.error("notify.reset_failed", { telegram_id: telegramId, approved, error: err });
  }
}
