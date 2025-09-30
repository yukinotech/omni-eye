import fs from "fs";
import net from "net";
import path from "path";
import { randomUUID } from "crypto";
import {
  Envelope,
  RequestEnvelope,
  ResponseEnvelope,
  ErrorEnvelope,
  RegisterEnvelope,
  HeartbeatEnvelope,
  EventEnvelope,
} from "../mcp-core/envelope.js";
import { buildError, ErrorCode } from "../mcp-core/errors.js";
import { createLogger } from "./logger";
import { NativeMessageReader, writeNativeMessage } from "./nativeIo";
import { encodeEnvelope, EnvelopeStreamDecoder } from "../server-sdk/framing";
import { adapterSocketPath } from "../server-sdk/socketName";

const log = createLogger("adapter");

log?.debug?.("Adapter script loaded");

interface McpConnection {
  socket: net.Socket;
  serverId: string | null;
  caps: Set<string>;
  version?: string;
  lastHeartbeat: number;
}

interface PendingEntry {
  origin: "mcp" | "extension";
  socket?: net.Socket;
}

const pending = new Map<string, PendingEntry>();
const connectionsBySocket = new Map<net.Socket, McpConnection>();
const connectionsById = new Map<string, McpConnection>();
const capsIndex = new Map<string, Set<string>>();
let extensionConnected = false;

function addCap(serverId: string, cap: string) {
  if (!capsIndex.has(cap)) {
    capsIndex.set(cap, new Set());
  }
  capsIndex.get(cap)?.add(serverId);
}

function clearCaps(connection: McpConnection) {
  if (!connection.serverId) return;
  for (const [cap, ids] of capsIndex.entries()) {
    if (ids.delete(connection.serverId) && ids.size === 0) {
      capsIndex.delete(cap);
    }
  }
}

function removeConnection(connection: McpConnection) {
  if (connection.serverId) {
    connectionsById.delete(connection.serverId);
    clearCaps(connection);
  }
  connectionsBySocket.delete(connection.socket);
  for (const [id, entry] of pending.entries()) {
    if (entry.origin === "mcp" && entry.socket === connection.socket) {
      pending.delete(id);
    }
  }
}

function ensureSocketCleanup(socket: net.Socket) {
  socket.on("error", (error) => {
    log?.warn?.("Socket error", error.message);
  });
  socket.on("close", () => {
    const connection = connectionsBySocket.get(socket);
    if (connection) {
      log?.info?.("MCP disconnected", { serverId: connection.serverId ?? "unknown" });
      removeConnection(connection);
    }
  });
}

function handleRegister(connection: McpConnection, envelope: RegisterEnvelope) {
  const { serverId, caps, version } = envelope.payload;
  if (connection.serverId && connection.serverId !== serverId) {
    clearCaps(connection);
    connectionsById.delete(connection.serverId);
  } else {
    clearCaps(connection);
  }
  connection.serverId = serverId;
  connection.version = version;
  connection.caps = new Set(caps);
  connection.lastHeartbeat = Date.now();
  connectionsById.set(serverId, connection);
  log?.info?.("MCP registered", { serverId, caps, version });
  caps.forEach((cap) => addCap(serverId, cap));
  sendEventToExtension({
    type: "EVENT",
    source: "adapter",
    target: "extension",
    payload: {
      kind: "server-registered",
      serverId,
      caps,
      version,
    },
  });
}

function handleHeartbeat(connection: McpConnection, envelope: HeartbeatEnvelope) {
  connection.lastHeartbeat = Date.now();
  sendEventToExtension({
    type: "EVENT",
    source: "adapter",
    target: "extension",
    payload: {
      kind: "server-heartbeat",
      serverId: connection.serverId,
      load: envelope.payload.load,
      ts: connection.lastHeartbeat,
    },
  });
}

function sendEventToExtension(envelope: EventEnvelope) {
  if (!extensionConnected) return;
  try {
    writeNativeMessage(process.stdout, envelope);
  } catch (error) {
    log?.error?.("Failed to forward event to extension", error);
  }
}

function sendToExtension(envelope: Envelope) {
  if (!extensionConnected) {
    log?.debug?.("Extension not connected; drop message", envelope);
    return;
  }
  try {
    writeNativeMessage(process.stdout, envelope);
  } catch (error) {
    log?.error?.("Failed to write to extension", error);
  }
}

function pickMcpByCap(cap: string, preferredServerId?: string): McpConnection | undefined {
  if (preferredServerId) {
    const connection = connectionsById.get(preferredServerId);
    if (connection) return connection;
  }

  const ids = capsIndex.get(cap);
  if (!ids || ids.size === 0) return undefined;
  const [first] = ids;
  return first ? connectionsById.get(first) : undefined;
}

function sendErrorToExtension(id: string | undefined, code: ErrorCode, message: string) {
  const envelope: ErrorEnvelope = {
    id,
    type: "ERROR",
    source: "adapter",
    target: "extension",
    error: buildError(code, message),
  };
  sendToExtension(envelope);
}

function sendErrorToMcp(
  socket: net.Socket,
  id: string | undefined,
  code: ErrorCode,
  message: string,
) {
  const envelope: ErrorEnvelope = {
    id,
    type: "ERROR",
    source: "adapter",
    target: "mcp",
    error: buildError(code, message),
  };
  socket.write(encodeEnvelope(envelope));
}

