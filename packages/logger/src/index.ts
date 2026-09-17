type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SECRET_KEYS =
  /^(authorization|cookie|set-cookie|password|token|api[_-]?key|encrypted[_-]?key|secret|session[_-]?secret)$/i;
const SECRET_VALUE = /(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]+)/g;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (typeof value === "string") return value.replace(SECRET_VALUE, "[REDACTED]");
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redact(value.message), stack: value.stack };
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEYS.test(k) ? "[REDACTED]" : redact(v, depth + 1);
    return out;
  }
  return value;
}

export type Logger = {
  [L in Level]: (msg: string, fields?: Record<string, unknown>) => void;
} & { child(fields: Record<string, unknown>): Logger };

export function createLogger(
  base: Record<string, unknown> = {},
  level: Level = (process.env.LOG_LEVEL as Level) ?? "info",
): Logger {
  const min = order[level] ?? 20;
  const emit = (lvl: Level) => (msg: string, fields?: Record<string, unknown>) => {
    if (order[lvl] < min) return;
    const line = JSON.stringify(redact({ ts: new Date().toISOString(), level: lvl, msg, ...base, ...fields }));
    (lvl === "error" || lvl === "warn" ? process.stderr : process.stdout).write(`${line}\n`);
  };
  return {
    debug: emit("debug"),
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
    child: (fields) => createLogger({ ...base, ...fields }, level),
  };
}

export const logger = createLogger();
