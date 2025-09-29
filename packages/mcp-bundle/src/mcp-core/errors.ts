export type ErrorCode =
  | "browser_unavailable"
  | "cap_not_found"
  | "mcp_unavailable"
  | "timeout"
  | "bad_request"
  | "internal"
  | "version_mismatch"
  | "overloaded";

export interface ErrorShape {
  code: ErrorCode;
  message: string;
  retriable?: boolean;
  retryAfterMs?: number;
}

export function buildError(
  code: ErrorCode,
  message: string,
  extras: Partial<Omit<ErrorShape, "code" | "message">> = {}
): ErrorShape {
  return { code, message, ...extras };
}
