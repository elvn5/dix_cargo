import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient, User } from "@prisma/client";

vi.mock("../database/prismaClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../database/prismaClient")>();
  return { ...actual, getPrisma: vi.fn() };
});

import { userService } from "./userService";
import { getPrisma } from "../database/prismaClient";

function fakeDb(overrides: Partial<{
  findMany: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
}> = {}) {
  return {
    user: {
      findMany: overrides.findMany ?? vi.fn().mockResolvedValue([]),
      findUnique: overrides.findUnique ?? vi.fn().mockResolvedValue(null),
      findFirst: overrides.findFirst ?? vi.fn().mockResolvedValue(null),
      create: overrides.create ?? vi.fn(),
    },
  } as unknown as PrismaClient;
}

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    telegram_id: 1n,
    phone: "500100500",
    full_name: "Тест Тестов",
    client_code: "DIX-0001",
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  } as User;
}

describe("userService.generateClientCode", () => {
  it("returns DIX-0001 for an empty Бишкек branch", async () => {
    const db = fakeDb();
    const code = await userService.generateClientCode(db, "bishkek");
    expect(code).toBe("DIX-0001");
  });

  it("uses the DIX2 prefix for Кант", async () => {
    const db = fakeDb();
    const code = await userService.generateClientCode(db, "kant");
    expect(code).toBe("DIX2-0001");
  });

  it("skips numbers already taken", async () => {
    const db = fakeDb({ findMany: vi.fn().mockResolvedValue([{ client_code: "DIX-0001" }]) });
    const code = await userService.generateClientCode(db, "bishkek");
    expect(code).toBe("DIX-0002");
  });

  it("skips excluded (superstition) numbers", async () => {
    const taken = Array.from({ length: 2221 }, (_, i) => ({ client_code: `DIX-${String(i + 1).padStart(4, "0")}` }));
    const db = fakeDb({ findMany: vi.fn().mockResolvedValue(taken) });
    // 1..2221 taken, 2222 is excluded, so the next free number is 2223
    const code = await userService.generateClientCode(db, "bishkek");
    expect(code).toBe("DIX-2223");
  });
});

describe("userService.generateUniqueClientCode", () => {
  it("returns the first generated code when it's free", async () => {
    const db = fakeDb();
    const code = await userService.generateUniqueClientCode(db, "bishkek");
    expect(code).toBe("DIX-0001");
  });

  it("retries when the generated code collides with an existing user", async () => {
    const findUnique = vi.fn()
      .mockResolvedValueOnce(fakeUser()) // first attempt: taken
      .mockResolvedValueOnce(null);       // second attempt: free
    const db = fakeDb({ findUnique });
    const code = await userService.generateUniqueClientCode(db, "bishkek");
    expect(code).toBe("DIX-0001");
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it("throws after 10 failed attempts", async () => {
    const db = fakeDb({ findUnique: vi.fn().mockResolvedValue(fakeUser()) });
    await expect(userService.generateUniqueClientCode(db, "bishkek")).rejects.toThrow(
      "Failed to generate unique client code after 10 attempts"
    );
  });
});

describe("userService.findUserByTelegramId", () => {
  it("queries by telegram_id", async () => {
    const user = fakeUser();
    const findUnique = vi.fn().mockResolvedValue(user);
    const db = fakeDb({ findUnique });
    const result = await userService.findUserByTelegramId(db, 123n);
    expect(findUnique).toHaveBeenCalledWith({ where: { telegram_id: 123n } });
    expect(result).toBe(user);
  });
});

describe("userService.findUserByPhone", () => {
  it("queries by phone", async () => {
    const user = fakeUser();
    const findFirst = vi.fn().mockResolvedValue(user);
    const db = fakeDb({ findFirst });
    const result = await userService.findUserByPhone(db, "500100500");
    expect(findFirst).toHaveBeenCalledWith({ where: { phone: "500100500" } });
    expect(result).toBe(user);
  });
});

describe("userService.createUser", () => {
  it("generates a client code and creates the user", async () => {
    const created = fakeUser();
    const create = vi.fn().mockResolvedValue(created);
    const db = fakeDb({ create });

    const result = await userService.createUser(db, "bishkek", 999n, "500100500", "Иван Иванов");

    expect(create).toHaveBeenCalledWith({
      data: { telegram_id: 999n, phone: "500100500", full_name: "Иван Иванов", client_code: "DIX-0001" },
    });
    expect(result).toBe(created);
  });
});

describe("userService.findUserAnyBranch", () => {
  const getPrismaMock = vi.mocked(getPrisma);

  beforeEach(() => {
    getPrismaMock.mockReset();
  });

  it("returns null when the user isn't registered anywhere", async () => {
    getPrismaMock.mockImplementation(() => fakeDb());
    const result = await userService.findUserAnyBranch(1n);
    expect(result).toBeNull();
  });

  it("finds the user in the Бишкек branch", async () => {
    const user = fakeUser();
    getPrismaMock.mockImplementation((branch) =>
      branch === "bishkek" ? fakeDb({ findUnique: vi.fn().mockResolvedValue(user) }) : fakeDb()
    );
    const result = await userService.findUserAnyBranch(1n);
    expect(result).toEqual({ user, branch: "bishkek" });
  });

  it("finds the user in the Кант branch", async () => {
    const user = fakeUser();
    getPrismaMock.mockImplementation((branch) =>
      branch === "kant" ? fakeDb({ findUnique: vi.fn().mockResolvedValue(user) }) : fakeDb()
    );
    const result = await userService.findUserAnyBranch(1n);
    expect(result).toEqual({ user, branch: "kant" });
  });
});
