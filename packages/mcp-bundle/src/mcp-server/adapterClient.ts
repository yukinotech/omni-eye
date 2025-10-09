import net from "net";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";

import {
  type Envelope,
  type ErrorEnvelope,
  type EventEnvelope,
  type HeartbeatEnvelope,
  type RegisterEnvelope,
  type RequestEnvelope,
  type ResponseEnvelope,
  isError,
  isEvent,
  isRequest,
  isResponse,
} from "../mcp-core/envelope";
import { buildError, type ErrorCode } from "../mcp-core/errors";
import { encodeEnvelope, EnvelopeStreamDecoder } from "../server-sdk/framing";
import { adapterSocketPath } from "../server-sdk/socketName";

export interface Logger {
  error?: (message: unknown, ...args: unknown[]) => void;
  warn?: (message: unknown, ...args: unknown[]) => void;
  info?: (message: unknown, ...args: unknown[]) => void;
  debug?: (message: unknown, ...args: unknown[]) => void;
}

export interface AdapterClientErrorOptions {
  code: string;
  retriable?: boolean;
  retryAfterMs?: number;
  envelope?: Envelope;
}

export class AdapterClientError extends Error {
  readonly code: string;
  readonly retriable?: boolean;
  readonly retryAfterMs?: number;
  readonly envelope?: Envelope;

