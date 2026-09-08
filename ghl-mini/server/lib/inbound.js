/**
 * Scores a lead against the Inbound Revenue System — three components,
 * scored separately, because which one is weakest decides the pitch.
 *
 *   1. Capture   Google Search campaigns, service landing pages, mobile
 *                call and booking paths, call and form conversion tracking.
 *   2. Convert   Landing page CRO, service-specific offers, trust,
 *                financing, review placement, short forms.
 *   3. Recover   Missed-call text-back, unbooked lead follow-up,
 *                reminders, unsold estimates, lapsed customers.
 *
 * The best lead is a business already buying traffic that cannot tell you
 * what it returns. They have budget, they have committed to the channel,
 * and the money is already leaving — which is a very different
 * conversation from persuading someone to start.
 */

const find = (hay, table) => {
  const hit = table.find(([, re]) => re.test(hay));
  return hit ? hit[0] : null;
};

// --- Component 1: capture ---------------------------------------------

/** Call tracking. Without it, calls cannot be optimised toward. */
const CALL_TRACKING = [
  ['callrail', /callrail\.com|cdn\.callrail/i],
  ['calltrackingmetrics', /calltrackingmetrics\.com|tctm\.co/i],
  ['whatconverts', /whatconverts\.com/i],
  ['invoca', /invoca\.net|invocacdn/i],
  ['marchex', /marchex\.(com|io)/i],
  ['nimbata', /nimbata\.com/i],
  ['phonewagon', /phonewagon\.com/i],
  ['ringba', /ringba\.com/i],
  ['servicetitan tracking', /servicetitan\.com\/tracking/i],
];

