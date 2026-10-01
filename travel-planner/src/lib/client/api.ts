"use client";

export interface ApiErrorBody {
  error: string;
  code: string;
  details?: unknown;
}

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;
  constructor(status: number, body: ApiErrorBody) {
    super(body.error);
    this.code = body.code;
    this.status = status;
    this.details = body.details;
  }
}

/**
 * fetch wrapper for our own API. When the server says a call would exceed quota/budget while the
 * override is on, ask the user once and retry with the confirmation header.
 */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  const doFetch = () => fetch(path, { ...init, headers, body });
  let res = await doFetch();

  for (let i = 0; i < 2 && res.status === 409; i++) {
    const err = (await res.clone().json().catch(() => null)) as ApiErrorBody | null;
    if (err?.code === "SERPAPI_QUOTA_CONFIRM" || err?.code === "CLAUDE_BUDGET_CONFIRM") {
      if (!window.confirm(err.error)) throw new ApiError(409, err);
      headers.set(err.code === "SERPAPI_QUOTA_CONFIRM" ? "x-confirm-over-quota" : "x-confirm-over-budget", "1");
      res = await doFetch();
    } else break;
  }

  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth")) {
    // Full reload on auth change so no stale client state survives.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  }
  const data = await res.json().catch(() => ({ error: `Unexpected response (${res.status})`, code: "UPSTREAM_ERROR" }));
  if (!res.ok) throw new ApiError(res.status, data as ApiErrorBody);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("tp:usage-changed"));
  return data as T;
}
