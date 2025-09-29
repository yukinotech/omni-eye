import { Envelope } from "../mcp-core";

const HEADER_BYTES = 4;

export type NativeMessageHandler = (envelope: Envelope) => void;
export type NativeMessageErrorHandler = (error: Error) => void;

export class NativeMessageReader {
  private buffer = Buffer.alloc(0);
  private readonly handler: NativeMessageHandler;
  private readonly errorHandler: NativeMessageErrorHandler;

  constructor(handler: NativeMessageHandler, errorHandler: NativeMessageErrorHandler) {
    this.handler = handler;
    this.errorHandler = errorHandler;
  }

  push(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= HEADER_BYTES) {
      const length = this.buffer.readUInt32LE(0);
      if (this.buffer.length < HEADER_BYTES + length) {
        return;
      }
      const body = this.buffer.slice(HEADER_BYTES, HEADER_BYTES + length);
      this.buffer = this.buffer.slice(HEADER_BYTES + length);
      try {
        const parsed = JSON.parse(body.toString("utf8"));
        this.handler(parsed as Envelope);
      } catch (error) {
        this.errorHandler(error as Error);
      }
    }
  }
}

export function writeNativeMessage(stream: NodeJS.WritableStream, envelope: Envelope) {
  const payload = Buffer.from(JSON.stringify(envelope), "utf8");
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt32LE(payload.length, 0);
  stream.write(Buffer.concat([header, payload]));
}
