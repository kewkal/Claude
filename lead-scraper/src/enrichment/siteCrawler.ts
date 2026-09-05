/**
 * Navigation only: which pages to fetch, in what order, and how to get the HTML.
 * Nothing in here interprets page content — that is the parser's job.
 *
 * Fetch strategy is a two-tier hybrid:
 *   1. plain HTTP + the parser (cheap, covers most business websites)
 *   2. Playwright, but only when tier 1 comes back looking like an empty SPA shell
 * The browser is shared across the whole run and lazily launched, so a run of
 * server-rendered sites never starts Chromium at all.
 */

import robotsParserModule from 'robots-parser';

import { HTTP, NON_HTML_EXTENSIONS, PAGE_EXCLUDE_PATTERNS, PAGE_PRIORITY_KEYWORDS } from '../config.js';
import { extractLinks, looksLikeSpaShell, parseHtml, type Doc } from '../parsers/htmlParser.js';
import type { BrowserPool } from '../utils/browser.js';
import type { HostPacer } from '../utils/concurrency.js';
import { FetchError, fetchText } from '../utils/http.js';
import { describeError, log } from '../utils/logger.js';
import { canonicaliseUrl, foldCase, isCrawlableHost, isSameSite } from '../utils/normalise.js';

export interface CrawledPage {
  url: string;
  html: string;
  doc: Doc;
  /** True when this URL scored as an about/team/leadership page. */
  isPeoplePage: boolean;
  /** True when this URL scored as a services page. */
  isServicePage: boolean;
  renderedWithBrowser: boolean;
}

export interface CrawlResult {
  /** The site's canonical entry point after redirects, or null if unreachable. */
  canonicalWebsite: string | null;
  pages: CrawledPage[];
  errors: string[];
}

export interface CrawlOptions {
  maxPages: number;
  pacer: HostPacer;
  browser: BrowserPool;
  signal?: AbortSignal;
}

/** The slice of robots-parser's API we actually use. */
interface Robot {
  isAllowed(url: string, ua?: string): boolean | undefined;
  getCrawlDelay(ua?: string): number | undefined;
}

/**
 * robots-parser is CommonJS with an ESM-style default export. Under NodeNext the
 * types resolve to a namespace, while Node hands us the function itself at runtime.
 */
const parseRobots = robotsParserModule as unknown as (url: string, robotsTxt: string) => Robot;

const PEOPLE_KEYWORDS = ['about', 'team', 'leadership', 'staff', 'story', 'who-we-are', 'doctors', 'management', 'company'];
const SERVICE_KEYWORDS = ['service', 'solution', 'what-we-do', 'treatment', 'procedure', 'specialt', 'capabilit'];

/** Priority score for a candidate page; higher is crawled sooner. 0 means "skip". */
export function scoreUrl(url: string, anchorText: string): number {
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();

  if (path === '/' || path === '') return 5; // homepage, handled separately
  if (PAGE_EXCLUDE_PATTERNS.some((pattern) => path.includes(pattern))) return 0;
  if (NON_HTML_EXTENSIONS.some((extension) => path.endsWith(extension))) return 0;
  // Deep archives and dated URLs are almost always blog content.
  if (/\/\d{4}\/\d{2}\//.test(path)) return 0;
  if (path.split('/').filter(Boolean).length > 4) return 0;

  const haystack = `${path} ${foldCase(anchorText)}`;
  let score = 0;
  for (const { keyword, score: keywordScore } of PAGE_PRIORITY_KEYWORDS) {
    if (haystack.includes(keyword)) score = Math.max(score, keywordScore);
  }
  // Shallow pages are more likely to be the real about/services page.
  if (score > 0 && path.split('/').filter(Boolean).length === 1) score += 5;
  return score;
}

export function isPeopleUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return PEOPLE_KEYWORDS.some((keyword) => lower.includes(keyword));
}

export function isServiceUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return SERVICE_KEYWORDS.some((keyword) => lower.includes(keyword));
}

/** Fetch and parse robots.txt. A missing or broken file means "no restrictions". */
async function loadRobots(origin: string, options: CrawlOptions): Promise<Robot | null> {
  const robotsUrl = `${origin}/robots.txt`;
  try {
    const result = await fetchText(robotsUrl, {
      expectHtml: false,
      pacer: options.pacer,
      signal: options.signal,
      maxRetries: 0,
      timeoutMs: 8_000,
    });
    return parseRobots(robotsUrl, result.body);
  } catch (error) {
    log.debug(`no usable robots.txt at ${robotsUrl}: ${describeError(error)}`);
    return null;
  }
}

/**
 * Fetch one page. Plain HTTP first; escalate to a rendered browser page only
 * when the HTML we got back has essentially no content.
 */
