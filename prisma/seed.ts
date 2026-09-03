/**
 * Наполнение БД фейковыми данными: 100 клиентов × 10 посылок в каждом филиале.
 *
 * По умолчанию: добавляет данные к существующим (ничего не удаляет),
 * заливает в оба филиала (bishkek + kant) и ОТКАЗЫВАЕТСЯ работать при
 * NODE_ENV=production — сид предназначен для staging/локальной среды.
 *
 * Запуск (Postgres должен быть поднят, напр. `docker compose up -d postgres postgres_kant`):
 *   npm run seed
 *   # или через prisma:
 *   npx prisma db seed
 *
 * Настройки через переменные окружения:
 *   SEED_USERS=100              — клиентов на филиал
 *   SEED_PACKAGES_PER_USER=10   — посылок на клиента
 *   SEED_BRANCHES=bishkek,kant  — какие филиалы заливать
 *   SEED_TARIFF=190             — запасной тариф (сом/кг), если в settings его нет
 *   ALLOW_PROD_SEED=1           — разрешить запуск при NODE_ENV=production (не рекомендуется)
 *
 * Подключение берётся из .env (DATABASE_URL / DATABASE_URL_KANT). Чтобы залить
 * в staging — задайте эти переменные при запуске, например:
 *   DATABASE_URL=postgresql://... DATABASE_URL_KANT=postgresql://... npm run seed
 */
import "dotenv/config";
import { PackageStatus } from "@prisma/client";
import {
  clientCodePrefix,
  disconnectAllBranches,
  getDatabaseUrl,
  getPrisma,
  isBranch,
  type Branch,
} from "../src/database/prismaClient";

// ── Настройки ────────────────────────────────────────────────────────────────
function intEnv(name: string, fallback: number): number {
  const v = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
const USERS = intEnv("SEED_USERS", 100);
const PKGS_PER_USER = intEnv("SEED_PACKAGES_PER_USER", 10);
const DEFAULT_TARIFF = intEnv("SEED_TARIFF", 190);
const REQUESTED_BRANCHES = (process.env.SEED_BRANCHES ?? "bishkek,kant")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ── Утилиты ──────────────────────────────────────────────────────────────────
const rnd = (n: number): number => Math.floor(Math.random() * n);
const pick = <T>(arr: T[]): T => arr[rnd(arr.length)];
const round2 = (n: number): number => Math.round(n * 100) / 100;
const pad4 = (n: number): string => String(n).padStart(4, "0");
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function safeTarget(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return "(нераспознанный URL)";
  }
}

// ── Генераторы фейковых данных ────────────────────────────────────────────────
const MALE_NAMES = [
  "Азамат", "Бекзат", "Нурлан", "Улан", "Тилек", "Данияр", "Эрлан", "Кубан",
  "Марат", "Айбек", "Руслан", "Темир", "Максат", "Бакыт", "Санжар", "Алмаз",
  "Женишбек", "Кыял", "Мирлан", "Адилет", "Нурбек", "Талант",
];
const FEMALE_NAMES = [
  "Айгерим", "Назгуль", "Гульнара", "Аида", "Чолпон", "Бегимай", "Асель",
  "Динара", "Жылдыз", "Салтанат", "Айпери", "Нургуль", "Элиза", "Каныкей",
  "Мээрим", "Айсулуу", "Жанара", "Бермет", "Айнура", "Гулиза",
];
const SURNAMES_M = [
  "Абдырахманов", "Осмонов", "Токтогулов", "Асанов", "Бекболотов", "Жээнбеков",
  "Сыдыков", "Иманалиев", "Кадыров", "Турсунбаев", "Мамытов", "Алиев",
  "Усенов", "Джолдошев", "Орозов", "Сатыбалдиев", "Байзаков", "Эргешов",
];

function makeName(): string {
  const male = Math.random() < 0.5;
  const first = male ? pick(MALE_NAMES) : pick(FEMALE_NAMES);
  const surname = pick(SURNAMES_M) + (male ? "" : "а");
  return `${first} ${surname}`;
}

function makePhone(used: Set<string>): string {
  const ops = ["70", "55", "50", "99", "77", "51", "22", "54"];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const phone = `+996${pick(ops)}${String(rnd(10_000_000)).padStart(7, "0")}`;
    if (!used.has(phone)) {
      used.add(phone);
      return phone;
    }
  }
}

function makeTelegramId(used: Set<string>, base: bigint, seq: number): bigint {
  let cand = base + BigInt(seq);
  while (used.has(cand.toString())) cand += 1n;
  used.add(cand.toString());
  return cand;
}

function makeTrackCode(): string {
  const carriers = ["RB", "LP", "RR", "CP", "EA", "LZ", "YT", "SF", "LX", "UV"];
  const suffix = pick(["CN", "KG", "US", "TR", "AE"]);
  return `${pick(carriers)}${String(rnd(1_000_000_000)).padStart(9, "0")}${suffix}`;
}

