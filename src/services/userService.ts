import prisma from "../database/prismaClient";
import type { User } from "@prisma/client";

async function generateClientCode(): Promise<string> {
  const allCodes = await prisma.user.findMany({
    select: { client_code: true },
  });

  const maxNumber = allCodes.reduce((max, u) => {
    const n = parseInt(u.client_code.split("-")[1] ?? "0", 10);
    return n > max ? n : max;
  }, 0);

  const paddedNumber = String(maxNumber + 1).padStart(4, "0");
  return `DIX-${paddedNumber}`;
}

async function findUserByTelegramId(telegramId: bigint): Promise<User | null> {
  return prisma.user.findUnique({
    where: { telegram_id: telegramId },
  });
}

async function createUser(
  telegramId: bigint,
  phone: string,
  fullName: string
): Promise<User> {
  const clientCode = await generateClientCode();

  return prisma.user.create({
    data: {
      telegram_id: telegramId,
      phone,
      full_name: fullName,
      client_code: clientCode,
    },
  });
}

export const userService = {
  findUserByTelegramId,
  createUser,
  generateClientCode,
};
