import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import type { AgentCommand, AgentResponse, Snapshot } from "./messages.js";

export type BridgeEventMap = {
  snapshot: [Snapshot];
  response: [AgentResponse];
  open: [];
  close: [];
};

type BridgeIncomingMessage =
  | { type: "hello"; payload: unknown }
  | { type: "snapshot"; payload: Snapshot }
  | AgentResponse;

type PendingResolver = {
  resolve: (value: AgentResponse) => void;
  reject: (reason?: unknown) => void;
};

export interface ExtensionBridgeOptions {
  port?: number;
  heartbeatIntervalMs?: number;
}

export class ExtensionBridge extends EventEmitter {
  private readonly server: WebSocketServer;
  private socket: WebSocket | null = null;
  private readonly pending = new Map<string, PendingResolver>();
  private readonly heartbeatIntervalMs: number;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(options: ExtensionBridgeOptions = {}) {
    super();

    const { port = 7337, heartbeatIntervalMs = 15_000 } = options;
    this.server = new WebSocketServer({ port });
    this.server.on("connection", (socket: WebSocket) => this.handleConnection(socket));
    this.server.on("listening", () => {
      this.emit("open");
    });

    this.heartbeatIntervalMs = heartbeatIntervalMs;
  }

  on<EventName extends keyof BridgeEventMap>(
    event: EventName,
    listener: (...args: BridgeEventMap[EventName]) => void,
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  once<EventName extends keyof BridgeEventMap>(
    event: EventName,
    listener: (...args: BridgeEventMap[EventName]) => void,
  ): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }

  off<EventName extends keyof BridgeEventMap>(
    event: EventName,
    listener: (...args: BridgeEventMap[EventName]) => void,
  ): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }

  emit<EventName extends keyof BridgeEventMap>(
    event: EventName,
    ...args: BridgeEventMap[EventName]
  ): boolean {
    return super.emit(event, ...args);
  }

  get isConnected(): boolean {
    return Boolean(this.socket && this.socket.readyState === WebSocket.OPEN);
  }

  send(command: Omit<AgentCommand, "requestId"> & { requestId?: string }): Promise<AgentResponse> {
    const requestId = command.requestId ?? randomUUID();
    const payload: AgentCommand = { ...command, requestId } as AgentCommand;

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("No active extension connection"));
    }

    return new Promise<AgentResponse>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.socket!.send(JSON.stringify(payload), (error?: Error | null) => {
        if (error) {
          this.pending.delete(requestId);
          reject(error);
        }
      });
    });
  }

  close(): void {
    this.stopHeartbeat();
    this.pending.forEach(({ reject }) => reject(new Error("Bridge closed")));
    this.pending.clear();
    this.socket?.close();
    this.server.close();
    this.emit("close");
  }

  private handleConnection(socket: WebSocket): void {
    this.socket = socket;
    this.socket.on("message", (data: RawData) => this.handleMessage(data));
    this.socket.on("close", () => this.handleSocketClose());
    this.socket.on("error", (error: Error) => {
      console.error("[omni-eye:mcp] bridge socket error", error);
      this.handleSocketClose();
    });

    this.startHeartbeat();
  }

  private handleSocketClose(): void {
    this.stopHeartbeat();
    this.socket = null;
    this.pending.forEach(({ reject }) => reject(new Error("Extension disconnected")));
    this.pending.clear();
    this.emit("close");
  }

  private handleMessage(data: RawData): void {
    try {
      const message = JSON.parse(data.toString()) as BridgeIncomingMessage;
      if (isAgentResponse(message)) {
        this.dispatchResponse(message);
        return;
      }

      if (message.type === "snapshot") {
        this.emit("snapshot", message.payload);
      }
    } catch (error) {
      console.error("[omni-eye:mcp] failed to parse message", error);
    }
  }

  private dispatchResponse(response: AgentResponse): void {
    const pending = this.pending.get(response.requestId);
    if (pending) {
      this.pending.delete(response.requestId);
      pending.resolve(response);
    }

    this.emit("response", response);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        return;
      }
      this.socket.ping();
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (!this.heartbeatTimer) {
      return;
    }

    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}

function isAgentResponse(message: BridgeIncomingMessage): message is AgentResponse {
  return (
    typeof message === "object" &&
    message !== null &&
    "kind" in message &&
    typeof (message as AgentResponse).kind === "string" &&
    (message as AgentResponse).kind.startsWith("agent:")
  );
}
