import "server-only";
import { NextResponse } from "next/server";
import { AppError, badInput } from "@/lib/errors";
import { runWithContext } from "@/lib/request-context";

export const CONFIRM_QUOTA_HEADER = "x-confirm-over-quota";
export const CONFIRM_BUDGET_HEADER = "x-confirm-over-budget";

type Handler<C> = (req: Request, ctx: C) => Promise<unknown>;

/** Wraps a route handler: sets request context, returns JSON, maps AppError to a status + code. */
export function withApi<C = unknown>(handler: Handler<C>) {
  return async (req: Request, ctx: C) => {
    const context = {
      confirmOverQuota: req.headers.get(CONFIRM_QUOTA_HEADER) === "1",
      confirmOverBudget: req.headers.get(CONFIRM_BUDGET_HEADER) === "1",
    };
    try {
      const result = await runWithContext(context, () => handler(req, ctx));
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (e) {
      if (e instanceof AppError) {
        return NextResponse.json({ error: e.message, code: e.code, details: e.details ?? null }, { status: e.status });
      }
      console.error("[api] unhandled", e);
      // Single-user, password-gated app: show the real reason so problems can be fixed from the screen.
      const reason = e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300);
      return NextResponse.json({ error: `Server error: ${reason}`, code: "UPSTREAM_ERROR" }, { status: 500 });
    }
  };
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw badInput("Request body must be JSON.");
  }
}
