import prisma from "../database/prismaClient";
import type { User } from "@prisma/client";
import { createHash } from "crypto";

async function generateClientCode(): Promise<string> {
  const lastUser = await prisma.user.findFirst({
    orderBy: { id: "desc" },
    select: { client_code: true },
  });

  let nextNumber = 1;

  if (lastUser) {
    const parts = lastUser.client_code.split("-");
    const lastNumber = parseInt(parts[1] ?? "0", 10);
    nextNumber = lastNumber + 1;
  }

  const paddedNumber = String(nextNumber).padStart(3, "0");
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
  fullName: string,
  password: string
): Promise<User> {
  const clientCode = await generateClientCode();
  const passwordHash = createHash("sha256").update(password).digest("hex");

  return prisma.user.create({
    data: {
      telegram_id: telegramId,
      phone,
      full_name: fullName,
      password: passwordHash,
      client_code: clientCode,
    },
  });
}

export const userService = {
  findUserByTelegramId,
  createUser,
  generateClientCode,
};
