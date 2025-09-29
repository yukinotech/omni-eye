import { Envelope } from "../mcp-core";

const NEWLINE = "\n";

export function encodeEnvelope(envelope: Envelope): Buffer {
  const json = JSON.stringify(envelope);
  return Buffer.from(`${json}${NEWLINE}`, "utf8");
}

export class EnvelopeStreamDecoder {
  private buffer = "";
  constructor(private readonly onEnvelope: (envelope: Envelope) => void, private readonly onError: (error: unknown) => void) {}

  push(chunk: Buffer) {
    this.buffer += chunk.toString("utf8");
    let index = this.buffer.indexOf(NEWLINE);
    while (index >= 0) {
      const raw = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      if (raw.trim().length > 0) {
        try {
          const parsed = JSON.parse(raw);
          this.onEnvelope(parsed as Envelope);
        } catch (error) {
          this.onError(error);
        }
      }
      index = this.buffer.indexOf(NEWLINE);
    }
  }

  end() {
    if (this.buffer.trim().length > 0) {
      try {
        const parsed = JSON.parse(this.buffer);
        this.onEnvelope(parsed as Envelope);
      } catch (error) {
        this.onError(error);
      }
    }
    this.buffer = "";
  }
}