/** Google Ads present at all. */
const GOOGLE_ADS = /\bAW-\d{9,12}\b|googleadservices\.com\/pagead\/conversion|googleads\.g\.doubleclick\.net/i;
/** A conversion actually being reported back, not just the tag sitting there. */
const CONVERSION_SNIPPET = /gtag\s*\(\s*['"]event['"]\s*,\s*['"]conversion['"]|send_to\s*:\s*['"]AW-|google_conversion_id|gtag_report_conversion/i;
/** Enhanced conversions / offline import groundwork. */
const ENHANCED_CONVERSIONS = /enhanced_conversion|user_data\s*:|allow_enhanced_conversions|gtag\s*\(\s*['"]set['"]\s*,\s*['"]user_data['"]/i;

// --- Component 2: convert ---------------------------------------------

/** Consumer financing — the single biggest ticket-lifter in home services. */
const FINANCING = [
  ['wisetack', /wisetack\.(com|us)/i],
  ['greensky', /greensky(credit)?\.com/i],
  ['acorn finance', /acornfinance\.com/i],
  ['hearth', /gethearth\.com|hearth\.com/i],
  ['synchrony', /synchrony(financial)?\.com/i],
  ['service finance', /svcfin\.com|servicefinanceco/i],
  ['affirm', /affirm\.com/i],
  ['klarna', /klarna\.com/i],
  ['sunbit', /sunbit\.com/i],
];

/** Reviews shown on the page, not just held on Google. */
const REVIEW_WIDGET = /birdeye|nicejob|trustindex|elfsight.*review|reviews\.io|shopper approved|grade\.us|widget.*google.*review|trustpilot/i;

const TRUST_WORDS = [
  [/licen[cs]ed/i, 'licensed'],
  [/insured/i, 'insured'],
  [/bonded/i, 'bonded'],
  [/\bbbb\b|better business bureau/i, 'BBB'],
  [/warrant(y|ies)/i, 'warranty'],
  [/guarantee/i, 'guarantee'],
  [/\b(?:since|est\.?)\s*(?:19|20)\d{2}/i, 'years in business'],
];

/** Counts fields on the biggest form. Long forms cost conversions. */
function formFieldCount(html) {
  const forms = String(html).match(/<form[\s\S]{0,6000}?<\/form>/gi) || [];
  let most = 0;
  for (const form of forms) {
    const fields = (form.match(/<(?:input|select|textarea)\b/gi) || []).filter(
      (_, i) => !/type=["'](?:hidden|submit|button)["']/i.test(form.split(/<(?:input|select|textarea)\b/i)[i + 1] || '')
    );
    const visible = (form.match(/<(?:input|select|textarea)\b(?![^>]*type=["'](?:hidden|submit|button)["'])/gi) || []).length;
    most = Math.max(most, visible, fields.length ? 0 : 0);
  }
  return most;
}

/**
 * Do they have service-specific pages, or one page that says everything?
 * Google Search needs a page per service to hold quality score up.
 */
function servicePageCount(html, baseUrl) {
  const hrefs = [...String(html).matchAll(/href=["']([^"'#?]+)/gi)].map((m) => m[1].toLowerCase());
  const SERVICE_HINT = /\/(?:services?|repair|installation|install|replacement|emergency|maintenance|tune-?up|cleaning|inspection|financing)\//;
  const seen = new Set();
  for (const href of hrefs) {
    if (/^(?:https?:)?\/\//.test(href) && baseUrl && !href.includes(new URL(baseUrl).hostname)) continue;
    if (SERVICE_HINT.test(href) || /\/(?:ac|heating|furnace|plumbing|roofing|drain|sewer|water-heater|electrical|panel|duct|gutter|siding|window)[-/]/.test(href)) {
      seen.add(href.replace(/\/$/, ''));
    }
  }
  return seen.size;
}

/** Everything the three components need, read off one page. */
export function detectInbound(html, baseUrl = null) {
  const h = String(html || '');
  const hasAds = GOOGLE_ADS.test(h);
  return {
    // capture
    call_tracking: find(h, CALL_TRACKING),
    google_ads: hasAds,
    conversion_tracking: hasAds && CONVERSION_SNIPPET.test(h),
    enhanced_conversions: ENHANCED_CONVERSIONS.test(h),
    service_pages: servicePageCount(h, baseUrl),
    // convert
    financing: find(h, FINANCING),
    review_widget: REVIEW_WIDGET.test(h),
    trust: TRUST_WORDS.filter(([re]) => re.test(h)).map(([, name]) => name),
    form_fields: formFieldCount(h),
  };
}

/**
 * Three component scores out of 100 each, where high means "big gap you
 * can fill", plus the overall lead score.
 */
export function scoreInbound(lead, signals = null, leadWith = 'recover') {
  const s = signals || {
    call_tracking: lead.inbound_call_tracking,
    google_ads: lead.has_google_ads === 1 || lead.runs_ads === 1,
    conversion_tracking: lead.inbound_conversion_tracking === 1,
    enhanced_conversions: lead.inbound_enhanced_conversions === 1,
    service_pages: lead.inbound_service_pages ?? 0,
    financing: lead.inbound_financing,
    review_widget: lead.inbound_review_widget === 1,
    trust: JSON.parse(lead.inbound_trust || '[]'),
    form_fields: lead.inbound_form_fields ?? 0,
  };

  const reviews = Number(lead.review_count) || 0;
  const scanned = Boolean(lead.site_status) || Boolean(signals);
  const siteBroken = ['unreachable', 'timeout', 'server_error', 'not_found'].includes(lead.site_status);
  const noSite = !lead.website;

  const capture = { score: 0, gaps: [], strengths: [] };
  const convert = { score: 0, gaps: [], strengths: [] };
  const recover = { score: 0, gaps: [], strengths: [] };

  // --- 1. Capture ---------------------------------------------------
  if (noSite) {
    capture.score = 100;
    capture.gaps.push('No website, so there is nothing to send paid traffic to');
  } else if (siteBroken) {
    capture.score = 95;
    capture.gaps.push('Their website is down — any ad spend right now is burning');
  } else if (!scanned) {
    capture.score = 50;
    capture.gaps.push('Not checked yet');
  } else {
    if (s.google_ads) {
      capture.strengths.push('Already buying Google traffic — the budget exists and the channel is proven to them');
      if (!s.conversion_tracking) {
        capture.score += 45;
        capture.gaps.push('Running Google Ads with no conversion tracking firing — they are optimising on nothing');
      } else {
        capture.strengths.push('Conversion tracking is live');
        if (!s.enhanced_conversions) {
          capture.score += 12;
          capture.gaps.push('No enhanced conversions, so no path to feeding sold jobs back to Google');
        }
      }
    } else {
      capture.score += 22;
      capture.gaps.push('No Google Ads at all — demand is being left to whoever does bid');
    }

    if (!s.call_tracking) {
      capture.score += 30;
      capture.gaps.push(
        s.google_ads
          ? 'No call tracking, and calls are how this trade actually converts — the best half of their spend is invisible'
          : 'No call tracking, so nobody knows which marketing makes the phone ring'
      );
    } else {
      capture.strengths.push(`Call tracking via ${s.call_tracking}`);
    }

    if (s.service_pages === 0) {
      capture.score += 18;
      capture.gaps.push('One page covering every service — nothing for a specific search to land on');
    } else if (s.service_pages < 3) {
      capture.score += 10;
      capture.gaps.push(`Only ${s.service_pages} service page(s); each service needs its own`);
    } else {
      capture.strengths.push(`${s.service_pages} service-specific pages`);
    }
  }

  // --- 2. Convert ---------------------------------------------------
  if (noSite) {
    convert.score = 100;
    convert.gaps.push('No landing page, so nothing to convert on');
  } else if (siteBroken) {
    convert.score = 95;
    convert.gaps.push('Nothing loads, so nothing converts');
  } else if (!scanned) {
    convert.score = 50;
    convert.gaps.push('Not checked yet');
  } else {
    if (lead.mobile_ready === 0) {
      convert.score += 25;
      convert.gaps.push('Not built for phones, which is where the calls come from');
    }
    if (lead.has_ssl === 0) {
      convert.score += 12;
      convert.gaps.push('No certificate — Chrome warns people off before they read anything');
    }
    if (!lead.recovery_click_to_call) {
      convert.score += 15;
      convert.gaps.push('Phone number is not tappable');
    }
    if (!s.financing) {
      convert.score += 20;
      convert.gaps.push('No financing offered — the single biggest lift on a large ticket');
    } else {
      convert.strengths.push(`Financing via ${s.financing}`);
    }
    if (!s.review_widget) {
      convert.score += 14;
      convert.gaps.push('Reviews sit on Google and never appear where the decision is made');
    } else {
      convert.strengths.push('Reviews shown on the page');
    }
    if (s.trust.length < 2) {
      convert.score += 10;
      convert.gaps.push('Little trust proof on the page — no licence, insurance or warranty language');
    } else {
      convert.strengths.push(`Trust signals: ${s.trust.join(', ')}`);
    }
    if (s.form_fields > 6) {
      convert.score += 12;
      convert.gaps.push(`Enquiry form asks ${s.form_fields} questions; every field past four costs conversions`);
    } else if (s.form_fields === 0 && !lead.recovery_form) {
      convert.score += 14;
      convert.gaps.push('No enquiry form at all');
    }
  }

  // --- 3. Recover ---------------------------------------------------
  if (noSite || siteBroken) {
    recover.score = 85;
    recover.gaps.push('Nothing catches anyone who does not get through');
  } else if (!scanned) {
    recover.score = 50;
    recover.gaps.push('Not checked yet');
  } else {
    if (!lead.recovery_chat) {
      recover.score += 38;
      recover.gaps.push('No missed-call text-back or chat — an unanswered call is simply a lost job');
    } else {
      recover.strengths.push(`Already running ${lead.recovery_chat}`);
    }
    if (!lead.recovery_email_tool) {
      recover.score += 32;
      recover.gaps.push(
        reviews >= 100
          ? `No email marketing, with ${reviews}+ past customers never contacted again`
          : 'No email marketing — unsold estimates and lapsed customers are never followed up'
      );
    } else {
      recover.strengths.push(`Email via ${lead.recovery_email_tool}`);
    }
    if (!lead.recovery_booking) {
      recover.score += 20;
      recover.gaps.push('No online booking, so reminders and no-show recovery are manual or absent');
    } else {
      recover.strengths.push(`Booking via ${lead.recovery_booking}`);
    }
  }

  for (const c of [capture, convert, recover]) c.score = Math.max(0, Math.min(100, Math.round(c.score)));

  // --- Overall ------------------------------------------------------
  // Component 3 leads the sale, so the score answers "how good is the
  // recovery conversation" first. Capture still carries weight because
  // an existing ad budget is what makes recovered opportunities PAID
  // ones — and it is the expansion after the first engagement lands.
  const WEIGHTS = {
    recover: { recover: 0.55, capture: 0.30, convert: 0.15 },
    capture: { recover: 0.25, capture: 0.55, convert: 0.20 },
    convert: { recover: 0.25, capture: 0.30, convert: 0.45 },
    system: { recover: 0.34, capture: 0.36, convert: 0.30 },
  };
  const w = WEIGHTS[leadWith] || WEIGHTS.recover;
  let overall = capture.score * w.capture + convert.score * w.convert + recover.score * w.recover;

  // Volume decides whether any of it is worth money.
  const volumeFactor = reviews >= 300 ? 1.0 : reviews >= 150 ? 0.97 : reviews >= 75 ? 0.92
    : reviews >= 30 ? 0.82 : reviews >= 10 ? 0.66 : 0.4;
  overall *= volumeFactor;

  // Money on the table now beats money in theory.
  if (s.google_ads) overall += 10;

  // Too large to reach the owner; too small to have a budget.
  if (reviews >= 5000) overall -= 35;
  else if (reviews >= 2000) overall -= 16;
  if (lead.is_chain) overall *= 0.25;

  const weakest = [
    { name: 'capture', ...capture },
    { name: 'convert', ...convert },
    { name: 'recover', ...recover },
  ].sort((a, b) => b.score - a.score)[0];

  // What is left to sell once the first engagement is delivered. A lead
  // whose recovery gap is small but whose capture gap is huge is a
  // modest first sale and a large second one.
  const led = { capture, convert, recover }[leadWith] || recover;
  const rest = ['capture', 'convert', 'recover']
    .filter((k) => k !== leadWith)
    .map((k) => ({ capture, convert, recover }[k].score));
  const expansion = Math.round(rest.reduce((a, b) => a + b, 0) / rest.length);

  return {
    score: Math.max(0, Math.min(100, Math.round(overall))),
    capture, convert, recover,
    lead_with: leadWith,
    opening_score: led.score,
    expansion,
    weakest: weakest.name,
    reasons: [...led.gaps, ...capture.gaps, ...convert.gaps, ...recover.gaps]
      .filter((v, i, a) => a.indexOf(v) === i),
    strengths: [...capture.strengths, ...convert.strengths, ...recover.strengths],
  };
}

/** The opening line, chosen from the biggest hole. */
export function inboundPitch(lead, result) {
  const reviews = Number(lead.review_count) || 0;
  const adsNoTracking = result.capture.gaps.some((g) => /no conversion tracking/i.test(g));
  const noCallTracking = result.capture.gaps.some((g) => /no call tracking/i.test(g));
  const ads = result.capture.strengths.some((g) => /buying Google traffic/i.test(g));

  // Leading with Component 3: open on the opportunity already bought and
  // then dropped. Ad spend makes that sharper, it does not replace it.
  if (result.lead_with === 'recover') {
    if (ads && !lead.recovery_chat) {
      return 'Paying Google for calls and nothing catches the ones they miss. Ask what a booked job is worth, then how many ring out on a busy day.';
    }
    if (!lead.recovery_chat && reviews >= 75) {
      return `${reviews} reviews, so the phone rings — and nothing catches it when nobody picks up. Ask how many go to voicemail on a busy day.`;
    }
    if (!lead.recovery_email_tool && reviews >= 100) {
      return `${reviews}+ past customers and unsold estimates, none of them ever followed up. Ask when they last contacted an old customer.`;
    }
    if (!lead.website) {
      return `${reviews} reviews and no website — every enquiry rides on someone answering the phone. Ask what happens after 5pm.`;
    }
    if (!lead.recovery_booking) {
      return 'No online booking, so reminders and no-shows are handled by memory. Ask who chases an estimate nobody accepted.';
    }
  }

  if (adsNoTracking && noCallTracking) {
    return 'They are buying Google traffic and measuring none of it. Ask what a lead costs them — they will not know.';
  }
  if (adsNoTracking) {
    return 'Google Ads running with no conversion tracking. Ask which campaign produced their last booked job.';
  }
  if (!lead.website) {
    return `${reviews} reviews and no website. There is nowhere to send paid traffic, so every search goes to a competitor.`;
  }
  if (['unreachable', 'timeout', 'server_error', 'not_found'].includes(lead.site_status)) {
    return 'Their site is down. Ask what happens to anyone searching for them right now.';
  }
  if (noCallTracking && reviews >= 75) {
    return `${reviews} reviews, so the phone rings — and nothing records which marketing made it ring.`;
  }
  if (result.weakest === 'recover' && !lead.recovery_chat) {
    return 'Nothing catches a call they miss. Ask how many go to voicemail on a busy day.';
  }
  if (result.weakest === 'convert') {
    const gap = result.convert.gaps[0];
    return gap ? `${gap}. Ask what their site converts at — they will not know that either.` : 'The traffic arrives and does not convert.';
  }
  return 'Ask what they spend on Google a month, and what it returned. The gap between those two answers is the pitch.';
}

export { CALL_TRACKING, FINANCING };