function safeUnlinkSocket(socketPath: string) {
  if (process.platform === "win32") return;
  try {
    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }
  } catch (error) {
    log?.warn?.("Failed to remove stale socket", { socketPath, error });
  }
}

function ensureSocketDirectory(socketPath: string) {
  if (process.platform === "win32") return;
  const dir = path.dirname(socketPath);
  fs.mkdirSync(dir, { recursive: true });
}

function registerPending(id: string, entry: PendingEntry) {
  pending.set(id, entry);
}

function resolvePending(id: string | undefined): PendingEntry | undefined {
  if (!id) return undefined;
  const entry = pending.get(id);
  if (entry) pending.delete(id);
  return entry;
}

function handleMcpRequest(connection: McpConnection, envelope: RequestEnvelope) {
  if (!extensionConnected) {
    sendErrorToMcp(
      connection.socket,
      envelope.id,
      "browser_unavailable",
      "Browser extension is not connected",
    );
    return;
  }
  const forward: Envelope = {
    ...envelope,
    source: "adapter",
    target: "extension",
    meta: {
      ...(envelope.meta ?? {}),
      serverId: connection.serverId ?? undefined,
      ts: Date.now(),
    },
  };
  registerPending(envelope.id, { origin: "mcp", socket: connection.socket });
  sendToExtension(forward);
}

function handleMcpEnvelope(connection: McpConnection, envelope: Envelope) {
  switch (envelope.type) {
    case "REGISTER":
      handleRegister(connection, envelope);
      break;
    case "HEARTBEAT":
      handleHeartbeat(connection, envelope);
      break;
    case "REQUEST":
      handleMcpRequest(connection, envelope);
      break;
    case "RESPONSE":
    case "ERROR": {
      const entry = resolvePending(envelope.id);
      if (entry?.origin === "extension") {
        sendToExtension({
          ...envelope,
          source: "adapter",
          target: "extension",
        });
      }
      break;
    }
    case "EVENT":
      sendToExtension({ ...envelope, source: "adapter", target: "extension" });
      break;
  }
}

function attachSocket(connection: McpConnection) {
  const decoder = new EnvelopeStreamDecoder(
    (envelope) => handleMcpEnvelope(connection, envelope),
    (error) => log?.error?.("Failed to parse MCP message", error),
  );

  connection.socket.on("data", (chunk) => decoder.push(chunk));
  connection.socket.on("end", () => decoder.end());
}

function createSocketServer() {
  const socketPath = adapterSocketPath();
  ensureSocketDirectory(socketPath);
  safeUnlinkSocket(socketPath);

  const server = net.createServer((socket) => {
    const connection: McpConnection = {
      socket,
      serverId: null,
      caps: new Set(),
      lastHeartbeat: Date.now(),
    };
    connectionsBySocket.set(socket, connection);
    attachSocket(connection);
    ensureSocketCleanup(socket);
    log?.info?.("MCP connected", { remote: socket.remoteAddress });
  });

  server.on("error", (error) => {
    log?.error?.("Adapter server error", error);
  });

  server.listen(socketPath, () => {
    if (process.platform !== "win32") {
      fs.chmodSync(socketPath, 0o600);
    }
    log?.info?.("Adapter listening", { socketPath });
  });
}

function handleExtensionRequest(envelope: RequestEnvelope) {
  const targetServerId = envelope.meta?.serverId;
  const connection = pickMcpByCap(envelope.cap, targetServerId);
  if (!connection) {
    sendErrorToExtension(
      envelope.id,
      "mcp_unavailable",
      `No MCP server available for capability ${envelope.cap}`,
    );
    return;
  }

  const id = envelope.id ?? randomUUID();
  const forward: Envelope = {
    ...envelope,
    id,
    source: "adapter",
    target: "mcp",
    meta: {
      ...(envelope.meta ?? {}),
      serverId: connection.serverId ?? undefined,
      ts: Date.now(),
    },
  };

  registerPending(id, { origin: "extension" });
  connection.socket.write(encodeEnvelope(forward));
}

function handleExtensionEnvelope(envelope: Envelope) {
  extensionConnected = true;
  switch (envelope.type) {
    case "REQUEST":
      handleExtensionRequest(envelope);
      break;
    case "RESPONSE":
    case "ERROR": {
      const entry = resolvePending(envelope.id);
      if (entry?.origin === "mcp" && entry.socket) {
        entry.socket.write(
          encodeEnvelope({
            ...envelope,
            source: "adapter",
            target: "mcp",
          }),
        );
      }
      break;
    }
    case "REGISTER":
    case "HEARTBEAT":
    case "EVENT":
      log?.debug?.("Extension envelope", envelope);
      break;
  }
}

function setupNativeMessaging() {
  try {
    process.stdin.resume();
    process.stdin.on("error", (error) => {
      log?.error?.("Native messaging stdin error", error);
    });
    process.stdout.on("error", (error) => {
      log?.error?.("Native messaging stdout error", error);
    });

    const reader = new NativeMessageReader(
      (envelope) => handleExtensionEnvelope(envelope),
      (error) => log?.error?.("Failed to parse native message", error),
    );

    process.stdin.on("data", (chunk: Buffer) => {
      reader.push(chunk);
    });

    process.stdin.on("close", () => {
      extensionConnected = false;
      log?.info?.("Extension disconnected");
    });
  } catch (error) {
    log?.error?.("Failed to initialize native messaging", error);
  }
}

export function start() {
  setupNativeMessaging();
  createSocketServer();
}

if (require.main === module) {
  start();
}
