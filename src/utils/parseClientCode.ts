function buildDixRegex(prefix: string): RegExp {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Требуем префикс филиала: "<PREFIX>2222", "<PREFIX>-2222", "<PREFIX> 2222" (регистр не важен).
  // Голые числа и код чужого филиала не распознаются — так посылки не утекают между филиалами.
  return new RegExp(`^${escaped}[-\\s]?(\\d{1,6})$`, "i");
}

/**
 * Parses a raw cell value from the Excel import and normalises it to "<PREFIX>-XXXX".
 * `prefix` selects the branch's code prefix (e.g. "DIX" for Бишкек, "KADIX" for Кант).
 * The prefix is REQUIRED: a value must carry the branch prefix to be accepted, so a
 * code of another branch (e.g. "DIX-2222" in Кант) and a bare number are rejected.
 * Returns null if the value doesn't look like a client code for this branch.
 */
export function parseClientCode(raw: unknown, prefix: string = "DIX"): string | null {
  const s = String(raw ?? "").trim();
  const m = buildDixRegex(prefix).exec(s);
  if (!m) return null;
  return `${prefix}-${m[1].padStart(4, "0")}`;
}
