import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

// Per-request flags that deep library code (the SerpApi/Claude gates) needs
// without threading them through every function signature.
export interface RequestContext {
  /** The user confirmed this request may exceed the SerpApi quota (override must also be on). */
  confirmOverQuota: boolean;
  /** Same for the Claude monthly budget. */
  confirmOverBudget: boolean;
}

const als = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
  return als.run(ctx, fn);
}

export function getContext(): RequestContext {
  return als.getStore() ?? { confirmOverQuota: false, confirmOverBudget: false };
}