async function fetchPage(
  url: string,
  options: CrawlOptions,
): Promise<{ url: string; html: string; rendered: boolean }> {
  let httpHtml: string | null = null;
  let httpUrl = url;
  let httpError: unknown = null;

  try {
    const result = await fetchText(url, { pacer: options.pacer, signal: options.signal });
    httpHtml = result.body;
    httpUrl = result.url;
    if (!looksLikeSpaShell(httpHtml)) return { url: httpUrl, html: httpHtml, rendered: false };
    log.debug(`${url} looks client-rendered; escalating to a browser`);
  } catch (error) {
    httpError = error;
    // A hard block or a missing page will not render any better in a browser.
    if (error instanceof FetchError && (error.kind === 'permanent' || error.kind === 'access-control' || error.kind === 'aborted')) {
      throw error;
    }
    log.debug(`plain fetch failed for ${url} (${describeError(error)}); trying a browser`);
  }

  try {
    await options.pacer.acquire(new URL(url).host, options.signal);
    const rendered = await options.browser.render(url, {
      timeoutMs: HTTP.navigationTimeoutMs,
      signal: options.signal,
    });
    return { url: rendered.url, html: rendered.html, rendered: true };
  } catch (error) {
    // If HTTP gave us *something*, a thin page beats no page at all.
    if (httpHtml !== null) return { url: httpUrl, html: httpHtml, rendered: false };
    throw httpError ?? error;
  }
}

/**
 * Crawl a business website: homepage first, then the highest-scoring internal
 * pages, never leaving the registrable domain and never exceeding `maxPages`.
 */
export async function crawlSite(website: string, options: CrawlOptions): Promise<CrawlResult> {
  const errors: string[] = [];
  const start = canonicaliseUrl(website);
  if (!start || !isCrawlableHost(start)) {
    return { canonicalWebsite: null, pages: [], errors: [`Unusable website URL: ${website}`] };
  }

  const origin = new URL(start).origin;
  const robots = await loadRobots(origin, options);
  if (robots) {
    const crawlDelay = robots.getCrawlDelay(HTTP.userAgent);
    if (typeof crawlDelay === 'number' && crawlDelay > 0) {
      options.pacer.setDelay(new URL(start).host, Math.min(crawlDelay * 1000, 15_000));
      log.debug(`${origin} requests a ${crawlDelay}s crawl delay`);
    }
  }

  const allowed = (url: string): boolean => {
    if (!robots) return true;
    const verdict = robots.isAllowed(url, HTTP.userAgent);
    return verdict !== false; // undefined means "no rule", which is allowed
  };

  const pages: CrawledPage[] = [];
  const visited = new Set<string>();
  /** url -> best score seen so far. */
  const queue = new Map<string, number>();

  const enqueue = (url: string, anchorText: string): void => {
    const canonical = canonicaliseUrl(url);
    if (!canonical || visited.has(canonical) || !isSameSite(canonical, start)) return;
    const score = scoreUrl(canonical, anchorText);
    if (score <= 0) return;
    queue.set(canonical, Math.max(queue.get(canonical) ?? 0, score));
  };

  let canonicalWebsite: string | null = null;
  let current: string | null = start;

  while (current !== null && pages.length < options.maxPages) {
    const url: string = current;
    visited.add(url);

    if (!allowed(url)) {
      errors.push(`robots.txt disallows ${url}`);
      log.debug(`skipping ${url}: disallowed by robots.txt`);
    } else {
      try {
        const fetched = await fetchPage(url, options);
        const doc = parseHtml(fetched.html);
        canonicalWebsite ??= canonicaliseUrl(fetched.url) ?? url;

        pages.push({
          url: fetched.url,
          html: fetched.html,
          doc,
          isPeoplePage: isPeopleUrl(fetched.url),
          isServicePage: isServiceUrl(fetched.url),
          renderedWithBrowser: fetched.rendered,
        });
        visited.add(canonicaliseUrl(fetched.url) ?? fetched.url);

        for (const link of extractLinks(doc, fetched.url)) enqueue(link.url, link.text);
      } catch (error) {
        const message = describeError(error);
        errors.push(`${url}: ${message}`);
        // The homepage failing is fatal for this site; an inner page is not.
        if (pages.length === 0 && url === start) break;
        if (error instanceof FetchError && (error.kind === 'access-control' || error.kind === 'aborted')) {
          errors.push(`abandoning ${origin}: ${error.kind}`);
          break;
        }
      }
    }

    if (options.signal?.aborted) break;

    // Take the best-scoring page we have not visited yet.
    let next: string | null = null;
    let bestScore = 0;
    for (const [candidate, score] of queue) {
      if (visited.has(candidate)) {
        queue.delete(candidate);
        continue;
      }
      if (score > bestScore) {
        bestScore = score;
        next = candidate;
      }
    }
    if (next !== null) queue.delete(next);
    current = next;
  }

  return { canonicalWebsite, pages, errors };
}
