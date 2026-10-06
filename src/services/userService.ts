import { getPrisma, BRANCHES, clientCodePrefix, type Branch } from "../database/prismaClient";
import type { PrismaClient, User } from "@prisma/client";

const EXCLUDED_CODE_NUMBERS = new Set([
  2222, 11111, 9999, 2806, 1222, 1234,
  1989, 1991, 2101, 3333, 1920, 5555,
]);

/** Ключ настройки с последним выданным номером клиентского кода. */
export const CLIENT_CODE_SEQ_KEY = "client_code_seq";

/**
 * «Красивые» коды (DIX-1111, DIX-7777 и т.п.) выдаются вручную и не входят в
 * обычную нумерацию — при первом запуске счётчик стартует с максимального
 * номера ниже этого порога.
 */
const VANITY_CODE_THRESHOLD = 1000;

function codeNumber(code: string): number {
  return parseInt(code.split("-")[1] ?? "0", 10) || 0;
}

/**
 * Следующий клиентский код. Номера только растут и никогда не переиспользуются:
 * последний выданный номер хранится в настройках, поэтому код удалённого
 * клиента не достанется новому. Занятые (в т.ч. клиентами в корзине и
 * введёнными вручную) и исключённые номера пропускаются.
 */
async function generateClientCode(db: PrismaClient, branch: Branch): Promise<string> {
  const prefix = clientCodePrefix(branch);
  const allCodes = await db.user.findMany({
    select: { client_code: true },
  });
  const takenNumbers = new Set(allCodes.map(u => codeNumber(u.client_code)));

  const seq = await db.setting.findUnique({ where: { key: CLIENT_CODE_SEQ_KEY } });
  let last = seq ? parseInt(seq.value, 10) || 0 : 0;
  if (!seq) {
    for (const n of takenNumbers) {
      if (n < VANITY_CODE_THRESHOLD && n > last) last = n;
    }
  }

  let next = last + 1;
  while (EXCLUDED_CODE_NUMBERS.has(next) || takenNumbers.has(next)) next++;

  // Резервируем номер сразу: даже если создание клиента сорвётся, номер не вернётся в оборот
  await db.setting.upsert({
    where: { key: CLIENT_CODE_SEQ_KEY },
    update: { value: String(next) },
    create: { key: CLIENT_CODE_SEQ_KEY, value: String(next) },
  });

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

/** Активный (не в корзине) клиент по Telegram ID. */
async function findUserByTelegramId(db: PrismaClient, telegramId: bigint): Promise<User | null> {
  const user = await db.user.findUnique({
    where: { telegram_id: telegramId },
  });
  return user && !user.deleted_at ? user : null;
}

/** Активный (не в корзине) клиент по телефону. */
async function findUserByPhone(db: PrismaClient, phone: string): Promise<User | null> {
  const user = await db.user.findFirst({
    where: { phone },
  });
  return user && !user.deleted_at ? user : null;
}

/**
 * Клиент в корзине с тем же Telegram ID или телефоном. Такой аккаунт держит
 * уникальные поля, поэтому заново зарегистрироваться с ними нельзя — нужен менеджер.
 */
async function findTrashedUser(
  db: PrismaClient,
  { telegramId, phone }: { telegramId?: bigint; phone?: string }
): Promise<User | null> {
  const or: { telegram_id?: bigint; phone?: string }[] = [];
  if (telegramId !== undefined) or.push({ telegram_id: telegramId });
  if (phone !== undefined) or.push({ phone });
  if (or.length === 0) return null;
  return db.user.findFirst({
    where: { deleted_at: { not: null }, OR: or },
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
  findTrashedUser,
  findUserAnyBranch,
  createUser,
  generateClientCode,
  generateUniqueClientCode,
};
