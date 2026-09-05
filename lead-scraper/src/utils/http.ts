/**
 * The single HTTP client for the whole app: discovery sources and the site
 * crawler both go through here, so pacing, retry policy and error
 * classification are defined once.
 *
 * Retry policy, deliberately narrow:
 *   404 / 401 / 403 / 410  -> permanent, never retried
 *   429 / 408 / 5xx        -> retried up to HTTP.maxRetries with jittered backoff
 *   access-control page    -> permanent, never retried (no CAPTCHA loops)
 *   network/timeout        -> retried
 */

import { ACCESS_CONTROL_MARKERS, HTTP } from '../config.js';
import type { HostPacer } from './concurrency.js';
import { log } from './logger.js';
import { backoffDelay, sleep } from './normalise.js';

export type FetchFailureKind =
  | 'permanent'
  | 'rate-limited'
  | 'server-error'
  | 'network'
  | 'timeout'
  | 'access-control'
  | 'unsupported-content'
  | 'aborted';

export class FetchError extends Error {
  constructor(
    message: string,
    readonly kind: FetchFailureKind,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'FetchError';
  }
}

export interface FetchTextResult {
  /** Final URL after redirects. */
  url: string;
  status: number;
  contentType: string;
  body: string;
}

export interface FetchOptions {
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  body?: string;
  /** Set false for endpoints that legitimately return JSON (discovery APIs). */
  expectHtml?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
  signal?: AbortSignal;
  pacer?: HostPacer;
}

const PERMANENT_STATUSES = new Set([400, 401, 402, 403, 404, 405, 406, 410, 451]);

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** `Retry-After` may be seconds or an HTTP date. Returns ms, or null. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const asDate = Date.parse(trimmed);
  if (Number.isNaN(asDate)) return null;
  return Math.max(0, asDate - now);
}

/** Heuristic: does this body look like a bot-check interstitial rather than content? */
export function looksLikeAccessControl(body: string, status: number): boolean {
  if (body.length > 200_000) return false; // real pages are big; interstitials are not
  const haystack = body.slice(0, 20_000).toLowerCase();
  const hit = ACCESS_CONTROL_MARKERS.some((marker) => haystack.includes(marker));
  if (!hit) return false;
  // A page that merely mentions "captcha" in a form is fine if it also has real content.
  return status === 403 || status === 429 || body.length < 30_000;
}

function isRetryable(kind: FetchFailureKind): boolean {
  return kind === 'rate-limited' || kind === 'server-error' || kind === 'network' || kind === 'timeout';
}

async function readBounded(response: Response, maxBytes: number): Promise<string> {
  // The DOM lib types `getReader()` loosely; pin it so the chunks stay typed.
  const reader = response.body?.getReader() as ReadableStreamDefaultReader<Uint8Array> | undefined;
  if (!reader) return await response.text();

  const decoder = new TextDecoder('utf-8', { fatal: false });
  let received = 0;
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (received >= maxBytes) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  out += decoder.decode();
  return out;
}

