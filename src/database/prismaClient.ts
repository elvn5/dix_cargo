import { PrismaClient } from "@prisma/client";

// Singleton pattern — одно соединение на всё приложение
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["error"],
});

export default prisma;
