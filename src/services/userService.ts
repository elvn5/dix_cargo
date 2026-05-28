import prisma from "../database/prismaClient";
import type { User } from "@prisma/client";

const EXCLUDED_CODE_NUMBERS = new Set([
  2222, 11111, 9999, 2806, 1222, 1234,
  1989, 1991, 2101, 3333, 1920, 5555,
]);

async function generateClientCode(): Promise<string> {
  const allCodes = await prisma.user.findMany({
    select: { client_code: true },
  });

  // Find the highest assigned number that is not in the exclusion list
  const maxNumber = allCodes.reduce((max, u) => {
    const n = parseInt(u.client_code.split("-")[1] ?? "0", 10);
    if (EXCLUDED_CODE_NUMBERS.has(n)) return max;
    return n > max ? n : max;
  }, 0);

  // Increment, skipping any excluded numbers
  let next = maxNumber + 1;
  while (EXCLUDED_CODE_NUMBERS.has(next)) next++;

  return `DIX-${String(next).padStart(4, "0")}`;
}

async function generateUniqueClientCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = await generateClientCode();
    const existing = await prisma.user.findUnique({ where: { client_code: code } });
    if (!existing) return code;
  }
  throw new Error("Failed to generate unique client code after 10 attempts");
}

async function findUserByTelegramId(telegramId: bigint): Promise<User | null> {
  return prisma.user.findUnique({
    where: { telegram_id: telegramId },
  });
}

async function findUserByPhone(phone: string): Promise<User | null> {
  return prisma.user.findFirst({
    where: { phone },
  });
}

async function createUser(
  telegramId: bigint,
  phone: string,
  fullName: string
): Promise<User> {
  const clientCode = await generateUniqueClientCode();

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
  findUserByPhone,
  createUser,
  generateClientCode,
  generateUniqueClientCode,
};
