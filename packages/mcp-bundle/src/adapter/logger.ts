const levelWeights: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

export type LogLevel = keyof typeof levelWeights;

function resolveLevel(): LogLevel {
  const raw = process.env.MCP_ADAPTER_LOG_LEVEL ?? process.env.LOG_LEVEL ?? "info";
  if (raw === "error" || raw === "warn" || raw === "info" || raw === "debug") {
    return raw;
  }
  return "info";
}

const currentLevel = resolveLevel();

function shouldLog(level: LogLevel): boolean {
  return levelWeights[level] <= levelWeights[currentLevel];
}

function format(prefix: string, level: LogLevel, message: unknown, args: unknown[]): string {
  const ts = new Date().toISOString();
  const payload = [message, ...args]
    .map((item) => {
      if (typeof item === "string") return item;
      try {
        return JSON.stringify(item);
      } catch (error) {
        return String(item);
      }
    })
    .join(" ");
  return `[${ts}] [${level.toUpperCase()}] [${prefix}] ${payload}`;
}

export function createLogger(prefix: string) {
  return {
    error(message: unknown, ...args: unknown[]) {
      if (shouldLog("error")) {
        console.error(format(prefix, "error", message, args));
      }
    },
    warn(message: unknown, ...args: unknown[]) {
      if (shouldLog("warn")) {
        console.warn(format(prefix, "warn", message, args));
      }
    },
    info(message: unknown, ...args: unknown[]) {
      if (shouldLog("info")) {
        console.log(format(prefix, "info", message, args));
      }
    },
    debug(message: unknown, ...args: unknown[]) {
      if (shouldLog("debug")) {
        console.debug(format(prefix, "debug", message, args));
      }
    }
  };
}
