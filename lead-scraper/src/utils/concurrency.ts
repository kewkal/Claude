/**
 * Bounded concurrency helpers plus the per-host pacer.
 *
 * `p-limit` handles the "N at a time" part; the pacer handles the "and don't
 * hammer any single host" part, which limiting alone does not give you.
 */

import pLimit from 'p-limit';

import { sleep } from './normalise.js';

export interface Pool {
  /** Run `task` when a slot frees up. */
  run<T>(task: () => Promise<T>): Promise<T>;
  /** Tasks currently running plus queued. */
  pending(): number;
}

export function createPool(concurrency: number): Pool {
  const limit = pLimit(Math.max(1, Math.floor(concurrency)));
  return {
    run: (task) => limit(task),
    pending: () => limit.activeCount + limit.pendingCount,
  };
}

/**
 * Serialises requests per host and enforces a minimum gap between them.
 * The gap can be raised at runtime (e.g. by robots.txt Crawl-delay or a 429).
 */
export class HostPacer {
  private readonly nextAllowedAt = new Map<string, number>();
  private readonly delays = new Map<string, number>();
  private readonly chains = new Map<string, Promise<void>>();

  constructor(private readonly defaultDelayMs: number) {}

  setDelay(host: string, delayMs: number): void {
    const current = this.delays.get(host) ?? this.defaultDelayMs;
    this.delays.set(host, Math.max(current, delayMs));
  }

  getDelay(host: string): number {
    return this.delays.get(host) ?? this.defaultDelayMs;
  }

  /** Resolve once it is this caller's turn to hit `host`. */
  async acquire(host: string, signal?: AbortSignal): Promise<void> {
    const previous = this.chains.get(host) ?? Promise.resolve();
    let release: () => void = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.chains.set(
      host,
      previous.then(() => current),
    );

    await previous;

    const delay = this.getDelay(host);
    const waitUntil = this.nextAllowedAt.get(host) ?? 0;
    const waitMs = waitUntil - Date.now();
    if (waitMs > 0) await sleep(waitMs, signal);
    this.nextAllowedAt.set(host, Date.now() + delay);

    // Release the next queued caller on the following tick so the gap is real.
    setTimeout(release, 0);
  }
}

/**
 * Race a promise against a timeout. Used where a library gives no timeout
 * option of its own; the underlying work is still cancelled via the AbortSignal
 * that callers pass in alongside.
 */
export async function withTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string,
  externalSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const onExternalAbort = (): void => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

  const timer = setTimeout(() => controller.abort(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    return await work(controller.signal);
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}
