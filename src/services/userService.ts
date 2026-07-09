import { getPrisma, BRANCHES, clientCodePrefix, type Branch } from "../database/prismaClient";
import type { PrismaClient, User } from "@prisma/client";

const EXCLUDED_CODE_NUMBERS = new Set([
  2222, 11111, 9999, 2806, 1222, 1234,
  1989, 1991, 2101, 3333, 1920, 5555,
]);

async function generateClientCode(db: PrismaClient, branch: Branch): Promise<string> {
  const prefix = clientCodePrefix(branch);
  const allCodes = await db.user.findMany({
    select: { client_code: true },
  });

  const takenNumbers = new Set(
    allCodes.map(u => parseInt(u.client_code.split("-")[1] ?? "0", 10))
  );

  // Find the first available number starting from 1, skipping excluded and taken
  let next = 1;
  while (EXCLUDED_CODE_NUMBERS.has(next) || takenNumbers.has(next)) next++;

  return `${prefix}-${String(next).padStart(4, "0")}`;
}

async function generateUniqueClientCode(db: PrismaClient, branch: Branch): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = await generateClientCode(db, branch);
    const existing = await db.user.findUnique({ where: { client_code: code } });
    if (!existing) return code;
  }
  throw new Error("Failed to generate unique client code after 10 attempts");
}

async function findUserByTelegramId(db: PrismaClient, telegramId: bigint): Promise<User | null> {
  return db.user.findUnique({
    where: { telegram_id: telegramId },
  });
}

async function findUserByPhone(db: PrismaClient, phone: string): Promise<User | null> {
  return db.user.findFirst({
    where: { phone },
  });
}

async function createUser(
  db: PrismaClient,
  branch: Branch,
  telegramId: bigint,
  phone: string,
  fullName: string
): Promise<User> {
  const clientCode = await generateUniqueClientCode(db, branch);

  return db.user.create({
    data: {
      telegram_id: telegramId,
      phone,
      full_name: fullName,
      client_code: clientCode,
    },
  });
}

/**
 * Пользователь может состоять в базе только одного филиала — при неизвестном
 * филиале (например, обычные команды бота) ищем во всех базах параллельно.
 */
async function findUserAnyBranch(
  telegramId: bigint
): Promise<{ user: User; branch: Branch } | null> {
  const results = await Promise.all(
    BRANCHES.map(async ({ key }) => ({
      branch: key,
      user: await findUserByTelegramId(getPrisma(key), telegramId),
    }))
  );
  const found = results.find((r) => r.user);
  return found?.user ? { user: found.user, branch: found.branch } : null;
}

export const userService = {
  findUserByTelegramId,
  findUserByPhone,
  findUserAnyBranch,
  createUser,
  generateClientCode,
  generateUniqueClientCode,
};
