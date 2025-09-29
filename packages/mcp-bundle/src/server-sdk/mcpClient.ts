import { EventEmitter } from "events";
import net from "net";
import { Envelope, RequestEnvelope, ResponseEnvelope, ErrorEnvelope, RegisterEnvelope, HeartbeatEnvelope } from "../mcp-core";
import { encodeEnvelope, EnvelopeStreamDecoder } from "./framing";
import { adapterSocketPath } from "./socketName";

export interface McpClientOptions {
  serverId: string;
  caps: string[];
  version: string;
  retryIntervalMs?: number;
  maxRetryIntervalMs?: number;
}

export interface McpClientEvents {
  open: () => void;
  close: (hadError: boolean) => void;
  envelope: (envelope: Envelope) => void;
  response: (envelope: ResponseEnvelope | ErrorEnvelope) => void;
  request: (envelope: RequestEnvelope) => void;
  error: (error: Error) => void;
}

export declare interface McpClient {
  on<U extends keyof McpClientEvents>(event: U, listener: McpClientEvents[U]): this;
  once<U extends keyof McpClientEvents>(event: U, listener: McpClientEvents[U]): this;
  off<U extends keyof McpClientEvents>(event: U, listener: McpClientEvents[U]): this;
}

function isResponseLike(envelope: Envelope): envelope is ResponseEnvelope | ErrorEnvelope {
  return envelope.type === "RESPONSE" || envelope.type === "ERROR";
}

function isRequestLike(envelope: Envelope): envelope is RequestEnvelope {
  return envelope.type === "REQUEST";
}

function isRegister(envelope: Envelope): envelope is RegisterEnvelope {
  return envelope.type === "REGISTER";
}

function isHeartbeat(envelope: Envelope): envelope is HeartbeatEnvelope {
  return envelope.type === "HEARTBEAT";
}

export class McpClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private readonly retryIntervalMs: number;
  private readonly maxRetryIntervalMs: number;
  private currentRetryMs: number;
  private shouldReconnect = true;
  private decoder: EnvelopeStreamDecoder | null = null;

  constructor(private readonly options: McpClientOptions) {
    super();
    this.retryIntervalMs = options.retryIntervalMs ?? 500;
    this.maxRetryIntervalMs = options.maxRetryIntervalMs ?? 10_000;
    this.currentRetryMs = this.retryIntervalMs;
  }

  async start(): Promise<void> {
    this.shouldReconnect = true;
    await this.connectWithRetry();
  }

  async stop(): Promise<void> {
    this.shouldReconnect = false;
    if (this.socket) {
      this.socket.end();
      this.socket.destroy();
      this.socket = null;
    }
  }

  send(envelope: Envelope) {
    if (!this.socket || this.socket.destroyed) {
      throw new Error("Socket is not connected");
    }
    const buffer = encodeEnvelope(envelope);
    this.socket.write(buffer);
  }

  sendRequest(cap: string, payload: unknown, id: string) {
    const envelope: RequestEnvelope = {
      id,
      type: "REQUEST",
      cap,
      payload,
      source: "mcp",
      target: "extension"
    };
    this.send(envelope);
  }

  private connectWithRetry(): Promise<void> {
    return new Promise((resolve, reject) => {
      const attempt = () => {
        if (!this.shouldReconnect) {
          reject(new Error("Client stopped"));
          return;
        }

        const socket = net.createConnection(adapterSocketPath());
        this.socket = socket;

        const cleanup = () => {
          socket.removeAllListeners();
          this.decoder = null;
        };

        socket.once("error", (error) => {
          cleanup();
          this.emit("error", error);
          socket.destroy();
        });

        socket.once("connect", () => {
          this.currentRetryMs = this.retryIntervalMs;
          this.onConnected();
          this.emit("open");
          resolve();
        });

        socket.on("close", (hadError) => {
          cleanup();
          this.emit("close", hadError);
          if (this.shouldReconnect) {
            setTimeout(() => {
              this.currentRetryMs = Math.min(this.currentRetryMs * 2, this.maxRetryIntervalMs);
              attempt();
            }, this.currentRetryMs);
          }
        });

        socket.on("data", (chunk) => {
          if (!this.decoder) {
            this.decoder = new EnvelopeStreamDecoder(
              (envelope) => this.onEnvelope(envelope),
              (error) => this.emit("error", error as Error)
            );
          }
          this.decoder.push(chunk);
        });

        socket.on("end", () => {
          this.decoder?.end();
        });
      };

      attempt();
    });
  }

  private onConnected() {
    const register: RegisterEnvelope = {
      type: "REGISTER",
      payload: {
        serverId: this.options.serverId,
        caps: this.options.caps,
        version: this.options.version
      },
      source: "mcp",
      target: "adapter",
      meta: { ts: Date.now(), serverId: this.options.serverId, version: this.options.version }
    };
    this.send(register);
  }

  private onEnvelope(envelope: Envelope) {
    this.emit("envelope", envelope);
    if (isResponseLike(envelope)) {
      this.emit("response", envelope);
    } else if (isRequestLike(envelope)) {
      this.emit("request", envelope);
    } else if (isRegister(envelope) || isHeartbeat(envelope)) {
      // ignore for now
    }
  }
}
