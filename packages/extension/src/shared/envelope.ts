export type Envelope =
  | RequestEnvelope
  | ResponseEnvelope
  | ErrorEnvelope
  | RegisterEnvelope
  | HeartbeatEnvelope
  | EventEnvelope;

export interface EnvelopeBase {
  id?: string;
  type: "REQUEST" | "RESPONSE" | "ERROR" | "REGISTER" | "HEARTBEAT" | "EVENT";
  source?: "mcp" | "adapter" | "extension";
  target?: "adapter" | "mcp" | "extension";
  cap?: string;
  meta?: {
    ts?: number;
    traceId?: string;
    serverId?: string;
    tabId?: number;
    version?: string;
  };
}

export interface RequestEnvelope extends EnvelopeBase {
  id: string;
  type: "REQUEST";
  cap: string;
  payload: unknown;
}

export interface ResponseEnvelope extends EnvelopeBase {
  id: string;
  type: "RESPONSE";
  payload: unknown;
}

export interface ErrorEnvelope extends EnvelopeBase {
  type: "ERROR";
  error: {
    code: string;
    message: string;
    retriable?: boolean;
    retryAfterMs?: number;
  };
}

export interface RegisterEnvelope extends EnvelopeBase {
  type: "REGISTER";
  payload: {
    serverId: string;
    caps: string[];
    version: string;
  };
}

export interface HeartbeatEnvelope extends EnvelopeBase {
  type: "HEARTBEAT";
  payload: {
    serverId: string;
    load?: number;
  };
}

export interface EventEnvelope extends EnvelopeBase {
  type: "EVENT";
  payload: unknown;
}

export function isEnvelope(value: unknown): value is Envelope {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Envelope;
  return (
    candidate.type === "REQUEST" ||
    candidate.type === "RESPONSE" ||
    candidate.type === "ERROR" ||
    candidate.type === "REGISTER" ||
    candidate.type === "HEARTBEAT" ||
    candidate.type === "EVENT"
  );
}

export function ensureId(envelope: Envelope, fallback: string): string {
  if (envelope.id && envelope.id.length > 0) {
    return envelope.id;
  }
  envelope.id = fallback;
  return fallback;
}
