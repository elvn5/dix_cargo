import { describe, it, expect, afterEach, vi } from "vitest";
import { isBranch, branchLabel, clientCodePrefix, BRANCHES, DEFAULT_BRANCH } from "./prismaClient";

describe("BRANCHES / DEFAULT_BRANCH", () => {
  it("lists both branches with Russian labels", () => {
    expect(BRANCHES).toEqual([
      { key: "bishkek", label: "г. Бишкек" },
      { key: "kant", label: "г. Кант" },
    ]);
  });

  it("defaults to bishkek", () => {
    expect(DEFAULT_BRANCH).toBe("bishkek");
  });
});

describe("isBranch", () => {
  it("accepts known branch keys", () => {
    expect(isBranch("bishkek")).toBe(true);
    expect(isBranch("kant")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isBranch("osh")).toBe(false);
    expect(isBranch(undefined)).toBe(false);
    expect(isBranch(null)).toBe(false);
    expect(isBranch("")).toBe(false);
  });
});

describe("branchLabel", () => {
  it("returns the Russian label for each branch", () => {
    expect(branchLabel("bishkek")).toBe("г. Бишкек");
    expect(branchLabel("kant")).toBe("г. Кант");
  });
});

describe("clientCodePrefix", () => {
  it("returns DIX for bishkek and DIX2 for kant", () => {
    expect(clientCodePrefix("bishkek")).toBe("DIX");
    expect(clientCodePrefix("kant")).toBe("DIX2");
  });
});

describe("getDatabaseUrl / getPrisma", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it("getDatabaseUrl reads the per-branch env var", async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/bishkek";
    process.env.DATABASE_URL_KANT = "postgresql://user:pass@localhost:5433/kant";
    const { getDatabaseUrl } = await import("./prismaClient");
    expect(getDatabaseUrl("bishkek")).toBe("postgresql://user:pass@localhost:5432/bishkek");
    expect(getDatabaseUrl("kant")).toBe("postgresql://user:pass@localhost:5433/kant");
  });

  it("getDatabaseUrl returns undefined when the env var isn't set", async () => {
    vi.resetModules();
    delete process.env.DATABASE_URL_KANT;
    const { getDatabaseUrl } = await import("./prismaClient");
    expect(getDatabaseUrl("kant")).toBeUndefined();
  });

  it("getPrisma throws a descriptive error when the branch's env var is missing", async () => {
    vi.resetModules();
    delete process.env.DATABASE_URL_KANT;
    const { getPrisma } = await import("./prismaClient");
    expect(() => getPrisma("kant")).toThrow(/DATABASE_URL_KANT/);
  });

  it("getPrisma caches a single client instance per branch", async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/bishkek";
    const { getPrisma } = await import("./prismaClient");
    const first = getPrisma("bishkek");
    const second = getPrisma("bishkek");
    expect(first).toBe(second);
  });

  it("getPrisma defaults to the bishkek branch", async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/bishkek";
    const { getPrisma } = await import("./prismaClient");
    expect(getPrisma()).toBe(getPrisma("bishkek"));
  });
});
