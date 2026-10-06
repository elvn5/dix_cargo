import fs from "fs";
import path from "path";

/**
 * Журнал действий: одна JSON-строка на событие.
 *
 * Пишется в stdout (виден в `docker logs`) и, если задан LOG_DIR, дублируется
 * в файл LOG_DIR/audit-YYYY-MM-DD.log. Файл лежит в docker-томе и переживает
 * пересоздание контейнера при деплое — в отличие от `docker logs`.
 */

type Fields = Record<string, unknown>;
type Level = "info" | "warn" | "error";

function serialize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) return { message: value.message, stack: value.stack };
  return value;
}

function toLine(level: Level, event: string, fields: Fields): string {
  return JSON.stringify(
    { ts: new Date().toISOString(), level, event, ...fields },
    (_key, value) => serialize(value),
  );
}

function writeToFile(line: string): void {
  const dir = process.env.LOG_DIR;
  if (!dir) return;
  const file = path.join(dir, `audit-${new Date().toISOString().slice(0, 10)}.log`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(file, line + "\n");
  } catch (err) {
    // Журнал не должен ронять приложение — сообщаем в stderr и продолжаем
    console.error("[logger] Не удалось записать в файл журнала:", err);
  }
}

function write(level: Level, event: string, fields: Fields = {}): void {
  const line = toLine(level, event, fields);
  if (level === "error") console.error(line);
  else console.log(line);
  writeToFile(line);
}

export const logger = {
  info: (event: string, fields?: Fields) => write("info", event, fields),
  warn: (event: string, fields?: Fields) => write("warn", event, fields),
  error: (event: string, fields?: Fields) => write("error", event, fields),
};
