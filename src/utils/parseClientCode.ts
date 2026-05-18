// Matches: "2222", "DIX2222", "DIX-2222", "DIX 2222" (case-insensitive)
const DIX_RE = /^(?:DIX[-\s]?)?(\d{1,6})$/i;

/**
 * Parses a raw cell value from the Excel import and normalises it to "DIX-XXXX".
 * Returns null if the value doesn't look like a client code.
 */
export function parseClientCode(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  const m = DIX_RE.exec(s);
  if (!m) return null;
  return `DIX-${m[1].padStart(4, "0")}`;
}
