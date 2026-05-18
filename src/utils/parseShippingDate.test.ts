import { describe, it, expect } from "vitest";
import { parseShippingDate } from "./parseShippingDate";

const NOW = new Date(2026, 4, 20); // 2026-05-20 (fixed reference date)

describe("parseShippingDate", () => {
  it("date at the start of filename", () => {
    const d = parseShippingDate("5月17号 八DIX发货表格....xlsx", NOW);
    expect(d).toEqual(new Date(2026, 4, 17));
  });

  it("date in the middle of filename", () => {
    const d = parseShippingDate("B0000  5月12号发货表格....xlsx", NOW);
    expect(d).toEqual(new Date(2026, 4, 12));
  });

  it("different month", () => {
    const d = parseShippingDate("4月18号 B0000发货表格.xlsx", NOW);
    expect(d).toEqual(new Date(2026, 3, 18));
  });

  it("explicit year in filename", () => {
    const d = parseShippingDate("2025年12月31号 DIX发货表格.xlsx", NOW);
    expect(d).toEqual(new Date(2025, 11, 31));
  });

  it("falls back to today when no date found", () => {
    const d = parseShippingDate("123123.xlsx", NOW);
    expect(d).toEqual(new Date(NOW));
  });

  it("single-digit month and day", () => {
    const d = parseShippingDate("1月3号 发货表格.xlsx", NOW);
    expect(d).toEqual(new Date(2026, 0, 3));
  });
});
