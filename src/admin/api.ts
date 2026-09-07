import express, { Router } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { Bot, Context } from "grammy";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import {
  getPrisma, getDatabaseUrl, BRANCHES, DEFAULT_BRANCH, branchLabel, clientCodePrefix, isBranch,
} from "../database/prismaClient";
import { userService } from "../services/userService";
import { parseClientCode } from "../utils/parseClientCode";
import { parseShippingDate } from "../utils/parseShippingDate";
import { DEFAULT_SUPPORT_TEXT } from "../utils/supportText";
import { DEFAULT_ADDRESSES_TEXT } from "../utils/addressesText";
import { ADMIN_EMAIL, ADMIN_PASSWORD, APP_VERSION, IS_STAGING, getBranch, requireApiAuth } from "./auth";
import { notifyStatusChange, notifyResetDecision } from "./notify";
import { sanitizeTelegramHtml, plainTextLength, sendBroadcast, TG_MESSAGE_LIMIT, type BroadcastFile } from "./broadcast";

// ── Сериализация ──────────────────────────────────────────────────────────────

function serializeUser<T extends { telegram_id: bigint }>(user: T) {
  return { ...user, telegram_id: user.telegram_id.toString() };
}

/** Значение настройки из тела запроса: строка или число (числовые поля формы приходят как number). */
function settingValue(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return null;
}

/** Число из тела запроса (строка или number); null — если пусто или не число. */
function numOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw));
  return Number.isFinite(n) ? n : null;
}

/** Тариф филиала в сомах за кг; 0 — если не задан. */
async function loadTariff(db: ReturnType<typeof getPrisma>): Promise<number> {
  const setting = await db.setting.findUnique({ where: { key: "tariff_per_kg" } });
  return parseFloat(setting?.value ?? "0") || 0;
}

