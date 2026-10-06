import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { logger } from "./logger";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.LOG_DIR;
});

describe("logger", () => {
  it("writes one JSON line per event to stdout, serializing bigint", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("user.create", { user_id: 1, telegram_id: 123n });

    const entry = JSON.parse(log.mock.calls[0][0] as string);
    expect(entry).toMatchObject({ level: "info", event: "user.create", user_id: 1, telegram_id: "123" });
    expect(new Date(entry.ts).toString()).not.toBe("Invalid Date");
  });

  it("sends errors to stderr with the message and stack", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("registration.failed", { error: new Error("db down") });

    const entry = JSON.parse(err.mock.calls[0][0] as string);
    expect(entry.level).toBe("error");
    expect(entry.error.message).toBe("db down");
    expect(entry.error.stack).toContain("db down");
  });

  it("appends to a daily file in LOG_DIR so logs survive container re-creation", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dix-logs-"));
    process.env.LOG_DIR = dir;

    logger.info("a");
    logger.warn("b", { x: 1 });

    const file = path.join(dir, `audit-${new Date().toISOString().slice(0, 10)}.log`);
    const lines = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.event)).toEqual(["a", "b"]);
    expect(lines[1]).toMatchObject({ level: "warn", x: 1 });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("keeps working when the log file cannot be written", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(fs, "appendFileSync").mockImplementation(() => { throw new Error("disk full"); });
    process.env.LOG_DIR = os.tmpdir();

    expect(() => logger.info("a")).not.toThrow();
    expect(err).toHaveBeenCalledWith(expect.stringContaining("Не удалось записать"), expect.any(Error));
  });
});
