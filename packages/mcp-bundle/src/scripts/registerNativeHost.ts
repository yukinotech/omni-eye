import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

const HOST_NAME = "mcp_adapter";

function log(message: string) {
  console.log(`[mcp-bundle] ${message}`);
}

function warn(message: string) {
  console.warn(`[mcp-bundle] ${message}`);
}

function resolveExtensionId(): string | null {
  const fromEnv = process.env.MCP_EXTENSION_ID;
  if (fromEnv && fromEnv.length === 32) return fromEnv;
  const fromConfig = process.env.npm_package_config_extensionId;
  if (fromConfig && fromConfig.length === 32) {
    if (!fromEnv) {
      warn("Using extensionId from package config. Override with MCP_EXTENSION_ID if needed.");
    }
    return fromConfig;
  }
  return null;
}

function which(command: string): string | null {
  const lookup = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(lookup, [command], { encoding: "utf8" });
  if (result.status === 0) {
    const firstLine = result.stdout
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (firstLine) {
      return firstLine;
    }
  }
  return null;
}

function resolveExecutable(): string | null {
  const command = process.platform === "win32" ? "mcp-adapter.cmd" : "mcp-adapter";
  const fromPath = which(command);
  if (fromPath) {
    return path.resolve(fromPath);
  }
  const local = path.resolve(__dirname, "..", "..", "bin", command);
  if (fs.existsSync(local)) {
    return local;
  }
  return null;
}

function manifestDirectory(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts");
  }
  if (process.platform === "linux") {
    const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
    return path.join(base, "google-chrome", "NativeMessagingHosts");
  }
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "Google", "Chrome", "User Data", "NativeMessagingHosts");
  }
  return path.join(os.homedir(), ".config", "google-chrome", "NativeMessagingHosts");
}

function manifestPath(): string {
  return path.join(manifestDirectory(), `${HOST_NAME}.json`);
}

function ensureDirectory(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function writeManifest(manifestFile: string, executablePath: string, extensionId: string) {
  const manifest = {
    name: HOST_NAME,
    description: "Native Host Adapter for MCP",
    path: executablePath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`]
  };

  ensureDirectory(path.dirname(manifestFile));
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), "utf8");
}

function registerWindows(manifestFile: string) {
  const key = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
  const result = spawnSync("reg", ["ADD", key, "/ve", "/t", "REG_SZ", "/d", manifestFile, "/f"], {
    stdio: "inherit"
  });
  if (result.status !== 0) {
    throw new Error("Failed to add registry key for native messaging host");
  }
}

export function registerNativeHost(): void {
  const executable = resolveExecutable();
  if (!executable) {
    warn("Unable to locate mcp-adapter executable. Skipping manifest registration.");
    return;
  }

  const extensionId = resolveExtensionId();
  if (!extensionId) {
    warn("Missing extension id (set MCP_EXTENSION_ID or npm package config). Skipping manifest registration.");
    return;
  }

  const file = manifestPath();
  writeManifest(file, executable, extensionId);
  log(`Manifest written to ${file}`);

  if (process.platform === "win32") {
    try {
      registerWindows(file);
      log("Windows registry entry created");
    } catch (error) {
      warn(`Failed to register Windows native host: ${String(error)}`);
    }
  }
}

if (require.main === module) {
  try {
    registerNativeHost();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
