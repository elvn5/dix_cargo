import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import session from "express-session";
import request from "supertest";
import { EventEmitter } from "events";
import * as XLSX from "xlsx";
import type { PrismaClient } from "@prisma/client";
import type { Bot, Context } from "grammy";

vi.mock("../database/prismaClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../database/prismaClient")>();
  return { ...actual, getPrisma: vi.fn(), getDatabaseUrl: vi.fn() };
});

vi.mock("child_process", () => ({ spawn: vi.fn() }));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  const mkdirSync = vi.fn();
  const readdirSync = vi.fn().mockReturnValue([]);
  const unlinkSync = vi.fn();
  return { ...actual, mkdirSync, readdirSync, unlinkSync, default: { ...actual, mkdirSync, readdirSync, unlinkSync } };
});

import { registerApiRoutes } from "./api";
import { getPrisma, getDatabaseUrl } from "../database/prismaClient";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./auth";
import { spawn } from "child_process";
import fs from "fs";

function fakeDb(overrides: Record<string, any> = {}) {
  const base = {
    user: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      delete: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    deliveryGroup: {
      create: vi.fn().mockResolvedValue({ id: 50 }),
      delete: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { weight: null } }),
    },
    package: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      delete: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      aggregate: vi.fn().mockResolvedValue({ _sum: { weight: null } }),
    },
    setting: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    promoCode: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      delete: vi.fn().mockResolvedValue({}),
    },
    accessResetRequest: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
  };
  for (const [model, methods] of Object.entries(overrides)) {
    Object.assign((base as any)[model], methods);
  }
  // Интерактивная транзакция выполняется на том же фейковом клиенте
  (base as any).$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(base));
  return base as unknown as PrismaClient;
}

function fakeBot() {
  return { api: { sendMessage: vi.fn().mockResolvedValue(undefined) } } as unknown as Bot<Context>;
}

function buildApp(bot: Bot<Context> = fakeBot()) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test-secret", resave: false, saveUninitialized: false }));
  registerApiRoutes(app, bot);
  return app;
}

async function loginAgent(app: express.Express) {
  const agent = request.agent(app);
  await agent.post("/api/admin/login").send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  return agent;
}

const getPrismaMock = vi.mocked(getPrisma);
const getDatabaseUrlMock = vi.mocked(getDatabaseUrl);

beforeEach(() => {
  getPrismaMock.mockReset();
  getDatabaseUrlMock.mockReset();
  vi.mocked(spawn).mockReset();
  vi.mocked(fs.readdirSync).mockReset().mockReturnValue([] as any);
  vi.mocked(fs.mkdirSync).mockReset();
  vi.mocked(fs.unlinkSync).mockReset();
});

// ── Auth ─────────────────────────────────────────────────────────────────────

describe("auth routes", () => {
  it("GET /me reports unauthenticated by default", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/admin/me");
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
    expect(res.body.branch).toBe("bishkek");
  });

  it("POST /login succeeds with correct credentials and sets the session", async () => {
    const app = buildApp();
    const agent = await loginAgent(app);
    const me = await agent.get("/api/admin/me");
    expect(me.body.authenticated).toBe(true);
  });

  it("POST /login rejects wrong credentials", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/admin/login").send({ email: "x", password: "y" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_credentials");
  });

  it("POST /login extends the cookie lifetime when remember is set", async () => {
    const app = buildApp();
    const agent = request.agent(app);
    const res = await agent.post("/api/admin/login").send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, remember: true });
    expect(res.status).toBe(200);
    const cookie = res.headers["set-cookie"]?.[0] ?? "";
    expect(cookie).toMatch(/Expires=/);
  });

  it("POST /logout clears the session", async () => {
    const app = buildApp();
    const agent = await loginAgent(app);
    await agent.post("/api/admin/logout");
    const me = await agent.get("/api/admin/me");
    expect(me.body.authenticated).toBe(false);
  });

  it("protected routes return 401 when not authenticated", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/admin/dashboard");
    expect(res.status).toBe(401);
  });
});

// ── Branch ───────────────────────────────────────────────────────────────────

describe("POST /branch", () => {
  it("switches the session branch", async () => {
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.post("/api/admin/branch").send({ branch: "kant" });
    expect(res.body).toEqual({ ok: true, branch: "kant" });

    const me = await agent.get("/api/admin/me");
    expect(me.body.branch).toBe("kant");
  });

  it("rejects an invalid branch", async () => {
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.post("/api/admin/branch").send({ branch: "osh" });
    expect(res.status).toBe(400);
  });
});

describe("GET /meta", () => {
  it("returns the branch's client code prefix", async () => {
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.get("/api/admin/meta");
    expect(res.body).toEqual({ codePrefix: "DIX" });
  });
});

// ── Dashboard ────────────────────────────────────────────────────────────────

describe("GET /dashboard", () => {
  it("aggregates counts and the latest users", async () => {
    const db = fakeDb({
      user: {
        count: vi.fn().mockResolvedValue(2),
        findMany: vi.fn().mockResolvedValue([
          { id: 1, telegram_id: 42n, full_name: "A", phone: "1", client_code: "DIX-0001", created_at: new Date(), updated_at: new Date() },
        ]),
      },
      package: {
        count: vi.fn().mockResolvedValue(5),
        aggregate: vi.fn().mockResolvedValue({ _sum: { weight: 12.5 } }),
      },
    });
    getPrismaMock.mockReturnValue(db);

    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.get("/api/admin/dashboard");

    expect(res.status).toBe(200);
    expect(res.body.totalUsers).toBe(2);
    expect(res.body.totalPackages).toBe(5);
    expect(res.body.latestUsers[0].telegram_id).toBe("42");
    expect(res.body.period.weightDay).toBe(12.5);
    expect(res.body.period.weightWeek).toBe(12.5);
    expect(res.body.period.weightMonth).toBe(12.5);
    expect(res.body.period.weightYear).toBe(12.5);
  });

  it("defaults period weights to 0 when there are no packages", async () => {
    const db = fakeDb();
    getPrismaMock.mockReturnValue(db);

    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.get("/api/admin/dashboard");

    expect(res.body.period.weightDay).toBe(0);
    expect(res.body.period.weightYear).toBe(0);
  });
});

// ── Users ────────────────────────────────────────────────────────────────────

