export type ErrorCode =
  | "BAD_INPUT"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "SERPAPI_NOT_CONFIGURED"
  | "SERPAPI_QUOTA"
  | "SERPAPI_QUOTA_CONFIRM"
  | "SERPAPI_ERROR"
  | "CLAUDE_NOT_CONFIGURED"
  | "CLAUDE_BUDGET"
  | "CLAUDE_BUDGET_CONFIRM"
  | "CLAUDE_ERROR"
  | "UPSTREAM_ERROR";

const STATUS: Record<ErrorCode, number> = {
  BAD_INPUT: 400,
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  SERPAPI_NOT_CONFIGURED: 500,
  SERPAPI_QUOTA: 429,
  SERPAPI_QUOTA_CONFIRM: 409,
  SERPAPI_ERROR: 502,
  CLAUDE_NOT_CONFIGURED: 500,
  CLAUDE_BUDGET: 429,
  CLAUDE_BUDGET_CONFIRM: 409,
  CLAUDE_ERROR: 502,
  UPSTREAM_ERROR: 502,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export function badInput(message: string): AppError {
  return new AppError("BAD_INPUT", message);
}
