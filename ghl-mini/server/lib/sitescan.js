/**
 * Fetches a lead's website and works out what marketing tech is on it.
 *
 * The useful signal is not "do they have a site" but "are they already
 * spending money and measuring it":
 *
 *   Meta Pixel or Google Ads tag  -> proven ad budget. They pay for traffic.
 *   No tags at all                -> flying blind. Nothing is measured.
 *   Wix / GoDaddy / Weebly        -> DIY build, nobody is maintaining it.
 *   No mobile viewport            -> a problem you can demo on their phone.
 *   Dead or unreachable           -> they believe they have a site. They don't.
 */

import { findOwner } from './owner.js';
import { findEmails, pickOwnerEmail, CONTACT_PATHS } from './enrich.js';
import { detectTools } from './recovery.js';
import { detectInbound } from './inbound.js';

const UA = 'Mozilla/5.0 (compatible; ghl-mini site checker; +https://github.com/)';

/** The disclosure a franchise is legally obliged to publish. */
const FRANCHISE_COPY = [
  /independently owned and operated/i,
  /each (?:franchise|location|office) is independently/i,
  /franchise opportunit/i,
  /own a franchise/i,
  /\bfranchisee\b/i,
];
const MAX_BYTES = 900_000;

/** Each detector: a name, the patterns, and how to pull the account id out. */
const TAGS = [
  {
    key: 'meta_pixel',
    label: 'Meta Pixel',
    patterns: [/connect\.facebook\.net\/[a-z_]+\/fbevents\.js/i, /\bfbq\s*\(/i, /_fbq\b/i, /facebook\.com\/tr\?id=/i],
    id: [/fbq\s*\(\s*['"]init['"]\s*,\s*['"](\d{8,20})['"]/i, /facebook\.com\/tr\?id=(\d{8,20})/i],
  },
  {
    key: 'google_tag_manager',
    label: 'Google Tag Manager',
    patterns: [/googletagmanager\.com\/gtm\.js/i, /\bGTM-[A-Z0-9]{4,10}\b/],
    id: [/\b(GTM-[A-Z0-9]{4,10})\b/],
  },
  {
    key: 'google_analytics',
    label: 'Google Analytics 4',
    patterns: [/googletagmanager\.com\/gtag\/js/i, /\bG-[A-Z0-9]{8,12}\b/, /gtag\s*\(\s*['"]config['"]/i],
    id: [/\b(G-[A-Z0-9]{8,12})\b/],
  },
  {
    key: 'google_ads',
    label: 'Google Ads',
    patterns: [/\bAW-\d{9,12}\b/, /googleadservices\.com\/pagead\/conversion/i, /googleads\.g\.doubleclick\.net/i],
    id: [/\b(AW-\d{9,12})\b/],
  },
  {
    key: 'universal_analytics',
    label: 'Universal Analytics (retired)',
    patterns: [/google-analytics\.com\/(analytics|ga)\.js/i, /\bUA-\d{4,10}-\d{1,4}\b/],
    id: [/\b(UA-\d{4,10}-\d{1,4})\b/],
  },
  { key: 'tiktok_pixel', label: 'TikTok Pixel', patterns: [/analytics\.tiktok\.com/i, /\bttq\.(load|track)\b/i], id: [] },
  { key: 'linkedin_insight', label: 'LinkedIn Insight', patterns: [/snap\.licdn\.com/i, /_linkedin_partner_id/i], id: [] },
  { key: 'hotjar', label: 'Hotjar', patterns: [/static\.hotjar\.com/i, /\bhjid\b/i], id: [] },
  { key: 'clarity', label: 'Microsoft Clarity', patterns: [/clarity\.ms\/tag/i], id: [] },
];

/** Site builders, most specific first — WordPress last so it never wins early. */
const PLATFORMS = [
  { key: 'wix', label: 'Wix', patterns: [/static\.parastorage\.com/i, /_wixCIDX/i, /wix\.com\/website/i, /X-Wix-/i] },
  { key: 'squarespace', label: 'Squarespace', patterns: [/static1\.squarespace\.com/i, /squarespace\.com/i, /Squarespace\.afterBodyLoad/i] },
  { key: 'godaddy', label: 'GoDaddy Website Builder', patterns: [/img1\.wsimg\.com/i, /godaddy\.com\/websites/i, /nonprod-static\.godaddy/i] },
  { key: 'weebly', label: 'Weebly', patterns: [/editmysite\.com/i, /weebly\.com/i, /weeblycloud/i] },
  { key: 'duda', label: 'Duda', patterns: [/dudamobile\.com/i, /irp\.cdn-website\.com/i, /_dm_/i] },
  { key: 'webflow', label: 'Webflow', patterns: [/webflow\.com/i, /assets-global\.website-files\.com/i, /wf-/] },
  { key: 'shopify', label: 'Shopify', patterns: [/cdn\.shopify\.com/i, /Shopify\.theme/i, /myshopify\.com/i] },
  { key: 'google_business', label: 'Google Business Site', patterns: [/business\.site/i, /\.godaddysites\.com/i] },
  { key: 'wordpress', label: 'WordPress', patterns: [/wp-content\//i, /wp-includes\//i, /content="WordPress/i] },
];

/**
 * Look at one website. Never throws — an unreachable site is a result,
 * not an error, and often a better lead than a working one.
 */
export async function scanSite(url, opts = {}) {
  const { timeoutMs = 12000 } = opts;
  const result = {
    site_status: 'no_site',
    site_checked_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    tags: {},
    tag_ids: {},
    platform: null,
    has_ssl: 0,
    mobile_ready: 0,
    title: null,
    http_status: null,
    franchise_copy: false,
    owner: null,
    owner_email: null,
    emails: [],
    tools: null,
    inbound: null,
    pages_read: 0,
  };
  if (!url || !/^https?:\/\//i.test(String(url).trim())) return result;

  let res;
  let html = '';
  try {
    res = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    result.http_status = res.status;
    result.has_ssl = res.url.startsWith('https://') ? 1 : 0;

    if (!res.ok) {
      result.site_status = res.status >= 500 ? 'server_error' : 'not_found';
      return result;
    }
    html = await readCapped(res);
  } catch (err) {
    result.site_status = /timeout|abort/i.test(String(err.message)) ? 'timeout' : 'unreachable';
    return result;
  }

  if (!html.trim()) {
    result.site_status = 'empty';
    return result;
  }

  result.site_status = 'ok';
  // Header values count too: some tag managers only show up there.
  const haystack = html + '\n' + [...(res.headers || [])].map(([k, v]) => `${k}:${v}`).join('\n');

  for (const tag of TAGS) {
    if (!tag.patterns.some((re) => re.test(haystack))) continue;
    result.tags[tag.key] = tag.label;
    for (const re of tag.id) {
      const m = haystack.match(re);
      if (m) { result.tag_ids[tag.key] = m[1]; break; }
    }
  }

  const platform = PLATFORMS.find((p) => p.patterns.some((re) => re.test(haystack)));
  if (platform) result.platform = platform.key;

  result.franchise_copy = FRANCHISE_COPY.some((re) => re.test(html));
  result.tools = detectTools(haystack);
  result.inbound = detectInbound(haystack, res.url);
  result.pages_read = 1;

  // The page is already fetched, so working out who runs the place is free.
  result.owner = findOwner({ html, businessName: opts.businessName, email: opts.email }).best;

  let domain = null;
  try { domain = new URL(res.url).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
  const ownerName = result.owner?.name || null;

  let emails = findEmails(html, { ownerName, domain });
  let picked = pickOwnerEmail(emails);

  // A named person's address is almost never on the home page — it is on
  // Contact, About or the team page. Only go looking when the home page
  // did not already produce one.
  if (!picked.owner && opts.deep !== false) {
    for (const path of CONTACT_PATHS.slice(0, opts.maxPages ?? 4)) {
      const extra = await fetchPage(new URL(path, res.url).href, timeoutMs);
      if (!extra) continue;
      result.pages_read++;

      // A person named here beats one guessed from the business name.
      const deeperOwner = findOwner({ html: extra, businessName: opts.businessName, email: opts.email }).best;
      if (deeperOwner && (!result.owner || deeperOwner.confidence > result.owner.confidence)) {
        result.owner = deeperOwner;
      }

      const extraTools = detectTools(extra);
      for (const key of ['chat', 'booking', 'email', 'review']) {
        if (!result.tools[key] && extraTools[key]) result.tools[key] = extraTools[key];
      }
      const extraInbound = detectInbound(extra, res.url);
      for (const key of ['call_tracking', 'financing']) {
        if (!result.inbound[key] && extraInbound[key]) result.inbound[key] = extraInbound[key];
      }
      result.inbound.google_ads = result.inbound.google_ads || extraInbound.google_ads;
      result.inbound.conversion_tracking = result.inbound.conversion_tracking || extraInbound.conversion_tracking;
      result.inbound.review_widget = result.inbound.review_widget || extraInbound.review_widget;
      result.inbound.service_pages = Math.max(result.inbound.service_pages, extraInbound.service_pages);
      result.inbound.form_fields = Math.max(result.inbound.form_fields, extraInbound.form_fields);
      result.inbound.trust = [...new Set([...result.inbound.trust, ...extraInbound.trust])];

      result.tools.form = result.tools.form || extraTools.form;
      result.tools.click_to_call = result.tools.click_to_call || extraTools.click_to_call;

      const more = findEmails(extra, { ownerName: result.owner?.name || ownerName, domain });
      const merged = new Map([...emails, ...more].map((e) => [e.email, e]));
      emails = [...merged.values()].sort((a, b) => b.score - a.score);
      picked = pickOwnerEmail(emails);
      if (picked.owner) break;
    }
  }

  result.emails = emails;
  result.owner_email = picked.owner;
  result.mobile_ready = /<meta[^>]+name=["']viewport["'][^>]*>/i.test(html) ? 1 : 0;
  const title = html.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i);
  if (title) result.title = decodeEntities(title[1]).replace(/\s+/g, ' ').trim().slice(0, 160);

  return result;
}

/** One extra page, quietly. A 404 on /about is not worth reporting. */
async function fetchPage(url, timeoutMs) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(Math.min(timeoutMs, 9000)),
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (type && !/html/i.test(type)) return null;
    return await readCapped(res);
  } catch {
    return null;
  }
}

async function readCapped(res) {
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  reader.cancel().catch(() => {});
  return Buffer.concat(chunks.map(Buffer.from)).toString('utf8');
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
}

/** Does this business demonstrably pay for traffic? */
export const runsAds = (scan) =>
  Boolean(scan?.tags?.meta_pixel || scan?.tags?.google_ads || scan?.tags?.tiktok_pixel);

/** A live site measuring nothing at all. */
export const noTracking = (scan) =>
  scan?.site_status === 'ok' && Object.keys(scan?.tags || {}).length === 0;

/** A one-line reason to pick up the phone. */
export function pitchAngle(lead, scan) {
  if (!lead.website) return 'No website at all — nowhere for a search to land.';
  if (['unreachable', 'timeout', 'server_error', 'not_found'].includes(scan?.site_status)) {
    return 'Their website is down. They almost certainly do not know.';
  }
  if (runsAds(scan) && scan.platform && ['wix', 'godaddy', 'weebly', 'google_business'].includes(scan.platform)) {
    return 'Paying for ads, sending them to a DIY site. Money in, nothing out.';
  }
  if (runsAds(scan)) return 'Already buying traffic, so the budget exists. Ask what it converts at.';
  // Mobile beats analytics as an opener: you can show them on their own
  // phone while you are talking. "No tracking" is true but abstract.
  if (!scan?.mobile_ready) return 'Not built for phones, and that is most of their traffic. Show them live.';
  if (noTracking(scan)) return 'No pixel, no analytics. They cannot tell you what their site earns.';
  if (!scan?.has_ssl) {
    return 'No security certificate, so Chrome shows "Not secure" next to their address. Ask if they knew.';
  }
  return 'Has a site and tracks it — lead with speed and conversion, not existence.';
}

export { TAGS, PLATFORMS };
