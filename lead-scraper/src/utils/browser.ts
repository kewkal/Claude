/**
 * One browser for the whole run, one isolated context per page fetch.
 *
 * Launching Chromium costs ~300ms and ~80MB; doing that per lead is the single
 * easiest way to make a crawler slow. A shared browser with per-fetch contexts
 * gives isolation (cookies, storage) without the launch cost.
 *
 * The browser is created lazily: a run where every site renders server-side
 * never launches Chromium at all.
 */

import { chromium, type Browser, type BrowserContext } from 'playwright';

import { HTTP } from '../config.js';
import { describeError, log } from './logger.js';

export interface RenderedPage {
  url: string;
  html: string;
}

export class BrowserPool {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private closed = false;

  constructor(private readonly headless: boolean) {}

  private async launch(): Promise<Browser> {
    if (this.browser) return this.browser;
    if (this.closed) throw new Error('Browser pool is closed');
    this.launching ??= chromium
      .launch({ headless: this.headless, args: ['--disable-dev-shm-usage'] })
      .then((browser) => {
        this.browser = browser;
        log.debug('launched shared Chromium instance');
        return browser;
      })
      .finally(() => {
        this.launching = null;
      });
    return this.launching;
  }

  /** True once Chromium has actually been started, for the run summary. */
  get isActive(): boolean {
    return this.browser !== null;
  }

  /**
   * Render one URL and return its HTML. The context is always torn down,
   * including on navigation failure.
   */
  async render(url: string, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<RenderedPage> {
    const browser = await this.launch();
    let context: BrowserContext | null = null;
    try {
      context = await browser.newContext({
        userAgent: HTTP.userAgent,
        javaScriptEnabled: true,
        locale: 'en-US',
        viewport: { width: 1366, height: 900 },
      });
      context.setDefaultNavigationTimeout(options.timeoutMs ?? HTTP.navigationTimeoutMs);
      context.setDefaultTimeout(options.timeoutMs ?? HTTP.navigationTimeoutMs);

      // Images and fonts are pure cost for a text-extraction crawler.
      await context.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (type === 'image' || type === 'font' || type === 'media') {
          void route.abort();
        } else {
          void route.continue();
        }
      });

      const page = await context.newPage();
      const abortHandler = (): void => {
        void page.close().catch(() => undefined);
      };
      options.signal?.addEventListener('abort', abortHandler, { once: true });

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        // Give client-side rendering a moment, but never block on a chatty page.
        await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
        const html = await page.content();
        return { url: page.url(), html };
      } finally {
        options.signal?.removeEventListener('abort', abortHandler);
      }
    } finally {
      if (context) await context.close().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    const browser = this.browser;
    this.browser = null;
    if (!browser) return;
    try {
      await browser.close();
      log.debug('closed shared Chromium instance');
    } catch (error) {
      log.debug(`browser close failed: ${describeError(error)}`);
    }
  }
}
