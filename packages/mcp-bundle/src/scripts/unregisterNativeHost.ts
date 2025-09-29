import fs from "fs";
import path from "path";
import os from "os";
import { spawnSync } from "child_process";

const HOST_NAME = "mcp_adapter";

function log(message: string) {
  console.log(`[mcp-bundle] ${message}`);
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

function removeFile(file: string) {
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    log(`Removed manifest ${file}`);
  }
}

function unregisterWindows() {
  const key = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
  const result = spawnSync("reg", ["DELETE", key, "/f"], { stdio: "inherit" });
  if (result.status !== 0) {
    log("Registry key not found or failed to delete");
  }
}

export function unregisterNativeHost(): void {
  const file = manifestPath();
  removeFile(file);
  if (process.platform === "win32") {
    unregisterWindows();
  }
}

if (require.main === module) {
  try {
    unregisterNativeHost();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