function daysAgo(maxDays: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - rnd(maxDays));
  d.setHours(rnd(24), rnd(60), rnd(60), 0);
  return d;
}

interface SeedPackage {
  track_code: string;
  status: PackageStatus;
  weight: number | null;
  price: number | null;
  created_at: Date;
}

function buildPackages(count: number, tariff: number, userCreated: Date): SeedPackage[] {
  const out: SeedPackage[] = [];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const r = Math.random();
    const status: PackageStatus =
      r < 0.4 ? PackageStatus.IN_TRANSIT : r < 0.75 ? PackageStatus.IN_OFFICE : PackageStatus.DELIVERED;
    let weight: number | null = null;
    let price: number | null = null;
    if (status !== PackageStatus.IN_TRANSIT) {
      weight = round2(0.2 + Math.random() * 24.8); // 0.2–25 кг
      price = Math.round(weight * tariff);
    }
    const created = new Date(userCreated.getTime() + Math.random() * (now - userCreated.getTime()));
    out.push({ track_code: makeTrackCode(), status, weight, price, created_at: created });
  }
  return out;
}

// ── Заливка одного филиала ─────────────────────────────────────────────────────
async function seedBranch(branch: Branch): Promise<void> {
  const url = getDatabaseUrl(branch);
  if (!url) {
    console.warn(`  ⚠ Пропуск «${branch}»: не задан URL базы данных.`);
    return;
  }
  const prisma = getPrisma(branch);
  const prefix = clientCodePrefix(branch);
  console.log(`\n▶ Филиал «${branch}» (${prefix}) → ${safeTarget(url)}`);

  // Существующие данные — чтобы добавлять без конфликтов уникальности.
  const existing = await prisma.user.findMany({
    select: { client_code: true, phone: true, telegram_id: true },
  });
  const phones = new Set(existing.map((u) => u.phone));
  const tgs = new Set(existing.map((u) => u.telegram_id.toString()));
  let maxCodeNum = 0;
  const codeRe = new RegExp(`^${escapeRe(prefix)}-(\\d+)$`);
  for (const u of existing) {
    const m = codeRe.exec(u.client_code);
    if (m) maxCodeNum = Math.max(maxCodeNum, parseInt(m[1], 10));
  }

  const setting = await prisma.setting.findUnique({ where: { key: "tariff_per_kg" } }).catch(() => null);
  const tariff = setting ? parseFloat(setting.value) || DEFAULT_TARIFF : DEFAULT_TARIFF;

  console.log(
    `  клиентов в базе: ${existing.length}; старт с ${prefix}-${pad4(maxCodeNum + 1)}; тариф ${tariff} сом/кг`,
  );

  const tgBase = 900_000_000_000n + BigInt(maxCodeNum);
  let createdUsers = 0;
  let createdPkgs = 0;
  for (let i = 1; i <= USERS; i++) {
    const codeNum = maxCodeNum + i;
    const regDate = daysAgo(180);
    const pkgs = buildPackages(PKGS_PER_USER, tariff, regDate);
    await prisma.user.create({
      data: {
        telegram_id: makeTelegramId(tgs, tgBase, i),
        phone: makePhone(phones),
        full_name: makeName(),
        client_code: `${prefix}-${pad4(codeNum)}`,
        created_at: regDate,
        packages: { create: pkgs },
      },
    });
    createdUsers++;
    createdPkgs += pkgs.length;
    if (createdUsers % 25 === 0) console.log(`    …${createdUsers}/${USERS} клиентов`);
  }
  console.log(`  ✔ добавлено клиентов: ${createdUsers}, посылок: ${createdPkgs}`);
}

// ── main ───────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_SEED !== "1") {
    console.error(
      "❌ Отказ: NODE_ENV=production. Сид предназначен для staging.\n" +
        "   Если это осознанно — задайте ALLOW_PROD_SEED=1.",
    );
    process.exit(1);
  }

  const branches = REQUESTED_BRANCHES.filter(isBranch) as Branch[];
  if (branches.length === 0) {
    console.error(`❌ В SEED_BRANCHES нет валидных филиалов: "${process.env.SEED_BRANCHES}". Ожидается bishkek/kant.`);
    process.exit(1);
  }

  console.log(
    `Сид: ${USERS} клиентов × ${PKGS_PER_USER} посылок; филиалы: ${branches.join(", ")}; режим: добавление к существующим.`,
  );

  for (const branch of branches) {
    try {
      await seedBranch(branch);
    } catch (e) {
      console.error(`❌ Ошибка при заливке филиала «${branch}»: ${(e as Error).message}`);
    }
  }

  await disconnectAllBranches();
  console.log("\nГотово.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