describe("users routes", () => {
  it("GET /users lists and paginates, serializing telegram_id and package counts", async () => {
    const db = fakeDb({
      user: {
        findMany: vi.fn().mockResolvedValue([
          { id: 1, telegram_id: 100n, full_name: "A", phone: "1", client_code: "DIX-0001", created_at: new Date(), updated_at: new Date(), _count: { packages: 3 } },
        ]),
        count: vi.fn().mockResolvedValue(1),
      },
    });
    getPrismaMock.mockReturnValue(db);

    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.get("/api/admin/users?page=1&q=");

    expect(res.body.total).toBe(1);
    expect(res.body.pages).toBe(1);
    expect(res.body.users[0].telegram_id).toBe("100");
    expect(res.body.users[0].packages_count).toBe(3);
    expect(res.body.users[0]._count).toBeUndefined();
  });

  it("GET /users also finds a user by chat id", async () => {
    const db = fakeDb();
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    await agent.get("/api/admin/users?page=1&q=434413828");
    const where = (db.user.findMany as any).mock.calls[0][0].where;
    expect(where.OR).toContainEqual({ telegram_id: 434413828n });
  });

  it("POST /users rejects a malformed phone", async () => {
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.post("/api/admin/users").send({ full_name: "A", phone: "abc" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("phone");
  });

  it("POST /users creates a user, generating a client code when omitted", async () => {
    const created = { id: 1, telegram_id: -1n, full_name: "A", phone: "500100500", client_code: "DIX-0001", created_at: new Date(), updated_at: new Date() };
    const db = fakeDb({ user: { create: vi.fn().mockResolvedValue(created) } });
    getPrismaMock.mockReturnValue(db);

    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.post("/api/admin/users").send({ full_name: "A", phone: "500100500" });

    expect(res.status).toBe(200);
    expect(res.body.user.client_code).toBe("DIX-0001");
    expect(db.user.create).toHaveBeenCalled();
  });

  it("POST /users returns 409 on duplicate phone", async () => {
    const db = fakeDb({ user: { create: vi.fn().mockRejectedValue({ code: "P2002" }) } });
    getPrismaMock.mockReturnValue(db);

    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.post("/api/admin/users").send({ full_name: "A", phone: "500100500" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("duplicate_phone");
  });

  it("POST /users rethrows unexpected errors as a 500", async () => {
    const db = fakeDb({ user: { create: vi.fn().mockRejectedValue(new Error("db exploded")) } });
    getPrismaMock.mockReturnValue(db);

    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.post("/api/admin/users").send({ full_name: "A", phone: "500100500" });
    expect(res.status).toBe(500);
  });

  it("GET /users/:id 404s when missing", async () => {
    const db = fakeDb();
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.get("/api/admin/users/999");
    expect(res.status).toBe(404);
  });

  it("GET /users/:id returns the user, packages and tariff", async () => {
    const user = { id: 1, telegram_id: 1n, full_name: "A", phone: "1", client_code: "DIX-0001", created_at: new Date(), updated_at: new Date() };
    const db = fakeDb({
      user: { findUnique: vi.fn().mockResolvedValue(user) },
      package: { findMany: vi.fn().mockResolvedValue([{ id: 9, track_code: "T1" }]) },
      setting: { findUnique: vi.fn().mockResolvedValue({ key: "tariff_per_kg", value: "150" }) },
    });
    getPrismaMock.mockReturnValue(db);

    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.get("/api/admin/users/1");

    expect(res.body.user.telegram_id).toBe("1");
    expect(res.body.packages).toHaveLength(1);
    expect(res.body.tariff).toBe(150);
    expect(res.body.deliveries).toEqual([]);
  });

  it("PUT /users/:id returns 409 duplicate_code when the code collides", async () => {
    const db = fakeDb({
      user: { update: vi.fn().mockRejectedValue({ code: "P2002", meta: { target: ["client_code"] } }) },
    });
    getPrismaMock.mockReturnValue(db);

    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.put("/api/admin/users/1").send({ client_code: "DIX-0001", full_name: "A", phone: "1" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("duplicate_code");
  });

  it("PUT /users/:id rethrows unexpected errors as a 500", async () => {
    const db = fakeDb({ user: { update: vi.fn().mockRejectedValue(new Error("db exploded")) } });
    getPrismaMock.mockReturnValue(db);

    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.put("/api/admin/users/1").send({ client_code: "DIX-0001", full_name: "A", phone: "1" });
    expect(res.status).toBe(500);
  });

  it("DELETE /users/:id moves the user to the trash instead of deleting", async () => {
    const db = fakeDb();
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.delete("/api/admin/users/1");
    expect(res.body).toEqual({ ok: true });
    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: { id: 1, deleted_at: null },
      data: { deleted_at: expect.any(Date) },
    });
    expect(db.user.delete).not.toHaveBeenCalled();
    expect(db.package.deleteMany).not.toHaveBeenCalled();
  });

  it("DELETE /users/:id 404s when the user is missing or already in the trash", async () => {
    const db = fakeDb({ user: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.delete("/api/admin/users/1");
    expect(res.status).toBe(404);
  });

  it("GET /users lists only users that are not in the trash", async () => {
    const db = fakeDb();
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    await agent.get("/api/admin/users?page=1&q=");
    expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { deleted_at: null } }));
  });

  it("POST /users reports that a duplicate phone belongs to a user in the trash", async () => {
    const db = fakeDb({
      user: {
        create: vi.fn().mockRejectedValue({ code: "P2002", meta: { target: ["phone"] } }),
        findFirst: vi.fn().mockResolvedValue({ id: 48, deleted_at: new Date() }),
      },
    });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.post("/api/admin/users").send({ full_name: "A", phone: "500100500", client_code: "DIX-0017" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "duplicate_phone", in_trash: true, user_id: 48 });
  });
});

describe("trash routes", () => {
  it("GET /trash lists trashed users with their package counts", async () => {
    const db = fakeDb({
      user: {
        findMany: vi.fn().mockResolvedValue([
          { id: 48, telegram_id: -1n, full_name: "A", phone: "1", client_code: "DIX-0017", deleted_at: new Date(), _count: { packages: 8 } },
        ]),
      },
    });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.get("/api/admin/trash");
    expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { deleted_at: { not: null } } }));
    expect(res.body.users[0]).toMatchObject({ id: 48, packages_count: 8, telegram_id: "-1" });
  });

  it("POST /trash/:id/restore brings the user back", async () => {
    const db = fakeDb();
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.post("/api/admin/trash/48/restore");
    expect(res.body).toEqual({ ok: true });
    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: { id: 48, deleted_at: { not: null } },
      data: { deleted_at: null },
    });
  });

  it("POST /trash/:id/restore 404s for a user that is not in the trash", async () => {
    const db = fakeDb({ user: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.post("/api/admin/trash/48/restore");
    expect(res.status).toBe(404);
  });

  it("DELETE /trash/:id deletes permanently only users from the trash", async () => {
    const db = fakeDb();
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.delete("/api/admin/trash/48");
    expect(res.body).toEqual({ ok: true });
    expect(db.user.deleteMany).toHaveBeenCalledWith({ where: { id: 48, deleted_at: { not: null } } });
  });

  it("DELETE /trash/:id logs a full snapshot of the user and packages before deleting", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const snapshot = { id: 48, client_code: "DIX-0017", deleted_at: new Date(), packages: [{ id: 2245, track_code: "JT5522254535556" }] };
    const db = fakeDb({ user: { findFirst: vi.fn().mockResolvedValue(snapshot) } });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    await agent.delete("/api/admin/trash/48");

    const entries = log.mock.calls.map(([line]) => { try { return JSON.parse(String(line)); } catch { return null; } });
    const purge = entries.find((e) => e?.event === "user.purge");
    expect(purge.user.client_code).toBe("DIX-0017");
    expect(purge.user.packages[0].track_code).toBe("JT5522254535556");
    expect(entries.some((e) => e?.event === "admin.request" && e.method === "DELETE" && e.status === 200)).toBe(true);
    log.mockRestore();
  });

  it("DELETE /trash/:id 404s for an active user", async () => {
    const db = fakeDb({ user: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) } });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.delete("/api/admin/trash/1");
    expect(res.status).toBe(404);
  });
});

