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
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn().mockResolvedValue({}),
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
    },
    setting: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn(),
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
      package: { count: vi.fn().mockResolvedValue(5) },
    });
    getPrismaMock.mockReturnValue(db);

    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.get("/api/admin/dashboard");

    expect(res.status).toBe(200);
    expect(res.body.totalUsers).toBe(2);
    expect(res.body.totalPackages).toBe(5);
    expect(res.body.latestUsers[0].telegram_id).toBe("42");
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

  it("DELETE /users/:id deletes and confirms", async () => {
    const db = fakeDb();
    getPrismaMock.mockReturnValue(db);
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent.delete("/api/admin/users/1");
    expect(res.body).toEqual({ ok: true });
    expect(db.user.delete).toHaveBeenCalledWith({ where: { id: 1 } });
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
      data: { status: "IN_OFFICE", weight: 2.5, price: 375 },
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
      data: { status: "IN_OFFICE", weight: 2.5, price: 375 },
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
      data: { status: "IN_OFFICE", weight: 2, price: 100 },
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
      data: { status: "IN_OFFICE", weight: 2 },
    });
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
