/**
 * Chat ID клиента с ботом. В личном чате он совпадает с Telegram ID пользователя.
 * У клиентов, созданных в админке и ещё не писавших боту, вместо Telegram ID —
 * отрицательная заглушка: чата с ботом у них нет, уведомления им не доходят.
 */
export function botChatId(telegramId: string | null | undefined): string | null {
  const id = String(telegramId ?? "").trim();
  return /^\d+$/.test(id) && id !== "0" ? id : null;
}