describe("POST /users/:id/packages/status", () => {
  it("rejects an invalid status", async () => {
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.post("/api/admin/users/1/packages/status").send({ ids: [1], status: "BOGUS" });
    expect(res.status).toBe(400);
  });

  it("updates packages and notifies the user on IN_OFFICE", async () => {
    const bot = fakeBot();
    const db = fakeDb({
      user: { findUnique: vi.fn().mockResolvedValue({ id: 1, client_code: "DIX-0001", telegram_id: 555n }) },
      package: { findMany: vi.fn().mockResolvedValue([{ id: 9, track_code: "T1" }]) },
    });
    getPrismaMock.mockReturnValue(db);

    const app = buildApp(bot);
    const agent = await loginAgent(app);
    const res = await agent.post("/api/admin/users/1/packages/status").send({ ids: [9], status: "IN_OFFICE", weight: "2.5", price: "375" });

    expect(res.body).toEqual({ ok: true });
    expect(db.package.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [9] }, user_id: 1 },
      data: { status: "IN_OFFICE", delivery_group_id: null, weight: 2.5, price: 375 },
    });
    expect(bot.api.sendMessage).toHaveBeenCalledWith(555, expect.any(String), { parse_mode: "HTML" });
  });

  it("computes the price from the tariff when only the weight is given", async () => {
    const bot = fakeBot();
    const db = fakeDb({
      user: { findUnique: vi.fn().mockResolvedValue({ id: 1, client_code: "DIX-0001", telegram_id: 555n }) },
      package: { findMany: vi.fn().mockResolvedValue([{ id: 9, track_code: "T1" }]) },
      setting: { findUnique: vi.fn().mockResolvedValue({ key: "tariff_per_kg", value: "150" }) },
    });
    getPrismaMock.mockReturnValue(db);

    const app = buildApp(bot);
    const agent = await loginAgent(app);
    await agent.post("/api/admin/users/1/packages/status").send({ ids: [9], status: "IN_OFFICE", weight: 2.5 });

    expect(db.package.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [9] }, user_id: 1 },
      data: { status: "IN_OFFICE", delivery_group_id: null, weight: 2.5, price: 375 },
    });
  });

  it("keeps the price sent by the admin instead of the tariff calculation", async () => {
    const bot = fakeBot();
    const db = fakeDb({
      user: { findUnique: vi.fn().mockResolvedValue({ id: 1, client_code: "DIX-0001", telegram_id: 555n }) },
      package: { findMany: vi.fn().mockResolvedValue([{ id: 9, track_code: "T1" }]) },
      setting: { findUnique: vi.fn().mockResolvedValue({ key: "tariff_per_kg", value: "150" }) },
    });
    getPrismaMock.mockReturnValue(db);

    const app = buildApp(bot);
    const agent = await loginAgent(app);
    await agent.post("/api/admin/users/1/packages/status").send({ ids: [9], status: "IN_OFFICE", weight: 2, price: 100 });

    expect(db.package.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [9] }, user_id: 1 },
      data: { status: "IN_OFFICE", delivery_group_id: null, weight: 2, price: 100 },
    });
  });

  it("leaves the price empty when no tariff is configured", async () => {
    const bot = fakeBot();
    const db = fakeDb({
      user: { findUnique: vi.fn().mockResolvedValue({ id: 1, client_code: "DIX-0001", telegram_id: 555n }) },
      package: { findMany: vi.fn().mockResolvedValue([{ id: 9, track_code: "T1" }]) },
      setting: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    getPrismaMock.mockReturnValue(db);

    const app = buildApp(bot);
    const agent = await loginAgent(app);
    await agent.post("/api/admin/users/1/packages/status").send({ ids: [9], status: "IN_OFFICE", weight: 2 });

    expect(db.package.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [9] }, user_id: 1 },
      data: { status: "IN_OFFICE", delivery_group_id: null, weight: 2 },
    });
  });

  it("DELIVERED creates a delivery group with the weight and price and zeroes the packages", async () => {
    const bot = fakeBot();
    const db = fakeDb({
      user: { findUnique: vi.fn().mockResolvedValue({ id: 1, client_code: "DIX-0001", telegram_id: 555n }) },
      package: {
        updateMany: vi.fn().mockResolvedValue({ count: 3 }),
        findMany: vi.fn().mockResolvedValue([{ track_code: "T1" }, { track_code: "T2" }, { track_code: "T3" }]),
      },
    });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp(bot);
    const agent = await loginAgent(app);
    const res = await agent.post("/api/admin/users/1/packages/status")
      .send({ ids: [7, 8, 9], status: "DELIVERED", weight: "2.35", price: "558.36" });

    expect(res.body).toEqual({ ok: true });
    expect(db.deliveryGroup.create).toHaveBeenCalledWith({ data: { user_id: 1, weight: 2.35, price: 558.36 } });
    expect(db.package.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [7, 8, 9] }, user_id: 1 },
      data: { status: "DELIVERED", delivery_group_id: 50, weight: 0, price: 0 },
    });
    // В уведомлении — общий вес и цена выдачи
    const text = (bot.api.sendMessage as any).mock.calls[0][1] as string;
    expect(text).toContain("2.35 кг");
    expect(text).toContain("558,36");
  });

  it("DELIVERED without weight and price keeps the packages' own values", async () => {
    const db = fakeDb({ package: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    await agent.post("/api/admin/users/1/packages/status").send({ ids: [9], status: "DELIVERED" });

    expect(db.deliveryGroup.create).toHaveBeenCalledWith({ data: { user_id: 1, weight: null, price: null } });
    expect(db.package.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [9] }, user_id: 1 },
      data: { status: "DELIVERED", delivery_group_id: 50 },
    });
  });

  it("DELIVERED drops the empty group when none of the packages belong to the user", async () => {
    const db = fakeDb({ package: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    await agent.post("/api/admin/users/1/packages/status").send({ ids: [9], status: "DELIVERED", weight: 1 });
    expect(db.deliveryGroup.delete).toHaveBeenCalledWith({ where: { id: 50 } });
  });

  it("does not notify for IN_TRANSIT", async () => {
    const bot = fakeBot();
    const db = fakeDb();
    getPrismaMock.mockReturnValue(db);
    const app = buildApp(bot);
    const agent = await loginAgent(app);
    await agent.post("/api/admin/users/1/packages/status").send({ ids: [9], status: "IN_TRANSIT" });
    expect(bot.api.sendMessage).not.toHaveBeenCalled();
  });
});

