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

export function isRequest(envelope: Envelope): envelope is RequestEnvelope {
  return envelope.type === "REQUEST";
}

export function isResponse(envelope: Envelope): envelope is ResponseEnvelope {
  return envelope.type === "RESPONSE";
}

export function isError(envelope: Envelope): envelope is ErrorEnvelope {
  return envelope.type === "ERROR";
}

export function isRegister(envelope: Envelope): envelope is RegisterEnvelope {
  return envelope.type === "REGISTER";
}

export function isHeartbeat(envelope: Envelope): envelope is HeartbeatEnvelope {
  return envelope.type === "HEARTBEAT";
}

export function isEvent(envelope: Envelope): envelope is EventEnvelope {
  return envelope.type === "EVENT";
}
