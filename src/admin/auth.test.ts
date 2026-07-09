import { describe, it, expect, vi, afterEach } from "vitest";
import type { Request, Response } from "express";
import { getBranch, requireApiAuth } from "./auth";

function fakeReq(session: Record<string, unknown> = {}): Request {
  return { session } as unknown as Request;
}

function fakeRes() {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

describe("getBranch", () => {
  it("returns the session's branch when set", () => {
    expect(getBranch(fakeReq({ branch: "kant" }))).toBe("kant");
  });

  it("defaults to bishkek when no branch is set", () => {
    expect(getBranch(fakeReq({}))).toBe("bishkek");
  });
});

describe("requireApiAuth", () => {
  it("calls next() when the session is authenticated", () => {
    const req = fakeReq({ admin: true });
    const res = fakeRes();
    const next = vi.fn();

    requireApiAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds with 401 when the session isn't authenticated", () => {
    const req = fakeReq({});
    const res = fakeRes();
    const next = vi.fn();

    requireApiAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "unauthorized" });
  });
});

describe("env-configured constants", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it("uses environment overrides when set, instead of the defaults", async () => {
    vi.resetModules();
    process.env.ADMIN_EMAIL = "custom@example.com";
    process.env.ADMIN_PASSWORD = "custom-pass";
    process.env.ADMIN_COOKIE_SECRET = "custom-secret";
    process.env.ADMIN_PORT = "4321";

    const mod = await import("./auth");
    expect(mod.ADMIN_EMAIL).toBe("custom@example.com");
    expect(mod.ADMIN_PASSWORD).toBe("custom-pass");
    expect(mod.COOKIE_SECRET).toBe("custom-secret");
    expect(mod.PORT).toBe(4321);
  });
});