describe("POST /users/:id/packages/delete", () => {
  it("logs the deleted packages so they can be restored", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const db = fakeDb({ package: { findMany: vi.fn().mockResolvedValue([{ id: 9, track_code: "SF1220355201421" }]) } });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    await agent.post("/api/admin/users/112/packages/delete").send({ ids: [9] });

    const entry = log.mock.calls
      .map(([line]) => { try { return JSON.parse(String(line)); } catch { return null; } })
      .find((e) => e?.event === "packages.delete");
    expect(entry).toMatchObject({ level: "warn", user_id: 112, packages: [{ id: 9, track_code: "SF1220355201421" }] });
    log.mockRestore();
  });

  it("deletes the given packages scoped to the user", async () => {
    const db = fakeDb();
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.post("/api/admin/users/1/packages/delete").send({ ids: [9, 10] });

    expect(res.body).toEqual({ ok: true });
    expect(db.package.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [9, 10] }, user_id: 1 } });
  });

  it("does nothing when no ids are given", async () => {
    const db = fakeDb();
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.post("/api/admin/users/1/packages/delete").send({ ids: [] });

    expect(res.body).toEqual({ ok: true });
    expect(db.package.deleteMany).not.toHaveBeenCalled();
  });
});

describe("reset-requests routes", () => {
  function fakeRequest(overrides: Record<string, any> = {}) {
    return {
      id: 3,
      user_id: 1,
      requested_telegram_id: 777n,
      status: "PENDING",
      created_at: new Date("2026-01-01"),
      resolved_at: null,
      ...overrides,
    };
  }

  it("GET /reset-requests lists requests with the user attached", async () => {
    const db = fakeDb({
      accessResetRequest: {
        findMany: vi.fn().mockResolvedValue([
          { ...fakeRequest(), user: { id: 1, client_code: "DIX-0001", full_name: "Иван Иванов", phone: "500100500", telegram_id: 555n } },
        ]),
      },
    });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.get("/api/admin/reset-requests");

    expect(res.body.requests).toHaveLength(1);
    expect(res.body.requests[0].requested_telegram_id).toBe("777");
    expect(res.body.requests[0].user.telegram_id).toBe("555");
    expect(res.body.requests[0].user.client_code).toBe("DIX-0001");
  });

  it("POST /reset-requests/:id/approve relinks the user and notifies the requester", async () => {
    const bot = fakeBot();
    const db = fakeDb({
      accessResetRequest: { findUnique: vi.fn().mockResolvedValue(fakeRequest()) },
    });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp(bot);
    const agent = await loginAgent(app);
    const res = await agent.post("/api/admin/reset-requests/3/approve");

    expect(res.body).toEqual({ ok: true });
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { telegram_id: 777n } });
    expect(db.accessResetRequest.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { status: "APPROVED", resolved_at: expect.any(Date) },
    });
    expect(bot.api.sendMessage).toHaveBeenCalledWith(777, expect.stringContaining("успешно сброшен"), { parse_mode: "HTML" });
  });

  it("POST /reset-requests/:id/approve returns 409 when the telegram id is already linked to another account", async () => {
    const bot = fakeBot();
    const db = fakeDb({
      accessResetRequest: { findUnique: vi.fn().mockResolvedValue(fakeRequest()) },
      user: { update: vi.fn().mockRejectedValue({ code: "P2002" }) },
    });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp(bot);
    const agent = await loginAgent(app);
    const res = await agent.post("/api/admin/reset-requests/3/approve");

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "telegram_already_linked" });
    expect(db.accessResetRequest.update).not.toHaveBeenCalled();
  });

  it("POST /reset-requests/:id/approve 404s for a request that's already resolved", async () => {
    const db = fakeDb({
      accessResetRequest: { findUnique: vi.fn().mockResolvedValue(fakeRequest({ status: "APPROVED" })) },
    });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.post("/api/admin/reset-requests/3/approve");
    expect(res.status).toBe(404);
  });

  it("POST /reset-requests/:id/reject marks the request rejected and notifies the requester", async () => {
    const bot = fakeBot();
    const db = fakeDb({
      accessResetRequest: { findUnique: vi.fn().mockResolvedValue(fakeRequest()) },
    });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp(bot);
    const agent = await loginAgent(app);
    const res = await agent.post("/api/admin/reset-requests/3/reject");

    expect(res.body).toEqual({ ok: true });
    expect(db.user.update).not.toHaveBeenCalled();
    expect(db.accessResetRequest.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { status: "REJECTED", resolved_at: expect.any(Date) },
    });
    expect(bot.api.sendMessage).toHaveBeenCalledWith(777, expect.stringContaining("отклонена"), { parse_mode: "HTML" });
  });

  it("POST /reset-requests/:id/reject 404s for an unknown request", async () => {
    const db = fakeDb({
      accessResetRequest: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.post("/api/admin/reset-requests/999/reject");
    expect(res.status).toBe(404);
  });
});

// ── Packages ─────────────────────────────────────────────────────────────────

