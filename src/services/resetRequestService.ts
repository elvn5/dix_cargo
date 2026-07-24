import type { PrismaClient, AccessResetRequest } from "@prisma/client";

async function findPending(db: PrismaClient, userId: number): Promise<AccessResetRequest | null> {
  return db.accessResetRequest.findFirst({ where: { user_id: userId, status: "PENDING" } });
}

/** Создаёт заявку на сброс доступа либо обновляет уже существующую (ожидающую) для того же пользователя. */
async function createOrUpdate(
  db: PrismaClient,
  userId: number,
  requestedTelegramId: bigint
): Promise<AccessResetRequest> {
  const pending = await findPending(db, userId);
  if (pending) {
    return db.accessResetRequest.update({
      where: { id: pending.id },
      data: { requested_telegram_id: requestedTelegramId },
    });
  }
  return db.accessResetRequest.create({
    data: { user_id: userId, requested_telegram_id: requestedTelegramId },
  });
}

export const resetRequestService = { findPending, createOrUpdate };
