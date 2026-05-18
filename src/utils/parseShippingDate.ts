/**
 * Extracts a shipping date from a Chinese-format filename.
 *
 * Supported patterns (year optional):
 *   "5月17号 八DIX发货表格.xlsx"        → current-year May 17
 *   "4月18号 B0000发货表格.xlsx"         → current-year Apr 18
 *   "B0000  5月12号发货表格.xlsx"        → current-year May 12
 *   "2026年5月17号 DIX发货表格.xlsx"     → 2026 May 17
 *
 * Returns today's date when no date pattern is found.
 */
export function parseShippingDate(filename: string, now = new Date()): Date {
  // Optional year: (YYYY年)?  then month: (M+月)  then day: (D+号)
  const m = filename.match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})号/);
  if (!m) return new Date(now);

  const year  = m[1] ? parseInt(m[1], 10) : now.getFullYear();
  const month = parseInt(m[2], 10) - 1; // 0-based
  const day   = parseInt(m[3], 10);

  return new Date(year, month, day);
}
