import os from "os";
import path from "path";
import { ADAPTER_SOCKET_BASENAME } from "../mcp-core/constants";

export function adapterSocketPath(): string {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\${ADAPTER_SOCKET_BASENAME}`;
  }

  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  if (runtimeDir && runtimeDir.trim().length > 0) {
    return path.join(runtimeDir, `${ADAPTER_SOCKET_BASENAME}.sock`);
  }

  return path.join(os.tmpdir(), `${ADAPTER_SOCKET_BASENAME}.sock`);
}