describe("packages routes", () => {
  it("GET /packages returns active packages by default, excluding DELIVERED", async () => {
    const db = fakeDb({ package: { count: vi.fn().mockResolvedValue(3) } });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.get("/api/admin/packages");
    expect(res.status).toBe(200);
    expect(db.package.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { not: "DELIVERED" } }) })
    );
  });

  it("GET /packages filters the archive tab to DELIVERED", async () => {
    const db = fakeDb();
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    await agent.get("/api/admin/packages?tab=archive");
    expect(db.package.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "DELIVERED" }) })
    );
  });

  it("GET /packages applies a date range filter", async () => {
    const db = fakeDb();
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    await agent.get("/api/admin/packages?date_from=2026-01-01&date_to=2026-01-31");
    const call = (db.package.findMany as any).mock.calls[0][0];
    expect(call.where.created_at.gte).toBeInstanceOf(Date);
    expect(call.where.created_at.lte).toBeInstanceOf(Date);
  });

  it("GET /packages filters by an explicit status", async () => {
    const db = fakeDb();
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    await agent.get("/api/admin/packages?status=IN_OFFICE&search=TR");
    const call = (db.package.findMany as any).mock.calls[0][0];
    expect(call.where.status).toBe("IN_OFFICE");
    expect(call.where.track_code).toEqual({ contains: "TR", mode: "insensitive" });
  });

  it("GET /packages/new-meta returns tariff and users", async () => {
    const db = fakeDb({
      setting: { findUnique: vi.fn().mockResolvedValue({ key: "tariff_per_kg", value: "100" }) },
      user: { findMany: vi.fn().mockResolvedValue([{ id: 1, client_code: "DIX-0001", full_name: "A" }]) },
    });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.get("/api/admin/packages/new-meta");
    expect(res.body.tariff).toBe(100);
    expect(res.body.users).toHaveLength(1);
  });

  it("POST /packages creates a package", async () => {
    const db = fakeDb({ package: { create: vi.fn().mockResolvedValue({ id: 1, track_code: "T1" }) } });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.post("/api/admin/packages").send({ user_id: "1", track_code: " T1 ", status: "IN_TRANSIT" });
    expect(res.body.package.track_code).toBe("T1");
    expect(db.package.create).toHaveBeenCalledWith({
      data: { user_id: 1, track_code: "T1", status: "IN_TRANSIT", weight: null, price: null },
    });
  });

  it("POST /packages refuses a duplicate track code of another client", async () => {
    const db = fakeDb({
      package: {
        findFirst: vi.fn().mockResolvedValue({
          id: 112, track_code: "JT5528716373946", status: "IN_OFFICE",
          user: { id: 1, client_code: "KADIX-0001", full_name: "Мусаева Милана", deleted_at: null },
        }),
      },
    });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.post("/api/admin/packages").send({ user_id: "11", track_code: " jt5528716373946 ", status: "IN_OFFICE" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: "duplicate_track",
      existing: {
        id: 112, track_code: "JT5528716373946", status: "IN_OFFICE",
        user_id: 1, client_code: "KADIX-0001", full_name: "Мусаева Милана", in_trash: false,
      },
    });
    expect(db.package.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { track_code: { equals: "jt5528716373946", mode: "insensitive" } },
    }));
    expect(db.package.create).not.toHaveBeenCalled();
  });

  it("POST /packages rejects an empty track code", async () => {
    const db = fakeDb();
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.post("/api/admin/packages").send({ user_id: "1", track_code: "  ", status: "IN_TRANSIT" });
    expect(res.status).toBe(400);
    expect(db.package.create).not.toHaveBeenCalled();
  });

  it("PUT /packages/:id refuses a track code that another package already has", async () => {
    const db = fakeDb({
      package: {
        findFirst: vi.fn().mockResolvedValue({
          id: 5, track_code: "T2", status: "IN_TRANSIT",
          user: { id: 2, client_code: "DIX-0002", full_name: "B", deleted_at: new Date() },
        }),
      },
    });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.put("/api/admin/packages/1").send({ track_code: "T2", status: "IN_TRANSIT" });

    expect(res.status).toBe(409);
    expect(res.body.existing).toMatchObject({ id: 5, in_trash: true });
    expect(db.package.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { track_code: { equals: "T2", mode: "insensitive" }, id: { not: 1 } },
    }));
    expect(db.package.update).not.toHaveBeenCalled();
  });

  it("PUT /packages/:id detaches the package from its delivery when it is no longer delivered", async () => {
    const db = fakeDb({
      package: { update: vi.fn().mockResolvedValue({ id: 1, track_code: "T1", user_id: 1, user: { client_code: "DIX-0001" } }) },
    });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    await agent.put("/api/admin/packages/1").send({ track_code: "T1", status: "IN_TRANSIT" });
    expect(db.package.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ delivery_group_id: null }),
    }));
  });

  it("GET /packages/:id 404s when missing", async () => {
    const db = fakeDb();
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.get("/api/admin/packages/1");
    expect(res.status).toBe(404);
  });

  it("GET /packages/:id returns the package and tariff when found", async () => {
    const db = fakeDb({
      package: { findUnique: vi.fn().mockResolvedValue({ id: 1, track_code: "T1", user: { client_code: "DIX-0001", full_name: "A" } }) },
      setting: { findUnique: vi.fn().mockResolvedValue({ key: "tariff_per_kg", value: "80" }) },
    });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.get("/api/admin/packages/1");
    expect(res.status).toBe(200);
    expect(res.body.package.track_code).toBe("T1");
    expect(res.body.tariff).toBe(80);
  });

  it("PUT /packages/:id notifies on DELIVERED", async () => {
    const bot = fakeBot();
    const db = fakeDb({
      package: {
        update: vi.fn().mockResolvedValue({
          id: 1, track_code: "T1", user_id: 1, weight: 1, price: 100,
          user: { client_code: "DIX-0001", telegram_id: 777n },
        }),
      },
      user: { findUnique: vi.fn().mockResolvedValue({ telegram_id: 777n }) },
    });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp(bot);
    const agent = await loginAgent(app);
    await agent.put("/api/admin/packages/1").send({ track_code: "T1", status: "DELIVERED" });
    expect(bot.api.sendMessage).toHaveBeenCalledWith(777, expect.any(String), { parse_mode: "HTML" });
  });

  it("DELETE /packages/:id deletes", async () => {
    const db = fakeDb();
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.delete("/api/admin/packages/1");
    expect(res.body).toEqual({ ok: true });
  });

  it("GET /packages/export streams an xlsx file", async () => {
    const db = fakeDb({
      package: {
        findMany: vi.fn().mockResolvedValue([
          { track_code: "T1", status: "IN_TRANSIT", weight: 1, price: 100, created_at: new Date(), user: { client_code: "DIX-0001", full_name: "A" } },
        ]),
      },
    });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.get("/api/admin/packages/export");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
  });

  it("GET /packages/export applies the archive tab, search and date filters", async () => {
    const db = fakeDb();
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    await agent.get("/api/admin/packages/export?tab=archive&search=TR&date_from=2026-01-01&date_to=2026-01-31");
    const call = (db.package.findMany as any).mock.calls[0][0];
    expect(call.where.status).toBe("DELIVERED");
    expect(call.where.track_code).toEqual({ contains: "TR", mode: "insensitive" });
    expect(call.where.created_at.gte).toBeInstanceOf(Date);
    expect(call.where.created_at.lte).toBeInstanceOf(Date);
  });
});

