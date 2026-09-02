function buildDixRegex(prefix: string): RegExp {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Голое число ("2222") — «свой» клиент филиала, ему подставляется префикс филиала.
  // Явный префикс срабатывает только для ЭТОГО филиала: код чужого филиала
  // ("KADIX-2222" при импорте в Бишкек) под якорный regex не подходит и отсекается.
  return new RegExp(`^(?:${escaped}[-\\s]?)?(\\d{1,6})$`, "i");
}

/**
 * Parses a raw cell value from the Excel import and normalises it to "<PREFIX>-XXXX".
 * `prefix` selects the branch's code prefix (e.g. "DIX" for Бишкек, "KADIX" for Кант).
 * A bare number (e.g. "2222") is treated as a client of THIS branch and gets the branch
 * prefix. An explicit prefix is accepted only when it matches this branch, so a code of
 * another branch (e.g. "KADIX-2222" imported into Бишкек) is rejected.
 * Returns null if the value doesn't look like a client code for this branch.
 */
export function parseClientCode(raw: unknown, prefix: string = "DIX"): string | null {
  const s = String(raw ?? "").trim();
  const m = buildDixRegex(prefix).exec(s);
  if (!m) return null;
  return `${prefix}-${m[1].padStart(4, "0")}`;
}
