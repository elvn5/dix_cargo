import { describe, it, expect, vi } from "vitest";
import type { AccessResetRequest, PrismaClient } from "@prisma/client";
import { resetRequestService } from "./resetRequestService";

function fakeDb(overrides: Partial<{
  findFirst: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}> = {}) {
  return {
    accessResetRequest: {
      findFirst: overrides.findFirst ?? vi.fn().mockResolvedValue(null),
      create: overrides.create ?? vi.fn(),
      update: overrides.update ?? vi.fn(),
    },
  } as unknown as PrismaClient;
}

function fakeRequest(overrides: Partial<AccessResetRequest> = {}): AccessResetRequest {
  return {
    id: 1,
    user_id: 42,
    requested_telegram_id: 100n,
    status: "PENDING",
    created_at: new Date(),
    resolved_at: null,
    ...overrides,
  } as AccessResetRequest;
}

describe("resetRequestService.findPending", () => {
  it("looks up a pending request for the user", async () => {
    const findFirst = vi.fn().mockResolvedValue(fakeRequest());
    const db = fakeDb({ findFirst });
    const result = await resetRequestService.findPending(db, 42);
    expect(findFirst).toHaveBeenCalledWith({ where: { user_id: 42, status: "PENDING" } });
    expect(result).not.toBeNull();
  });
});

describe("resetRequestService.createOrUpdate", () => {
  it("creates a new request when none is pending", async () => {
    const create = vi.fn().mockResolvedValue(fakeRequest());
    const db = fakeDb({ findFirst: vi.fn().mockResolvedValue(null), create });

    const result = await resetRequestService.createOrUpdate(db, 42, 555n);

    expect(create).toHaveBeenCalledWith({ data: { user_id: 42, requested_telegram_id: 555n } });
    expect(result.user_id).toBe(42);
  });

  it("updates the existing pending request instead of creating a duplicate", async () => {
    const pending = fakeRequest({ id: 7, requested_telegram_id: 111n });
    const update = vi.fn().mockResolvedValue({ ...pending, requested_telegram_id: 999n });
    const create = vi.fn();
    const db = fakeDb({ findFirst: vi.fn().mockResolvedValue(pending), create, update });

    const result = await resetRequestService.createOrUpdate(db, 42, 999n);

    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ where: { id: 7 }, data: { requested_telegram_id: 999n } });
    expect(result.requested_telegram_id).toBe(999n);
  });
});