describe("POST /packages/import", () => {
  function xlsxBuffer(rows: unknown[][]) {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  }

  it("requires a file", async () => {
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.post("/api/admin/packages/import");
    expect(res.status).toBe(400);
  });

  it("imports rows, skipping unknown client codes and duplicates", async () => {
    const db = fakeDb({
      user: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ id: 1, client_code: "DIX-0001" }) // row 1: known
          .mockResolvedValueOnce(null),                               // row 2: unknown
      },
      package: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    getPrismaMock.mockReturnValue(db);

    const rows = [
      ["", "", "DIX-0001", "TRACK1"],
      ["", "", "DIX-9999", "TRACK2"],
      ["", "", "", ""], // skipped: no code, no track
    ];

    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent
      .post("/api/admin/packages/import")
      .attach("file", xlsxBuffer(rows), "import.xlsx");

    expect(res.body.imported).toBe(1);
    expect(res.body.skipped).toBe(1);
    expect(res.body.errors[0]).toContain("DIX-9999");
    expect(db.package.create).toHaveBeenCalledTimes(1);
  });

  it("parses DIX-**** codes in all supported formats for the Бишкек branch", async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 1, client_code: "DIX-0001" });
    const db = fakeDb({
      user: { findUnique },
      package: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    getPrismaMock.mockReturnValue(db);

    const rows = [
      ["", "", "DIX-0001", "TRACK1"], // dash
      ["", "", "DIX0002", "TRACK2"],  // no separator
      ["", "", "dix 0003", "TRACK3"], // space, lowercase
    ];

    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent
      .post("/api/admin/packages/import")
      .attach("file", xlsxBuffer(rows), "import.xlsx");

    expect(res.body.imported).toBe(3);
    expect(findUnique.mock.calls.map((c) => c[0].where.client_code)).toEqual([
      "DIX-0001", "DIX-0002", "DIX-0003",
    ]);
  });

  it("parses KADIX-**** codes in all supported formats for the Кант branch", async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 5, client_code: "KADIX-0001" });
    const db = fakeDb({
      user: { findUnique },
      package: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    getPrismaMock.mockReturnValue(db);

    const rows = [
      ["", "", "KADIX-0001", "TRACK1"], // dash
      ["", "", "KADIX0002", "TRACK2"],  // no separator
      ["", "", "kadix 0003", "TRACK3"], // space, lowercase
    ];

    const app = buildApp();
    const agent = await loginAgent(app);
    await agent.post("/api/admin/branch").send({ branch: "kant" });

    const res = await agent
      .post("/api/admin/packages/import")
      .attach("file", xlsxBuffer(rows), "import.xlsx");

    expect(res.body.imported).toBe(3);
    expect(findUnique.mock.calls.map((c) => c[0].where.client_code)).toEqual([
      "KADIX-0001", "KADIX-0002", "KADIX-0003",
    ]);
  });

  it("ignores DIX-**** rows when importing for the Кант branch", async () => {
    const findUnique = vi.fn();
    const db = fakeDb({ user: { findUnique } });
    getPrismaMock.mockReturnValue(db);

    const rows = [["", "", "DIX-0001", "TRACK1"]];

    const app = buildApp();
    const agent = await loginAgent(app);
    await agent.post("/api/admin/branch").send({ branch: "kant" });

    const res = await agent
      .post("/api/admin/packages/import")
      .attach("file", xlsxBuffer(rows), "import.xlsx");

    expect(res.body.imported).toBe(0);
    expect(res.body.skipped).toBe(0);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("ignores KADIX-**** rows when importing for the Бишкек branch", async () => {
    const findUnique = vi.fn();
    const db = fakeDb({ user: { findUnique } });
    getPrismaMock.mockReturnValue(db);

    const rows = [["", "", "KADIX-0001", "TRACK1"]];

    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent
      .post("/api/admin/packages/import")
      .attach("file", xlsxBuffer(rows), "import.xlsx");

    expect(res.body.imported).toBe(0);
    expect(res.body.skipped).toBe(0);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("dryRun=1 returns a preview plan and writes nothing", async () => {
    const db = fakeDb({
      user: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ id: 1, client_code: "DIX-0001", full_name: "Иван" }) // known
          .mockResolvedValueOnce(null),                                                                    // unknown
      },
      package: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    getPrismaMock.mockReturnValue(db);

    const rows = [
      ["", "", "DIX-0001", "TRACK1"],
      ["", "", "DIX-9999", "TRACK2"],
      ["", "", "", ""],
    ];

    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent
      .post("/api/admin/packages/import?dryRun=1")
      .attach("file", xlsxBuffer(rows), "import.xlsx");

    expect(res.body.dryRun).toBe(true);
    expect(res.body.imported).toBe(0);
    expect(res.body.toImport).toBe(1);
    expect(res.body.toSkip).toBe(1);
    expect(res.body.unrecognized).toBe(1);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0]).toMatchObject({ clientCode: "DIX-0001", trackCode: "TRACK1", action: "import" });
    expect(res.body.items[1]).toMatchObject({ clientCode: "DIX-9999", action: "skip", reason: "user_not_found" });
    expect(res.body.errors[0]).toContain("DIX-9999");
    // nothing is persisted during a preview
    expect(db.package.create).not.toHaveBeenCalled();
  });

  it("skips a track that already belongs to another client", async () => {
    const db = fakeDb({
      user: { findUnique: vi.fn().mockResolvedValue({ id: 2, client_code: "DIX-0002", full_name: "B" }) },
      package: {
        findFirst: vi.fn().mockResolvedValue({
          id: 1, track_code: "TRACK1", status: "IN_TRANSIT",
          user: { id: 1, client_code: "DIX-0001", full_name: "A", deleted_at: null },
        }),
      },
    });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent
      .post("/api/admin/packages/import")
      .attach("file", xlsxBuffer([["", "", "DIX-0002", "TRACK1"]]), "import.xlsx");
    expect(res.body.imported).toBe(0);
    expect(res.body.items[0]).toMatchObject({ action: "skip", reason: "duplicate" });
    expect(db.package.create).not.toHaveBeenCalled();
  });

  it("does not import packages for a client in the trash", async () => {
    const db = fakeDb({
      user: { findUnique: vi.fn().mockResolvedValue({ id: 2, client_code: "DIX-0002", deleted_at: new Date() }) },
    });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent
      .post("/api/admin/packages/import")
      .attach("file", xlsxBuffer([["", "", "DIX-0002", "TRACK1"]]), "import.xlsx");
    expect(res.body.imported).toBe(0);
    expect(res.body.items[0]).toMatchObject({ action: "skip", reason: "user_not_found" });
  });

  it("skips a duplicate track that repeats within the same file", async () => {
    const db = fakeDb({
      user: { findUnique: vi.fn().mockResolvedValue({ id: 1, client_code: "DIX-0001", full_name: "A" }) },
      package: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    getPrismaMock.mockReturnValue(db);

    const rows = [
      ["", "", "DIX-0001", "TRACK1"],
      ["", "", "DIX-0001", "TRACK1"], // same client + track -> only imported once
    ];

    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent
      .post("/api/admin/packages/import")
      .attach("file", xlsxBuffer(rows), "import.xlsx");

    expect(res.body.imported).toBe(1);
    expect(res.body.skipped).toBe(1);
    expect(res.body.items[1]).toMatchObject({ action: "skip", reason: "duplicate" });
    expect(db.package.create).toHaveBeenCalledTimes(1);
  });

  it("reads the client code by its DISPLAYED text (custom number format \"DIX-\"0000)", async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 7, client_code: "DIX-0114" });
    const db = fakeDb({ user: { findUnique }, package: { findFirst: vi.fn().mockResolvedValue(null) } });
    getPrismaMock.mockReturnValue(db);

    // Ячейка кода — число 114 с форматом "DIX-"0000: в Excel показывается как "DIX-0114".
    const ws = XLSX.utils.aoa_to_sheet([["", "", 114, "TRACK1"]]);
    ws["C1"].z = '"DIX-"0000';
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.post("/api/admin/packages/import").attach("file", buf, "import.xlsx");

    // код взят из отображаемого текста, а не из сырого числа 114
    expect(findUnique).toHaveBeenCalledWith({ where: { client_code: "DIX-0114" } });
    expect(res.body.imported).toBe(1);
    expect(db.package.create).toHaveBeenCalledTimes(1);
  });
});

// ── Промокоды ────────────────────────────────────────────────────────────────