export function registerApiRoutes(app: express.Express, bot: Bot<Context>): void {
  const api = Router();

  // ── Auth ───────────────────────────────────────────────────────────────────

  api.get("/me", (req, res) => {
    res.json({
      authenticated: !!req.session.admin,
      branch: getBranch(req),
      branches: BRANCHES,
      appVersion: APP_VERSION,
      isStaging: IS_STAGING,
    });
  });

  api.post("/login", (req, res) => {
    const { email, password, remember } = req.body as { email: string; password: string; remember?: boolean };
    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      req.session.admin = true;
      if (remember) req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
      return res.json({ ok: true });
    }
    res.status(401).json({ error: "invalid_credentials" });
  });

  api.post("/logout", (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  // ── Филиал ─────────────────────────────────────────────────────────────────

  api.post("/branch", requireApiAuth, (req, res) => {
    const { branch } = req.body as { branch?: string };
    if (!branch || !isBranch(branch)) return res.status(400).json({ error: "invalid_branch" });
    req.session.branch = branch;
    res.json({ ok: true, branch });
  });

  api.get("/meta", requireApiAuth, (req, res) => {
    res.json({ codePrefix: clientCodePrefix(getBranch(req)) });
  });

  // ── Dashboard ──────────────────────────────────────────────────────────────

  api.get("/dashboard", requireApiAuth, async (req, res) => {
    const db = getPrisma(getBranch(req));
    const now = new Date();
    const sod = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sow = new Date(sod); sow.setDate(sod.getDate() - sod.getDay() || 7);
    const som = new Date(now.getFullYear(), now.getMonth(), 1);
    const soy = new Date(now.getFullYear(), 0, 1);
    const since = (d: Date) => ({ gte: d });

    const sumWeight = (d: Date) =>
      db.package.aggregate({ where: { created_at: since(d) }, _sum: { weight: true } });

    const [
      totalUsers, totalPackages,
      usersDay, usersWeek, usersMonth, usersYear,
      pkgDay, pkgWeek, pkgMonth, pkgYear,
      weightDay, weightWeek, weightMonth, weightYear,
      pkgOffice, pkgTransit, pkgDelivered,
      latestUsers,
    ] = await Promise.all([
      db.user.count(),
      db.package.count(),
      db.user.count({ where: { created_at: since(sod) } }),
      db.user.count({ where: { created_at: since(sow) } }),
      db.user.count({ where: { created_at: since(som) } }),
      db.user.count({ where: { created_at: since(soy) } }),
      db.package.count({ where: { created_at: since(sod) } }),
      db.package.count({ where: { created_at: since(sow) } }),
      db.package.count({ where: { created_at: since(som) } }),
      db.package.count({ where: { created_at: since(soy) } }),
      sumWeight(sod),
      sumWeight(sow),
      sumWeight(som),
      sumWeight(soy),
      db.package.count({ where: { status: "IN_OFFICE" } }),
      db.package.count({ where: { status: "IN_TRANSIT" } }),
      db.package.count({ where: { status: "DELIVERED" } }),
      db.user.findMany({ orderBy: { created_at: "desc" }, take: 5 }),
    ]);

    res.json({
      totalUsers, totalPackages, pkgOffice, pkgTransit, pkgDelivered,
      period: {
        usersDay, usersWeek, usersMonth, usersYear,
        pkgDay, pkgWeek, pkgMonth, pkgYear,
        weightDay: weightDay._sum.weight ?? 0,
        weightWeek: weightWeek._sum.weight ?? 0,
        weightMonth: weightMonth._sum.weight ?? 0,
        weightYear: weightYear._sum.weight ?? 0,
      },
      latestUsers: latestUsers.map(serializeUser),
    });
  });

  // ── Users ──────────────────────────────────────────────────────────────────

  api.get("/users", requireApiAuth, async (req, res) => {
    const db = getPrisma(getBranch(req));
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = 20;
    const skip = (page - 1) * limit;
    const q = (req.query.q as string) ?? "";

    const where = q
      ? { OR: [
          { full_name:   { contains: q, mode: "insensitive" as const } },
          { phone:       { contains: q } },
          { client_code: { contains: q, mode: "insensitive" as const } },
        ] }
      : {};

    const [users, total] = await Promise.all([
      db.user.findMany({
        where, orderBy: { id: "desc" }, skip, take: limit,
        include: { _count: { select: { packages: true } } },
      }),
      db.user.count({ where }),
    ]);

    res.json({
      users: users.map(({ _count, ...u }) => ({ ...serializeUser(u), packages_count: _count.packages })),
      total,
      pages: Math.ceil(total / limit),
    });
  });

  api.post("/users", requireApiAuth, async (req, res) => {
    const branch = getBranch(req);
    const db = getPrisma(branch);
    const { full_name, phone, client_code, telegram_id } = req.body as Record<string, string>;

    const cleanPhone = phone?.trim() ?? "";
    if (!/^[0-9]{9}$/.test(cleanPhone)) return res.status(400).json({ error: "phone" });

    let code = client_code?.trim();
    if (!code) code = await userService.generateUniqueClientCode(db, branch);

    const tgId = telegram_id?.trim() ? BigInt(telegram_id.trim()) : BigInt(Date.now()) * -1n;

    try {
      const newUser = await db.user.create({
        data: { full_name: full_name.trim(), phone: cleanPhone, client_code: code, telegram_id: tgId },
      });
      res.json({ user: serializeUser(newUser) });
    } catch (e: any) {
      if (e?.code === "P2002") return res.status(409).json({ error: "duplicate_phone" });
      throw e;
    }
  });

  api.get("/users/:id", requireApiAuth, async (req, res) => {
    const db = getPrisma(getBranch(req));
    const user = await db.user.findUnique({ where: { id: Number(req.params.id) } });
    if (!user) return res.status(404).json({ error: "not_found" });

    const [packages, tariff] = await Promise.all([
      db.package.findMany({ where: { user_id: user.id }, orderBy: { created_at: "desc" } }),
      loadTariff(db),
    ]);

    res.json({ user: serializeUser(user), packages, tariff });
  });

  api.put("/users/:id", requireApiAuth, async (req, res) => {
    const db = getPrisma(getBranch(req));
    const { client_code, full_name, phone } = req.body as Record<string, string>;
    try {
      const user = await db.user.update({
        where: { id: Number(req.params.id) },
        data: { client_code, full_name, phone },
      });
      res.json({ user: serializeUser(user) });
    } catch (e: any) {
      if (e?.code === "P2002") {
        const field = (e.meta?.target as string[] | undefined)?.[0] ?? "";
        return res.status(409).json({ error: field === "phone" ? "duplicate_phone" : "duplicate_code" });
      }
      throw e;
    }
  });

  api.delete("/users/:id", requireApiAuth, async (req, res) => {
    const db = getPrisma(getBranch(req));
    await db.user.delete({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
  });

  api.post("/users/:id/packages/status", requireApiAuth, async (req, res) => {
    const db = getPrisma(getBranch(req));
    const userId = Number(req.params.id);
    const { ids, status, weight, price } = req.body as {
      ids: number[]; status: string; weight?: string | number; price?: string | number;
    };
    const validStatuses = ["IN_TRANSIT", "IN_OFFICE", "DELIVERED"];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: "invalid_status" });

    const idList = (Array.isArray(ids) ? ids : [ids]).map(Number).filter(Boolean);
    if (idList.length > 0) {
      const w = numOrNull(weight);
      // Если вес указан, а цена нет — считаем её по тарифу филиала
      let p = numOrNull(price);
      if (w !== null && p === null) {
        const tariff = await loadTariff(db);
        if (tariff > 0) p = Number((w * tariff).toFixed(2));
      }

      const data: Record<string, unknown> = { status };
      if (w !== null) data.weight = w;
      if (p !== null) data.price = p;

      await db.package.updateMany({
        where: { id: { in: idList }, user_id: userId },
        data: data as { status: "IN_TRANSIT" | "IN_OFFICE" | "DELIVERED"; weight?: number; price?: number },
      });

      if (status === "IN_OFFICE" || status === "DELIVERED") {
        const user = await db.user.findUnique({ where: { id: userId } });
        const packages = await db.package.findMany({ where: { id: { in: idList } } });
        await notifyStatusChange(bot, db, userId, user?.client_code ?? "—", packages.map(pkg => pkg.track_code), status as "IN_OFFICE" | "DELIVERED", w, p);
      }
    }
    res.json({ ok: true });
  });

  api.post("/users/:id/packages/delete", requireApiAuth, async (req, res) => {
    const db = getPrisma(getBranch(req));
    const userId = Number(req.params.id);
    const { ids } = req.body as { ids: number[] };
    const idList = (Array.isArray(ids) ? ids : [ids]).map(Number).filter(Boolean);
    if (idList.length > 0) {
      await db.package.deleteMany({ where: { id: { in: idList }, user_id: userId } });
    }
    res.json({ ok: true });
  });

  // ── Заявки на сброс доступа ──────────────────────────────────────────────────

  api.get("/reset-requests", requireApiAuth, async (req, res) => {
    const db = getPrisma(getBranch(req));
    const requests = await db.accessResetRequest.findMany({
      include: { user: { select: { id: true, client_code: true, full_name: true, phone: true, telegram_id: true } } },
      orderBy: { created_at: "desc" },
    });
    res.json({
      requests: requests.map((r) => ({
        ...r,
        requested_telegram_id: r.requested_telegram_id.toString(),
        user: { ...r.user, telegram_id: r.user.telegram_id.toString() },
      })),
    });
  });

  api.post("/reset-requests/:id/approve", requireApiAuth, async (req, res) => {
    const db = getPrisma(getBranch(req));
    const request = await db.accessResetRequest.findUnique({ where: { id: Number(req.params.id) } });
    if (!request || request.status !== "PENDING") return res.status(404).json({ error: "not_found" });

    try {
      await db.user.update({
        where: { id: request.user_id },
        data: { telegram_id: request.requested_telegram_id },
      });
    } catch (e: any) {
      if (e?.code === "P2002") return res.status(409).json({ error: "telegram_already_linked" });
      throw e;
    }

    await db.accessResetRequest.update({
      where: { id: request.id },
      data: { status: "APPROVED", resolved_at: new Date() },
    });

    await notifyResetDecision(bot, request.requested_telegram_id, true);
    res.json({ ok: true });
  });

  api.post("/reset-requests/:id/reject", requireApiAuth, async (req, res) => {
    const db = getPrisma(getBranch(req));
    const request = await db.accessResetRequest.findUnique({ where: { id: Number(req.params.id) } });
    if (!request || request.status !== "PENDING") return res.status(404).json({ error: "not_found" });

    await db.accessResetRequest.update({
      where: { id: request.id },
      data: { status: "REJECTED", resolved_at: new Date() },
    });

    await notifyResetDecision(bot, request.requested_telegram_id, false);
    res.json({ ok: true });
  });

  // ── Packages ───────────────────────────────────────────────────────────────

  api.get("/packages", requireApiAuth, async (req, res) => {
    const db = getPrisma(getBranch(req));
    const PAGE_SIZE = 25;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const search = ((req.query.search as string) ?? "").trim();
    const statusQ = (req.query.status as string) ?? "";
    const dateFrom = (req.query.date_from as string) ?? "";
    const dateTo = (req.query.date_to as string) ?? "";
    const tab = (req.query.tab as string) === "archive" ? "archive" : "active";

    const where: Record<string, unknown> = {};
    if (search) where.track_code = { contains: search, mode: "insensitive" };

    if (tab === "archive") {
      where.status = "DELIVERED";
    } else {
      where.status = statusQ && statusQ !== "DELIVERED" ? statusQ : { not: "DELIVERED" };
    }

    if (dateFrom || dateTo) {
      const range: Record<string, Date> = {};
      if (dateFrom) range.gte = new Date(dateFrom);
      if (dateTo) range.lte = new Date(dateTo + "T23:59:59.999Z");
      where.created_at = range;
    }

    const [packages, total, activeCount, archiveCount] = await Promise.all([
      db.package.findMany({
        where,
        include: { user: { select: { client_code: true, full_name: true } } },
        orderBy: { created_at: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      db.package.count({ where }),
      db.package.count({ where: { status: { not: "DELIVERED" } } }),
      db.package.count({ where: { status: "DELIVERED" } }),
    ]);

    res.json({ packages, total, totalPages: Math.ceil(total / PAGE_SIZE), activeCount, archiveCount });
  });

  api.get("/packages/new-meta", requireApiAuth, async (req, res) => {
    const db = getPrisma(getBranch(req));
    const [tariff, users] = await Promise.all([
      loadTariff(db),
      db.user.findMany({ orderBy: { client_code: "asc" }, select: { id: true, client_code: true, full_name: true } }),
    ]);
    res.json({ tariff, users });
  });

  api.post("/packages", requireApiAuth, async (req, res) => {
    const db = getPrisma(getBranch(req));
    const { user_id, track_code, status, weight, price } = req.body as Record<string, string>;
    const pkg = await db.package.create({
      data: {
        user_id: Number(user_id),
        track_code: track_code.trim(),
        status: status as "IN_OFFICE" | "IN_TRANSIT" | "DELIVERED",
        weight: weight ? parseFloat(weight) : null,
        price: price ? parseFloat(price) : null,
      },
    });
    res.json({ package: pkg });
  });

  api.get("/packages/export", requireApiAuth, async (req, res) => {
    const db = getPrisma(getBranch(req));
    const search = ((req.query.search as string) ?? "").trim();
    const statusQ = (req.query.status as string) ?? "";
    const dateFrom = (req.query.date_from as string) ?? "";
    const dateTo = (req.query.date_to as string) ?? "";
    const tab = (req.query.tab as string) === "archive" ? "archive" : "active";

    const where: Record<string, unknown> = {};
    if (search) where.track_code = { contains: search, mode: "insensitive" };
    if (tab === "archive") {
      where.status = "DELIVERED";
    } else {
      where.status = statusQ && statusQ !== "DELIVERED" ? statusQ : { not: "DELIVERED" };
    }
    if (dateFrom || dateTo) {
      const range: Record<string, Date> = {};
      if (dateFrom) range.gte = new Date(dateFrom);
      if (dateTo) range.lte = new Date(dateTo + "T23:59:59.999Z");
      where.created_at = range;
    }

    const packages = await db.package.findMany({
      where,
      include: { user: { select: { client_code: true, full_name: true } } },
      orderBy: { created_at: "desc" },
    });

    const STATUS_LABEL: Record<string, string> = { IN_OFFICE: "В офисе", IN_TRANSIT: "В пути", DELIVERED: "Выдан" };
    const wsData = [
      ["Трек-код", "Статус", "DIX-код", "Клиент", "Вес (кг)", "Цена (сом)", "Дата"],
      ...packages.map(p => [
        p.track_code, STATUS_LABEL[p.status] ?? p.status, p.user.client_code, p.user.full_name,
        p.weight ?? "", p.price ?? "", p.created_at.toLocaleString("ru-RU"),
      ]),
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, "Посылки");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const filename = `packages_${tab}_${new Date().toISOString().slice(0, 10)}.xlsx`;

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buf);
  });

  const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

  // Строим план импорта (без записи в БД): что будет добавлено, а что пропущено и почему.
  // Тот же расчёт используется и для превью (dryRun), и для реального импорта — так превью
  // совпадает с тем, что будет применено. Дубликаты внутри самого файла тоже отсеиваются.
  type ImportPlanItem = {
    clientCode: string;
    trackCode: string;
    userName: string | null;
    action: "import" | "skip";
    reason?: "user_not_found" | "duplicate";
    userId?: number;
  };

  const MAX_PREVIEW_ITEMS = 500;

  api.post("/packages/import", requireApiAuth, importUpload.single("file"), async (req, res) => {
    const branch = getBranch(req);
    const db = getPrisma(branch);
    const codePrefix = clientCodePrefix(branch);
    if (!req.file) return res.status(400).json({ error: "file_required" });

    const dryRun = req.query.dryRun === "1" || req.query.dryRun === "true";

    const filename = Buffer.from(req.file.originalname, "latin1").toString("utf8");
    const shippingDate = parseShippingDate(filename);

    const wb = XLSX.read(req.file.buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    // Код клиента читаем как ОТОБРАЖАЕМЫЙ текст ячейки (raw: false): в складских файлах
    // код задан числом с пользовательским форматом "DIX-"0000 — т.е. 114 показывается как
    // "DIX-0114". Трек-код берём из «сырых» значений, чтобы длинные номера не превратились
    // в экспоненциальную запись при форматировании.
    const codeRows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false }) as unknown[][];
    const rawRows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true }) as unknown[][];

    const items: ImportPlanItem[] = [];
    const planned = new Set<string>();
    let unrecognized = 0;

    for (let i = 0; i < rawRows.length; i++) {
      const rawCode = (codeRows[i] as unknown[] | undefined)?.[2];
      const trackCode = String((rawRows[i] as unknown[] | undefined)?.[3] ?? "").trim();
      const clientCode = parseClientCode(rawCode, codePrefix);
      if (!clientCode || !trackCode) { unrecognized++; continue; }

      const user = await db.user.findUnique({ where: { client_code: clientCode } });
      if (!user) { items.push({ clientCode, trackCode, userName: null, action: "skip", reason: "user_not_found" }); continue; }

      const dupKey = `${user.id}:${trackCode}`;
      const exists = planned.has(dupKey) || await db.package.findFirst({ where: { user_id: user.id, track_code: trackCode } });
      if (exists) { items.push({ clientCode, trackCode, userName: user.full_name ?? null, action: "skip", reason: "duplicate" }); continue; }

      planned.add(dupKey);
      items.push({ clientCode, trackCode, userName: user.full_name ?? null, action: "import", userId: user.id });
    }

    const importItems = items.filter((i) => i.action === "import");
    const toImport = importItems.length;
    const toSkip = items.length - toImport;
    const errors = items
      .filter((i) => i.reason === "user_not_found")
      .map((i) => `${i.clientCode}: пользователь не найден`);
    // Публичная форма плана — без внутреннего userId.
    const previewItems = items.slice(0, MAX_PREVIEW_ITEMS).map(({ userId: _userId, ...rest }) => rest);
    const summary = {
      shippingDate: shippingDate.toISOString(),
      toImport,
      toSkip,
      unrecognized,
      items: previewItems,
      itemsTruncated: items.length > MAX_PREVIEW_ITEMS,
      errors: errors.slice(0, 10),
    };

    // Превью: ничего не пишем, отдаём план изменений.
    if (dryRun) {
      return res.json({ dryRun: true, imported: 0, skipped: toSkip, ...summary });
    }

    // Применение: создаём только строки с action === "import".
    let imported = 0;
    for (const it of importItems) {
      await db.package.create({
        data: { user_id: it.userId!, track_code: it.trackCode, status: "IN_TRANSIT", created_at: shippingDate },
      });
      imported++;
    }

    res.json({ dryRun: false, imported, skipped: toSkip, ...summary });
  });

  api.get("/packages/:id", requireApiAuth, async (req, res) => {
    const db = getPrisma(getBranch(req));
    const [pkg, tariff] = await Promise.all([
      db.package.findUnique({
        where: { id: Number(req.params.id) },
        include: { user: { select: { client_code: true, full_name: true } } },
      }),
      loadTariff(db),
    ]);
    if (!pkg) return res.status(404).json({ error: "not_found" });
    res.json({ package: pkg, tariff });
  });

  api.put("/packages/:id", requireApiAuth, async (req, res) => {
    const db = getPrisma(getBranch(req));
    const { track_code, status, weight, price } = req.body as Record<string, string>;

    const pkg = await db.package.update({
      where: { id: Number(req.params.id) },
      data: {
        track_code: track_code.trim(),
        status: status as "IN_OFFICE" | "IN_TRANSIT" | "DELIVERED",
        weight: weight ? parseFloat(weight) : null,
        price: price ? parseFloat(price) : null,
      },
      include: { user: true },
    });

    if (status === "IN_OFFICE" || status === "DELIVERED") {
      await notifyStatusChange(bot, db, pkg.user_id, pkg.user.client_code, [pkg.track_code], status, pkg.weight, pkg.price);
    }

    res.json({ package: pkg });
  });

  api.delete("/packages/:id", requireApiAuth, async (req, res) => {
    const db = getPrisma(getBranch(req));
    await db.package.delete({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
  });

  // ── Промокоды ──────────────────────────────────────────────────────────────

  api.get("/promocodes", requireApiAuth, async (req, res) => {
    const db = getPrisma(getBranch(req));
    const promos = await db.promoCode.findMany({
      orderBy: { created_at: "desc" },
      include: { claimer: { select: { client_code: true, full_name: true, id: true } } },
    });
    res.json({ promos });
  });

  api.post("/promocodes", requireApiAuth, async (req, res) => {
    const db = getPrisma(getBranch(req));
    const { code, description } = req.body as Record<string, string>;
    const promo = await db.promoCode.create({
      data: { code: code.trim(), description: description?.trim() || null },
    });
    res.json({ promo });
  });

  api.delete("/promocodes/:id", requireApiAuth, async (req, res) => {
    const db = getPrisma(getBranch(req));
    await db.promoCode.delete({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
  });

  // ── Настройки ──────────────────────────────────────────────────────────────

  const SETTINGS_KEYS = ["forbidden_items", "tariff_per_kg", "support_text", "addresses_text"];
  const LEGACY_MANAGER_KEYS = ["manager_1_name", "manager_1_url", "manager_2_name", "manager_2_url"];
  const DEFAULT_MANAGERS = [
    { name: "Лидия", url: "https://wa.me/996550867414" },
    { name: "Виктория", url: "https://wa.me/996556969906" },
  ];

  async function loadManagers(db: ReturnType<typeof getPrisma>): Promise<{ name: string; url: string }[]> {
    const row = await db.setting.findUnique({ where: { key: "manager_buttons" } });
    if (row) {
      try {
        const parsed = JSON.parse(row.value);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // игнорируем повреждённое значение
      }
    }

    const legacy = await db.setting.findMany({ where: { key: { in: LEGACY_MANAGER_KEYS } } });
    if (legacy.length === 0) return DEFAULT_MANAGERS;
    const l: Record<string, string> = {};
    for (const row of legacy) l[row.key] = row.value;
    return [
      { name: l.manager_1_name || DEFAULT_MANAGERS[0].name, url: l.manager_1_url || DEFAULT_MANAGERS[0].url },
      { name: l.manager_2_name || DEFAULT_MANAGERS[1].name, url: l.manager_2_url || DEFAULT_MANAGERS[1].url },
    ];
  }

  api.get("/settings", requireApiAuth, async (req, res) => {
    const db = getPrisma(getBranch(req));
    const settings = await db.setting.findMany({ where: { key: { in: SETTINGS_KEYS } } });
    const s: Record<string, string> = {};
    for (const row of settings) s[row.key] = row.value;
    // Показываем текст поддержки по умолчанию, пока он не сохранён — чтобы админ правил реальное сообщение
    if (!s.support_text?.trim()) s.support_text = DEFAULT_SUPPORT_TEXT;
    if (!s.addresses_text?.trim()) s.addresses_text = DEFAULT_ADDRESSES_TEXT;
    const managers = await loadManagers(db);
    res.json({ settings: s, managers });
  });

  api.put("/settings", requireApiAuth, async (req, res) => {
    const db = getPrisma(getBranch(req));
    const body = req.body as Record<string, unknown>;
    for (const key of SETTINGS_KEYS) {
      // <input type="number"> присылает число, а не строку — иначе значение молча терялось
      const value = settingValue(body[key]);
      if (value === null) continue;
      await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    }
    if (Array.isArray(body.managers)) {
      const managers = (body.managers as { name?: unknown; url?: unknown }[])
        .map(m => ({ name: String(m.name ?? "").trim(), url: String(m.url ?? "").trim() }))
        .filter(m => m.name && m.url);
      await db.setting.upsert({
        where: { key: "manager_buttons" },
        update: { value: JSON.stringify(managers) },
        create: { key: "manager_buttons", value: JSON.stringify(managers) },
      });
    }
    res.json({ ok: true });
  });

  api.get("/db-dump", requireApiAuth, (req, res) => {
    const branch = getBranch(req);
    const databaseUrl = getDatabaseUrl(branch);
    if (!databaseUrl) {
      res.status(500).send(`База данных филиала "${branchLabel(branch)}" не настроена`);
      return;
    }

    const dump = spawn("pg_dump", [databaseUrl, "--no-owner", "--no-privileges"]);
    const chunks: Buffer[] = [];
    let stderr = "";
    dump.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    dump.stderr.on("data", (chunk: Buffer) => { stderr += chunk; });
    dump.on("error", (err) => res.status(500).send(`Не удалось запустить pg_dump: ${err.message}`));
    dump.on("close", (code) => {
      if (code !== 0) {
        console.error("pg_dump failed:", stderr);
        res.status(500).send(`pg_dump завершился с ошибкой (код ${code}): ${stderr}`);
        return;
      }
      const filename = `dump_${branch}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.sql`;
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Type", "application/sql");
      res.send(Buffer.concat(chunks));
    });
  });

  // ── Маркетплейсы ───────────────────────────────────────────────────────────

  const MARKETPLACE_KEYS = [
    { key: "marketplace_pinduoduo", label: "Pinduoduo" },
    { key: "marketplace_taobao", label: "TaoBao" },
    { key: "marketplace_1688", label: "1688" },
    { key: "marketplace_poizon", label: "Poizon" },
  ];

  const MARKETPLACE_DEFAULTS: Record<string, string> = {
    marketplace_pinduoduo:
      `<code>八 {code}\n广东省佛山市南海区里水镇大石社区石紫岗工业区石一石二工业路27号321国际仓\n13763369694 八{code}</code>\n\n` +
      `Скопируйте адрес и вставьте в приложении. Сверьте с шаблоном ниже.\n` +
      `Чтобы ваши посылки не потерялись, обязательно отправьте скриншот заполненного адреса на проверку и получите подтверждение от нашего менеджера.\n` +
      `Только после подтверждения адреса, Карго несет ответственность за ваши посылки.`,
    marketplace_taobao:
      `<code>八 {code}\n广东省佛山市南海区里水镇大石社区石紫岗工业区石一石二工业路27号321国际仓\n13763369694 八{code}</code>\n\n` +
      `Скопируйте адрес и вставьте в приложении. Сверьте с шаблоном ниже.\n` +
      `Чтобы ваши посылки не потерялись, обязательно отправьте скриншот заполненного адреса на проверку и получите подтверждение от нашего менеджера.\n` +
      `Только после подтверждения адреса, Карго несет ответственность за ваши посылки.`,
    marketplace_1688:
      `<code>八 {code}\n广东省佛山市南海区里水镇大石社区石紫岗工业区石一石二工业路27号321国际仓\n13763369694 八{code}</code>\n\n` +
      `Скопируйте адрес и вставьте в приложении. Сверьте с шаблоном ниже.\n` +
      `Чтобы ваши посылки не потерялись, обязательно отправьте скриншот заполненного адреса на проверку и получите подтверждение от нашего менеджера.\n` +
      `Только после подтверждения адреса, Карго несет ответственность за ваши посылки.`,
    marketplace_poizon:
      `<code>八 {code}\n广东省佛山市南海区里水镇大石社区石紫岗工业区石一石二工业路27号321国际仓\n13763369694 八{code}</code>\n\n` +
      `Скопируйте адрес и вставьте в приложении. Сверьте с шаблоном ниже.\n` +
      `Чтобы ваши посылки не потерялись, обязательно отправьте скриншот заполненного адреса на проверку и получите подтверждение от нашего менеджера.\n` +
      `Только после подтверждения адреса, Карго несет ответственность за ваши посылки.`,
  };

  const UPLOADS_DIR = "/app/uploads";

  const marketplaceUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        cb(null, UPLOADS_DIR);
      },
      filename: (req, file, cb) => {
        const branch = getBranch(req as express.Request);
        const fieldname = file.fieldname;
        const ext = path.extname(file.originalname).toLowerCase() || (file.mimetype.startsWith("video") ? ".mp4" : ".jpg");
        const prefix = `${branch}_${fieldname}`;
        try {
          const existing = fs.readdirSync(UPLOADS_DIR).filter(f =>
            f.startsWith(prefix + ".") || (branch === DEFAULT_BRANCH && f.startsWith(fieldname + "."))
          );
          for (const f of existing) fs.unlinkSync(path.join(UPLOADS_DIR, f));
        } catch {}
        cb(null, `${prefix}${ext}`);
      },
    }),
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  const marketplaceFields = MARKETPLACE_KEYS.flatMap(({ key }) => {
    const name = key.replace("marketplace_", "");
    return [{ name: `${name}_photo`, maxCount: 1 }, { name: `${name}_video`, maxCount: 1 }];
  });

  api.get("/marketplaces", requireApiAuth, async (req, res) => {
    const branch = getBranch(req);
    const db = getPrisma(branch);
    const settings = await db.setting.findMany({ where: { key: { in: MARKETPLACE_KEYS.map(m => m.key) } } });
    const valueMap: Record<string, string> = {};
    for (const s of settings) valueMap[s.key] = s.value;

    let uploadedFiles: string[] = [];
    try { uploadedFiles = fs.readdirSync(UPLOADS_DIR); } catch {}

    const hasFile = (prefix: string) =>
      uploadedFiles.some(f => f.startsWith(`${branch}_${prefix}.`)) ||
      (branch === DEFAULT_BRANCH && uploadedFiles.some(f => f.startsWith(prefix + ".")));

    const sections = MARKETPLACE_KEYS.map(({ key }) => {
      const name = key.replace("marketplace_", "");
      return {
        key,
        value: valueMap[key] ?? MARKETPLACE_DEFAULTS[key] ?? "",
        hasPhoto: hasFile(`${name}_photo`),
        hasVideo: hasFile(`${name}_video`),
      };
    });

    res.json({ sections });
  });

  api.post("/marketplaces", requireApiAuth, marketplaceUpload.fields(marketplaceFields), async (req, res) => {
    const db = getPrisma(getBranch(req));
    const body = req.body as Record<string, string>;
    for (const { key } of MARKETPLACE_KEYS) {
      if (typeof body[key] === "string") {
        await db.setting.upsert({ where: { key }, update: { value: body[key] }, create: { key, value: body[key] } });
      }
    }
    res.json({ ok: true });
  });

  // ── Рассылка сообщений пользователям ─────────────────────────────────────────

  const broadcastUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024, files: 10 },
  });

  // Сколько реальных пользователей бота получат рассылку в текущем филиале.
  api.get("/broadcast/audience", requireApiAuth, async (req, res) => {
    const db = getPrisma(getBranch(req));
    const count = await db.user.count({ where: { telegram_id: { gt: 0 } } });
    res.json({ count });
  });

  api.post("/broadcast", requireApiAuth, broadcastUpload.array("files", 10), async (req, res) => {
    const db = getPrisma(getBranch(req));
    const text = sanitizeTelegramHtml(String((req.body as { text?: string }).text ?? "").trim());
    const uploaded = (req.files as Express.Multer.File[] | undefined) ?? [];
    const files: BroadcastFile[] = uploaded.map((f) => ({
      buffer: f.buffer,
      // multer отдаёт имя файла в latin1 — приводим к utf8, как в импорте посылок
      filename: Buffer.from(f.originalname, "latin1").toString("utf8"),
      mimetype: f.mimetype,
    }));

    if (!text && files.length === 0) return res.status(400).json({ error: "empty" });
    if (plainTextLength(text) > TG_MESSAGE_LIMIT) return res.status(400).json({ error: "too_long" });

    const result = await sendBroadcast(bot, db, { text, files });
    res.json(result);
  });

  app.use("/api/admin", api);
}
