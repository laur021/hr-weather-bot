type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface Logger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export function createLogger(level: string): Logger {
  const threshold = ORDER[level as Level] ?? ORDER.info;
  const emit = (lvl: Level, msg: string, args: unknown[]) => {
    if (ORDER[lvl] < threshold) return;
    const line = `[${new Date().toISOString()}] [${lvl.toUpperCase()}] ${msg}`;
    if (lvl === "error") console.error(line, ...args);
    else if (lvl === "warn") console.warn(line, ...args);
    else console.log(line, ...args);
  };
  return {
    debug: (m, ...a) => emit("debug", m, a),
    info: (m, ...a) => emit("info", m, a),
    warn: (m, ...a) => emit("warn", m, a),
    error: (m, ...a) => emit("error", m, a),
  };
}