describe("promocodes routes", () => {
  it("GET /promocodes lists promos", async () => {
    const db = fakeDb({ promoCode: { findMany: vi.fn().mockResolvedValue([{ id: 1, code: "X" }]) } });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.get("/api/admin/promocodes");
    expect(res.body.promos).toHaveLength(1);
  });

  it("POST /promocodes trims code/description", async () => {
    const db = fakeDb({ promoCode: { create: vi.fn().mockResolvedValue({ id: 1, code: "X" }) } });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    await agent.post("/api/admin/promocodes").send({ code: " X ", description: "  " });
    expect(db.promoCode.create).toHaveBeenCalledWith({ data: { code: "X", description: null } });
  });

  it("DELETE /promocodes/:id deletes", async () => {
    const db = fakeDb();
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.delete("/api/admin/promocodes/1");
    expect(res.body).toEqual({ ok: true });
  });
});

// ── Настройки ────────────────────────────────────────────────────────────────

describe("settings routes", () => {
  it("GET /settings returns the backup alert chat id from the default branch", async () => {
    const db = fakeDb({
      setting: {
        findUnique: vi.fn(async ({ where }: any) =>
          where.key === "backup_alert_chat_id" ? { key: "backup_alert_chat_id", value: "434413828" } : null),
      },
    });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.get("/api/admin/settings");
    expect(res.body.backupAlertChatId).toBe("434413828");
    expect(getPrismaMock).toHaveBeenCalledWith("bishkek");
  });

  it("PUT /settings saves the backup alert chat id in the default branch whatever branch is selected", async () => {
    const bishkek = fakeDb();
    const kant = fakeDb();
    getPrismaMock.mockImplementation((branch) => (branch === "kant" ? kant : bishkek));
    const app = buildApp();
    const agent = await loginAgent(app);
    await agent.post("/api/admin/branch").send({ branch: "kant" });
    const res = await agent.put("/api/admin/settings").send({ backup_alert_chat_id: " -1001234567890 " });

    expect(res.body).toEqual({ ok: true });
    expect(bishkek.setting.upsert).toHaveBeenCalledWith({
      where: { key: "backup_alert_chat_id" },
      update: { value: "-1001234567890" },
      create: { key: "backup_alert_chat_id", value: "-1001234567890" },
    });
    expect(kant.setting.upsert).not.toHaveBeenCalledWith(expect.objectContaining({ where: { key: "backup_alert_chat_id" } }));
  });

  it("PUT /settings clears the backup alert chat id when it is empty", async () => {
    const db = fakeDb();
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    await agent.put("/api/admin/settings").send({ backup_alert_chat_id: "" });
    expect(db.setting.deleteMany).toHaveBeenCalledWith({ where: { key: "backup_alert_chat_id" } });
  });

  it("PUT /settings rejects a malformed chat id without saving anything", async () => {
    const db = fakeDb();
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.put("/api/admin/settings").send({ tariff_per_kg: "150", backup_alert_chat_id: "@dix_admin" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_chat_id");
    expect(db.setting.upsert).not.toHaveBeenCalled();
  });

  it("POST /settings/test-alert sends a test message to the chat", async () => {
    const bot = fakeBot();
    const app = buildApp(bot);
    const agent = await loginAgent(app);
    const res = await agent.post("/api/admin/settings/test-alert").send({ chat_id: "434413828" });
    expect(res.body).toEqual({ ok: true });
    expect(bot.api.sendMessage).toHaveBeenCalledWith(434413828, expect.stringContaining("Тестовое уведомление"));
  });

  it("POST /settings/test-alert reports Telegram errors", async () => {
    const bot = fakeBot();
    (bot.api.sendMessage as any).mockRejectedValue({ description: "Bad Request: chat not found" });
    const app = buildApp(bot);
    const agent = await loginAgent(app);
    const res = await agent.post("/api/admin/settings/test-alert").send({ chat_id: "1" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "send_failed", description: "Bad Request: chat not found" });
  });

  it("POST /settings/test-alert rejects a malformed chat id", async () => {
    const bot = fakeBot();
    const app = buildApp(bot);
    const agent = await loginAgent(app);
    const res = await agent.post("/api/admin/settings/test-alert").send({ chat_id: "abc" });
    expect(res.status).toBe(400);
    expect(bot.api.sendMessage).not.toHaveBeenCalled();
  });

  it("GET /settings returns a key/value map and default managers when none are saved", async () => {
    const db = fakeDb({
      setting: {
        findMany: vi.fn().mockResolvedValue([{ key: "tariff_per_kg", value: "100" }]),
        findUnique: vi.fn().mockResolvedValue(null),
      },
    });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.get("/api/admin/settings");
    expect(res.body.settings.tariff_per_kg).toBe("100");
    expect(res.body.settings.support_text).toContain("Поддержка");
    expect(res.body.managers).toEqual([
      { name: "Лидия", url: "https://wa.me/996550867414" },
      { name: "Виктория", url: "https://wa.me/996556969906" },
    ]);
  });

  it("GET /settings returns managers stored as JSON, including more than two", async () => {
    const managers = [
      { name: "Аня", url: "https://wa.me/1" },
      { name: "Боря", url: "https://wa.me/2" },
      { name: "Вика", url: "https://wa.me/3" },
    ];
    const db = fakeDb({
      setting: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue({ key: "manager_buttons", value: JSON.stringify(managers) }),
      },
    });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.get("/api/admin/settings");
    expect(res.body.managers).toEqual(managers);
  });

  it("PUT /settings upserts only known keys", async () => {
    const db = fakeDb();
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    await agent.put("/api/admin/settings").send({ tariff_per_kg: "150", unknown_key: "x" });
    expect(db.setting.upsert).toHaveBeenCalledTimes(1);
    expect(db.setting.upsert).toHaveBeenCalledWith({
      where: { key: "tariff_per_kg" }, update: { value: "150" }, create: { key: "tariff_per_kg", value: "150" },
    });
  });

  it("GET /settings returns the saved support text instead of the default", async () => {
    const db = fakeDb({
      setting: {
        findMany: vi.fn().mockResolvedValue([{ key: "support_text", value: "Наш новый текст" }]),
        findUnique: vi.fn().mockResolvedValue(null),
      },
    });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.get("/api/admin/settings");
    expect(res.body.settings.support_text).toBe("Наш новый текст");
  });

  it("GET /settings falls back to the default addresses text and returns the saved one when present", async () => {
    const db = fakeDb({
      setting: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
      },
    });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.get("/api/admin/settings");
    expect(res.body.settings.addresses_text).toContain("Айбек-Ата");

    db.setting.findMany = vi.fn().mockResolvedValue([{ key: "addresses_text", value: "Наши новые адреса" }]);
    const res2 = await agent.get("/api/admin/settings");
    expect(res2.body.settings.addresses_text).toBe("Наши новые адреса");
  });

  it("PUT /settings upserts the addresses text", async () => {
    const db = fakeDb();
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    await agent.put("/api/admin/settings").send({ addresses_text: "📍 <b>Наши адреса</b>" });
    expect(db.setting.upsert).toHaveBeenCalledWith({
      where: { key: "addresses_text" },
      update: { value: "📍 <b>Наши адреса</b>" },
      create: { key: "addresses_text", value: "📍 <b>Наши адреса</b>" },
    });
  });

  it("PUT /settings saves the tariff sent as a number by the numeric input", async () => {
    const db = fakeDb();
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    await agent.put("/api/admin/settings").send({ tariff_per_kg: 150.5 });
    expect(db.setting.upsert).toHaveBeenCalledWith({
      where: { key: "tariff_per_kg" },
      update: { value: "150.5" },
      create: { key: "tariff_per_kg", value: "150.5" },
    });
  });

  it("PUT /settings upserts the support text", async () => {
    const db = fakeDb();
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    await agent.put("/api/admin/settings").send({ support_text: "💬 <b>Поддержка</b>" });
    expect(db.setting.upsert).toHaveBeenCalledWith({
      where: { key: "support_text" },
      update: { value: "💬 <b>Поддержка</b>" },
      create: { key: "support_text", value: "💬 <b>Поддержка</b>" },
    });
  });

  it("PUT /settings stores an arbitrary number of manager buttons as JSON", async () => {
    const db = fakeDb();
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const managers = [
      { name: "Аня", url: "https://wa.me/1" },
      { name: "Боря", url: "https://wa.me/2" },
      { name: "Вика", url: "https://wa.me/3" },
      { name: "  ", url: "https://wa.me/4" },
    ];
    await agent.put("/api/admin/settings").send({ managers });
    expect(db.setting.upsert).toHaveBeenCalledWith({
      where: { key: "manager_buttons" },
      update: { value: JSON.stringify(managers.slice(0, 3)) },
      create: { key: "manager_buttons", value: JSON.stringify(managers.slice(0, 3)) },
    });
  });
});