async function attempt(url: string, options: FetchOptions): Promise<FetchTextResult> {
  const timeoutMs = options.timeoutMs ?? HTTP.requestTimeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  const onExternalAbort = (): void => controller.abort(new Error('aborted'));
  options.signal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        'user-agent': HTTP.userAgent,
        accept: options.expectHtml === false ? 'application/json,text/plain,*/*' : 'text/html,application/xhtml+xml',
        'accept-language': 'en-US,en;q=0.9',
        ...options.headers,
      },
      body: options.body,
      redirect: 'follow',
      signal: controller.signal,
    });

    const contentType = response.headers.get('content-type') ?? '';

    if (!response.ok) {
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
      const body = await readBounded(response, 50_000).catch(() => '');
      if (looksLikeAccessControl(body, response.status)) {
        throw new FetchError(`Access-control page at ${url}`, 'access-control', response.status);
      }
      if (response.status === 429) {
        const error = new FetchError(`HTTP 429 from ${url}`, 'rate-limited', 429);
        (error as FetchError & { retryAfterMs?: number }).retryAfterMs = retryAfterMs ?? undefined;
        throw error;
      }
      if (PERMANENT_STATUSES.has(response.status)) {
        throw new FetchError(`HTTP ${response.status} from ${url}`, 'permanent', response.status);
      }
      if (response.status >= 500) {
        throw new FetchError(`HTTP ${response.status} from ${url}`, 'server-error', response.status);
      }
      throw new FetchError(`HTTP ${response.status} from ${url}`, 'permanent', response.status);
    }

    if (options.expectHtml !== false && contentType !== '' && !/text\/html|xhtml|text\/plain/i.test(contentType)) {
      await response.body?.cancel().catch(() => undefined);
      throw new FetchError(`Unsupported content-type "${contentType}" at ${url}`, 'unsupported-content', response.status);
    }

    const body = await readBounded(response, HTTP.maxBodyBytes);
    if (options.expectHtml !== false && looksLikeAccessControl(body, response.status)) {
      throw new FetchError(`Access-control page at ${url}`, 'access-control', response.status);
    }

    return { url: response.url === '' ? url : response.url, status: response.status, contentType, body };
  } catch (error) {
    if (error instanceof FetchError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (options.signal?.aborted) throw new FetchError(`Aborted: ${url}`, 'aborted', undefined, { cause: error });
    if (/timeout|abort/i.test(message)) {
      throw new FetchError(`Timeout after ${timeoutMs}ms: ${url}`, 'timeout', undefined, { cause: error });
    }
    throw new FetchError(`Network error for ${url}: ${message}`, 'network', undefined, { cause: error });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * Fetch with pacing, bounded retries and jittered backoff.
 * Throws a FetchError whose `kind` tells the caller how to react.
 */
export async function fetchText(url: string, options: FetchOptions = {}): Promise<FetchTextResult> {
  const maxRetries = options.maxRetries ?? HTTP.maxRetries;
  const host = hostOf(url);
  let lastError: FetchError | undefined;

  for (let attemptIndex = 0; attemptIndex <= maxRetries; attemptIndex += 1) {
    if (options.signal?.aborted) throw new FetchError(`Aborted before request: ${url}`, 'aborted');
    if (options.pacer) await options.pacer.acquire(host, options.signal);

    try {
      return await attempt(url, options);
    } catch (error) {
      const fetchError = error instanceof FetchError ? error : new FetchError(String(error), 'network');
      lastError = fetchError;

      if (!isRetryable(fetchError.kind) || attemptIndex === maxRetries) throw fetchError;

      const retryAfterMs = (fetchError as FetchError & { retryAfterMs?: number }).retryAfterMs;
      let waitMs = backoffDelay(attemptIndex, HTTP.backoffBaseMs, HTTP.backoffMaxMs);
      if (typeof retryAfterMs === 'number') {
        if (retryAfterMs > HTTP.maxHonouredRetryAfterMs) {
          throw new FetchError(
            `${host} asked for a ${Math.round(retryAfterMs / 1000)}s cool-off; giving up`,
            'rate-limited',
            fetchError.status,
          );
        }
        waitMs = Math.max(waitMs, retryAfterMs);
        // Respect the signal for the rest of the run, not just this request.
        options.pacer?.setDelay(host, Math.min(retryAfterMs, HTTP.backoffMaxMs));
      }

      log.debug(`retry ${attemptIndex + 1}/${maxRetries} for ${url} in ${waitMs}ms (${fetchError.kind})`);
      await sleep(waitMs, options.signal);
    }
  }

  throw lastError ?? new FetchError(`Failed to fetch ${url}`, 'network');
}

/** Convenience wrapper for JSON APIs. */
export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const result = await fetchText(url, { ...options, expectHtml: false });
  try {
    return JSON.parse(result.body) as T;
  } catch (error) {
    throw new FetchError(`Invalid JSON from ${url}`, 'permanent', result.status, { cause: error });
  }
}
