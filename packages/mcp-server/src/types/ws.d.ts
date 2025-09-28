declare module "ws" {
  import { EventEmitter } from "node:events";

  export type RawData = string | Buffer | ArrayBuffer | Buffer[];

  export class WebSocket extends EventEmitter {
    static readonly CONNECTING: number;
    static readonly OPEN: number;
    readonly readyState: number;
    send(data: string, callback?: (error?: Error) => void): void;
    ping(): void;
    close(): void;
    on(event: "message", listener: (data: RawData) => void): this;
    on(event: "close", listener: () => void): this;
    on(event: "error", listener: (error: Error) => void): this;
  }

  export interface WebSocketServerOptions {
    port: number;
  }

  export class WebSocketServer extends EventEmitter {
    constructor(options: WebSocketServerOptions);
    on(event: "connection", listener: (socket: WebSocket) => void): this;
    on(event: "listening", listener: () => void): this;
    close(): void;
  }

  export { WebSocketServer };
  export default WebSocket;
}