describe("GET /db-dump", () => {
  it("returns 500 when the branch has no database configured", async () => {
    getDatabaseUrlMock.mockReturnValue(undefined);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.get("/api/admin/db-dump");
    expect(res.status).toBe(500);
  });

  it("streams the pg_dump output on success", async () => {
    getDatabaseUrlMock.mockReturnValue("postgresql://user:pass@localhost:5432/db");
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const child = Object.assign(new EventEmitter(), { stdout, stderr });
    vi.mocked(spawn).mockImplementation(() => {
      // Deferred so the route handler finishes attaching its .on() listeners first
      queueMicrotask(() => {
        stdout.emit("data", Buffer.from("SQL DUMP"));
        child.emit("close", 0);
      });
      return child as any;
    });

    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.get("/api/admin/db-dump");

    expect(res.status).toBe(200);
    expect(res.text).toBe("SQL DUMP");
  });

  it("returns 500 when pg_dump exits non-zero", async () => {
    getDatabaseUrlMock.mockReturnValue("postgresql://user:pass@localhost:5432/db");
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const child = Object.assign(new EventEmitter(), { stdout, stderr });
    vi.mocked(spawn).mockImplementation(() => {
      queueMicrotask(() => {
        stderr.emit("data", Buffer.from("boom"));
        child.emit("close", 1);
      });
      return child as any;
    });

    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.get("/api/admin/db-dump");

    expect(res.status).toBe(500);
  });

  it("returns 500 when spawning pg_dump fails outright", async () => {
    getDatabaseUrlMock.mockReturnValue("postgresql://user:pass@localhost:5432/db");
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const child = Object.assign(new EventEmitter(), { stdout, stderr });
    vi.mocked(spawn).mockImplementation(() => {
      queueMicrotask(() => child.emit("error", new Error("ENOENT")));
      return child as any;
    });

    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.get("/api/admin/db-dump");

    expect(res.status).toBe(500);
    expect(res.text).toContain("Не удалось запустить pg_dump");
  });
});

// ── Маркетплейсы ─────────────────────────────────────────────────────────────

describe("marketplaces routes", () => {
  it("GET /marketplaces returns default texts when no settings are saved", async () => {
    const db = fakeDb();
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.get("/api/admin/marketplaces");
    expect(res.body.sections).toHaveLength(4);
    expect(res.body.sections[0].value).toContain("{code}");
  });

  it("GET /marketplaces reports an upload found via the branch prefix", async () => {
    vi.mocked(fs.readdirSync).mockReturnValue(["bishkek_pinduoduo_photo.jpg"] as any);
    const db = fakeDb();
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.get("/api/admin/marketplaces");
    const pinduoduo = res.body.sections.find((s: any) => s.key === "marketplace_pinduoduo");
    expect(pinduoduo.hasPhoto).toBe(true);
    expect(pinduoduo.hasVideo).toBe(false);
  });

  it("GET /marketplaces reports a legacy (unprefixed) upload for the default branch", async () => {
    vi.mocked(fs.readdirSync).mockReturnValue(["pinduoduo_photo.jpg"] as any);
    const db = fakeDb();
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.get("/api/admin/marketplaces");
    const pinduoduo = res.body.sections.find((s: any) => s.key === "marketplace_pinduoduo");
    expect(pinduoduo.hasPhoto).toBe(true);
  });

  it("POST /marketplaces upserts text fields", async () => {
    const db = fakeDb();
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.post("/api/admin/marketplaces").send({ marketplace_pinduoduo: "new text" });
    expect(res.body).toEqual({ ok: true });
    expect(db.setting.upsert).toHaveBeenCalledWith({
      where: { key: "marketplace_pinduoduo" },
      update: { value: "new text" },
      create: { key: "marketplace_pinduoduo", value: "new text" },
    });
  });

});

// ── Рассылка ─────────────────────────────────────────────────────────────────

describe("broadcast routes", () => {
  it("GET /broadcast/audience returns the count of real bot users", async () => {
    const db = fakeDb({ user: { count: vi.fn().mockResolvedValue(7) } });
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.get("/api/admin/broadcast/audience");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 7 });
    expect(db.user.count).toHaveBeenCalledWith({ where: { deleted_at: null, telegram_id: { gt: 0 } } });
  });

  it("POST /broadcast rejects an empty message with no files", async () => {
    const db = fakeDb();
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.post("/api/admin/broadcast").field("text", "   ");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("empty");
  });

  it("POST /broadcast sanitizes the text and sends it to every real user", async () => {
    const db = fakeDb({
      user: {
        findMany: vi.fn().mockResolvedValue([{ telegram_id: 111n }, { telegram_id: 222n }]),
        count: vi.fn().mockResolvedValue(2),
      },
    });
    getPrismaMock.mockReturnValue(db);
    const bot = fakeBot();
    const app = buildApp(bot);
    const agent = await loginAgent(app);

    const res = await agent.post("/api/admin/broadcast").field("text", "<div>hello</div><b>x</b>");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ total: 2, sent: 2, failed: 0 });
    expect(bot.api.sendMessage).toHaveBeenCalledTimes(2);
    expect(bot.api.sendMessage).toHaveBeenCalledWith(111, "hello<b>x</b>", { parse_mode: "HTML" });
  });

  it("POST /broadcast requires authentication", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/admin/broadcast").field("text", "hi");
    expect(res.status).toBe(401);
  });
});
