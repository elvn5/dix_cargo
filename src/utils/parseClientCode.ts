function buildDixRegex(prefix: string): RegExp {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Matches: "2222", "<PREFIX>2222", "<PREFIX>-2222", "<PREFIX> 2222" (case-insensitive)
  return new RegExp(`^(?:${escaped}[-\\s]?)?(\\d{1,6})$`, "i");
}

/**
 * Parses a raw cell value from the Excel import and normalises it to "<PREFIX>-XXXX".
 * `prefix` selects the branch's code prefix (e.g. "DIX" for Бишкек, "KADIX" for Кант)
 * used to resolve a bare number (e.g. "2222") that carries no explicit prefix.
 * Returns null if the value doesn't look like a client code.
 */
export function parseClientCode(raw: unknown, prefix: string = "DIX"): string | null {
  const s = String(raw ?? "").trim();
  const m = buildDixRegex(prefix).exec(s);
  if (!m) return null;
  return `${prefix}-${m[1].padStart(4, "0")}`;
}
