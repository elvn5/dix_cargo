import { Bot, Context } from "grammy";
import type { PrismaClient } from "@prisma/client";

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
    if (!user || user.telegram_id <= 0n) return;

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
    console.error("[Admin] Не удалось отправить уведомление пользователю:", err);
  }
}

export async function notifyResetDecision(bot: Bot<Context>, telegramId: bigint, approved: boolean) {
  try {
    const text = approved
      ? "✅ Доступ к аккаунту успешно сброшен. Теперь вы можете пользоваться ботом с этого аккаунта — отправьте /start."
      : "❌ Ваша заявка на сброс доступа отклонена. Обратитесь к менеджеру.";
    await bot.api.sendMessage(Number(telegramId), text, { parse_mode: "HTML" });
  } catch (err) {
    console.error("[Admin] Не удалось отправить уведомление о заявке на сброс доступа:", err);
  }
}
