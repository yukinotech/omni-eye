import { createWriteStream, mkdirSync } from "fs";
import type { WriteStream } from "fs";
import { dirname, join, resolve } from "path";
import { homedir } from "os";

const levelWeights = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
} as const;

export type LogLevel = keyof typeof levelWeights;

function resolveLevel(): LogLevel {
  const raw = process.env.MCP_ADAPTER_LOG_LEVEL ?? process.env.LOG_LEVEL ?? "info";
  if (raw === "error" || raw === "warn" || raw === "info" || raw === "debug") {
    return raw;
  }
  return "info";
}

const currentLevel = resolveLevel();

function resolveLogFilePath(rawPath: string | undefined): string | undefined {
  const trimmed = rawPath?.trim();
  if (trimmed) {
    const expanded =
      trimmed === "~"
        ? homedir()
        : trimmed.startsWith("~/")
          ? join(homedir(), trimmed.slice(2))
          : trimmed;
    return resolve(expanded);
  }

  if (process.platform === "darwin") {
    return resolve(homedir(), ".omni-eye", "mcp-adapter.log");
  }

  return undefined;
}

const logFilePath = resolveLogFilePath(process.env.MCP_ADAPTER_LOG_FILE);
let logStream: WriteStream | undefined;

if (logFilePath) {
  try {
    mkdirSync(dirname(logFilePath), { recursive: true });
    logStream = createWriteStream(logFilePath, { flags: "a" });
    logStream.on("error", (error) => {
      console.warn(`[logger] Failed to write logs to ${logFilePath}:`, error);
      logStream?.close();
      logStream = undefined;
    });
  } catch (error) {
    console.warn(`[logger] Failed to initialize log file ${logFilePath}:`, error);
    logStream = undefined;
  }
}

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

type ConsoleMethod = "error" | "warn" | "log" | "debug";

function emit(
  level: LogLevel,
  method: ConsoleMethod,
  prefix: string,
  message: unknown,
  args: unknown[],
) {
  if (!shouldLog(level)) {
    return;
  }
  const line = format(prefix, level, message, args);
  console[method](line);
  if (logStream) {
    logStream.write(`${line}\n`);
  }
}

export function createLogger(prefix: string) {
  return {
    error(message: unknown, ...args: unknown[]) {
      emit("error", "error", prefix, message, args);
    },
    warn(message: unknown, ...args: unknown[]) {
      emit("warn", "error", prefix, message, args);
    },
    info(message: unknown, ...args: unknown[]) {
      emit("info", "error", prefix, message, args);
    },
    debug(message: unknown, ...args: unknown[]) {
      emit("debug", "error", prefix, message, args);
    },
  };
}