  constructor(message: string, options: AdapterClientErrorOptions) {
    super(message);
    this.code = options.code;
    this.retriable = options.retriable;
    this.retryAfterMs = options.retryAfterMs;
    this.envelope = options.envelope;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface AdapterClientOptions {
  serverId: string;
  caps: string[];
  version: string;
  socketPath?: string;
  logger?: Logger;
  heartbeatIntervalMs?: number;
  requestTimeoutMs?: number;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
}

interface PendingRequest {
  resolve: (envelope: ResponseEnvelope) => void;
  reject: (error: unknown) => void;
  timeout?: NodeJS.Timeout;
}

interface SocketListeners {
  data: (chunk: Buffer) => void;
  close: () => void;
  error: (error: Error) => void;
}

export class AdapterClient extends EventEmitter {
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly heartbeatInterval: number;
  private readonly requestTimeout: number;
  private readonly initialReconnectDelay: number;
  private readonly maxReconnectDelay: number;

  private socket?: net.Socket;
  private decoder?: EnvelopeStreamDecoder;
  private socketListeners?: SocketListeners;
  private heartbeatTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private stopped = true;
  private lastSocketError?: Error;
  private currentReconnectDelay: number;

  constructor(private readonly options: AdapterClientOptions) {
    super();
    this.heartbeatInterval = options.heartbeatIntervalMs ?? 15_000;
    this.requestTimeout = options.requestTimeoutMs ?? 15_000;
    this.initialReconnectDelay = options.reconnectDelayMs ?? 1_000;
    this.maxReconnectDelay = options.maxReconnectDelayMs ?? 10_000;
    this.currentReconnectDelay = this.initialReconnectDelay;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.currentReconnectDelay = this.initialReconnectDelay;
    try {
      await this.openSocket();
    } catch (error) {
      this.log("warn", "Initial adapter connection failed", error);
      this.scheduleReconnect();
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.clearReconnectTimer();
    this.clearHeartbeat();
    if (this.socket) {
      this.socket.destroy();
      this.cleanupSocket();
    }
    this.failAllPending(
      new AdapterClientError("MCP client stopped", {
        code: "mcp_unavailable",
      }),
    );
  }

  isConnected(): boolean {
    return Boolean(this.socket && !this.socket.destroyed);
  }

  async sendRequest(
    cap: string,
    payload: unknown,
    meta?: RequestEnvelope["meta"],
  ): Promise<ResponseEnvelope> {
    if (!this.socket || this.socket.destroyed) {
      throw new AdapterClientError("Adapter connection not ready", {
        code: "mcp_unavailable",
        retriable: true,
      });
    }

    const id = randomUUID();
    const request: RequestEnvelope = {
      id,
      type: "REQUEST",
      source: "mcp",
      target: "adapter",
      cap,
      payload,
      meta: {
        ...(meta ?? {}),
        serverId: meta?.serverId ?? this.options.serverId,
        version: this.options.version,
        ts: Date.now(),
      },
    };

    return await new Promise<ResponseEnvelope>((resolve, reject) => {
      const pending: PendingRequest = {
        resolve: (envelope) => {
          if (pending.timeout) {
            clearTimeout(pending.timeout);
          }
          resolve(envelope);
        },
        reject: (error) => {
          if (pending.timeout) {
            clearTimeout(pending.timeout);
          }
          reject(error);
        },
      };

      pending.timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(
          new AdapterClientError(`Request ${id} timed out after ${this.requestTimeout}ms`, {
            code: "timeout",
            retriable: true,
          }),
        );
      }, this.requestTimeout);

      this.pendingRequests.set(id, pending);

      try {
        this.write(request);
      } catch (error) {
        this.pendingRequests.delete(id);
        reject(error);
      }
    });
  }

  sendEvent(envelope: EventEnvelope): void {
    this.write({ ...envelope, source: "mcp", target: "adapter" });
  }

  private async openSocket(): Promise<void> {
    const socketPath = this.options.socketPath ?? adapterSocketPath();
    console.log("socketPath", socketPath);
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(socketPath);
      let resolved = false;

      const cleanup = () => {
        socket.removeListener("connect", onConnect);
        socket.removeListener("error", onError);
      };

      const onConnect = () => {
        resolved = true;
        cleanup();
        this.attachSocket(socket);
        resolve();
      };

      const onError = (error: Error & { code?: string }) => {
        cleanup();
        socket.destroy();
        if (!resolved) {
          reject(error);
        } else {
          this.log("error", "Socket error", { message: error.message, code: error.code });
        }
      };

      socket.once("connect", onConnect);
      socket.once("error", onError);
    });
  }

  private attachSocket(socket: net.Socket) {
    this.socket = socket;
    socket.setKeepAlive(true);
    this.decoder = new EnvelopeStreamDecoder(
      (envelope) => this.handleEnvelope(envelope),
      (error) => this.log("error", "Failed to parse adapter message", error),
    );

    const listeners: SocketListeners = {
      data: (chunk) => this.decoder?.push(chunk),
      close: () => this.handleSocketClose(),
      error: (error) => {
        this.lastSocketError = error;
        this.log("warn", "Adapter socket error", error);
      },
    };

    this.socketListeners = listeners;
    socket.on("data", listeners.data);
    socket.on("close", listeners.close);
    socket.on("error", listeners.error);

    this.lastSocketError = undefined;
    this.sendRegister();
    this.startHeartbeat();
    this.emit("connected");
    this.log("info", "Connected to adapter", {
      socketPath: this.options.socketPath ?? adapterSocketPath(),
    });
  }

  private cleanupSocket() {
    if (!this.socket) return;
    if (this.socketListeners) {
      this.socket.off("data", this.socketListeners.data);
      this.socket.off("close", this.socketListeners.close);
      this.socket.off("error", this.socketListeners.error);
    }
    this.socketListeners = undefined;
    this.socket = undefined;
    this.decoder = undefined;
    this.clearHeartbeat();
    this.lastSocketError = undefined;
  }

  private handleSocketClose() {
    const error = this.lastSocketError;
    this.cleanupSocket();
    this.failAllPending(
      new AdapterClientError("Adapter connection closed", {
        code: "mcp_unavailable",
        retriable: true,
        envelope: error instanceof AdapterClientError ? error.envelope : undefined,
      }),
    );
    this.emit("disconnected", error);
    this.log("warn", "Adapter connection closed");
    if (!this.stopped) {
      this.scheduleReconnect();
    }
  }

  private handleEnvelope(envelope: Envelope) {
    if (isResponse(envelope)) {
      this.handleResponse(envelope);
      return;
    }
    if (isError(envelope)) {
      this.handleErrorEnvelope(envelope);
      return;
    }
    if (isRequest(envelope)) {
      this.handleRequest(envelope);
      return;
    }
    if (isEvent(envelope)) {
      this.emit("event", envelope);
      return;
    }
    this.log("debug", "Received adapter signal", envelope);
  }

  private handleResponse(envelope: ResponseEnvelope) {
    const pending = this.pendingRequests.get(envelope.id);
    if (!pending) {
      this.log("warn", "Received response with no pending request", envelope.id);
      return;
    }
    this.pendingRequests.delete(envelope.id);
    pending.resolve(envelope);
  }

  private handleErrorEnvelope(envelope: ErrorEnvelope) {
    const pending = envelope.id ? this.pendingRequests.get(envelope.id) : undefined;
    const error = new AdapterClientError(envelope.error.message, {
      code: envelope.error.code ?? "internal",
      retriable: envelope.error.retriable,
      retryAfterMs: envelope.error.retryAfterMs,
      envelope,
    });

    if (pending && envelope.id) {
      this.pendingRequests.delete(envelope.id);
      pending.reject(error);
      return;
    }

    this.emit("error", error);
  }

  private handleRequest(envelope: RequestEnvelope) {
    this.log("warn", "Adapter sent request that server cannot handle", {
      cap: envelope.cap,
    });
    this.sendError(
      envelope.id,
      "cap_not_found",
      `Capability ${envelope.cap} is not handled by the MCP server`,
      envelope.meta,
    );
  }

  private sendRegister() {
    const register: RegisterEnvelope = {
      type: "REGISTER",
      source: "mcp",
      target: "adapter",
      payload: {
        serverId: this.options.serverId,
        caps: this.options.caps,
        version: this.options.version,
      },
    };
    this.write(register);
  }

  private sendResponse(id: string, payload: unknown, meta?: ResponseEnvelope["meta"]) {
    const response: ResponseEnvelope = {
      id,
      type: "RESPONSE",
      source: "mcp",
      target: "adapter",
      payload,
      meta,
    };
    this.write(response);
  }

  private sendError(id: string, code: ErrorCode, message: string, meta?: Envelope["meta"]) {
    const errorEnvelope: ErrorEnvelope = {
      id,
      type: "ERROR",
      source: "mcp",
      target: "adapter",
      error: buildError(code, message),
      meta,
    };
    this.write(errorEnvelope);
  }

  private startHeartbeat() {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.socket || this.socket.destroyed) {
        return;
      }
      const heartbeat: HeartbeatEnvelope = {
        type: "HEARTBEAT",
        source: "mcp",
        target: "adapter",
        payload: {
          serverId: this.options.serverId,
        },
      };
      try {
        this.write(heartbeat);
      } catch (error) {
        this.log("warn", "Failed to send heartbeat", error);
      }
    }, this.heartbeatInterval);
  }

  private clearHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.stopped) {
      return;
    }
    const delay = this.currentReconnectDelay;
    this.log("info", `Attempting to reconnect to adapter in ${delay}ms`);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = undefined;
      try {
        await this.openSocket();
        this.currentReconnectDelay = this.initialReconnectDelay;
      } catch (error) {
        this.log("warn", "Reconnection attempt failed", error);
        this.currentReconnectDelay = Math.min(
          this.currentReconnectDelay * 2,
          this.maxReconnectDelay,
        );
        this.scheduleReconnect();
      }
    }, delay);
  }

  private failAllPending(error: unknown) {
    const entries = Array.from(this.pendingRequests.values());
    this.pendingRequests.clear();
    for (const pending of entries) {
      pending.reject(error);
    }
  }

  private write(envelope: Envelope) {
    if (!this.socket || this.socket.destroyed) {
      throw new AdapterClientError("Socket not connected", {
        code: "mcp_unavailable",
        retriable: true,
      });
    }

    try {
      this.socket.write(encodeEnvelope(envelope));
    } catch (error) {
      throw new AdapterClientError("Failed to write to adapter socket", {
        code: "internal",
        envelope: envelope.type === "ERROR" ? envelope : undefined,
      });
    }
  }

  private log(level: keyof Logger, message: unknown, ...args: unknown[]) {
    const logger = this.options.logger;
    const fn = logger?.[level];
    if (typeof fn === "function") {
      fn.call(logger, message, ...args);
    }
  }
}
