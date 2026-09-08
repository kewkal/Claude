/**
 * Scores a lead on how much revenue is leaking out of it, for an offer
 * that recovers three things: missed calls, a dead customer database,
 * and no-shows / unchased quotes.
 *
 * That is a different lead from "needs a website". A busy roofer with a
 * decent site, 300 reviews and no way to catch an overflow call is
 * leaking more money than a quiet one with no site at all — though the
 * one with no site is still the easiest conversation to have, because
 * nothing has to be argued.
 */

/** Software that already catches an overflow call or an out-of-hours one. */
const CHAT_TOOLS = [
  ['podium', /podium\.com|podiumwebchat/i],
  ['intercom', /intercom\.(io|com)|widget\.intercom/i],
  ['drift', /drift\.com|driftt\.com/i],
  ['tawk', /tawk\.to/i],
  ['tidio', /tidio(chat)?\./i],
  ['crisp', /crisp\.chat/i],
  ['livechat', /livechatinc|livechat\.com/i],
  ['hubspot chat', /js\.hs-scripts\.com|hubspot.*conversations/i],
  ['zendesk', /zdassets\.com|zendesk\.com\/embeddable/i],
  ['facebook messenger', /connect\.facebook\.net.*customerchat|fb-customerchat/i],
  ['birdeye', /birdeye\.com/i],
  ['thryv', /thryv\.com/i],
  ['gohighlevel', /leadconnectorhq|msgsndr\.com|gohighlevel/i],
];

/** Booking and scheduling — appointments exist, so no-shows exist. */
const BOOKING_TOOLS = [
  ['calendly', /calendly\.com/i],
  ['acuity', /acuityscheduling\.com|squarespacescheduling/i],
  ['housecall pro', /housecallpro\.com/i],
  ['servicetitan', /servicetitan\.com/i],
  ['jobber', /getjobber\.com|jobber\.com/i],
  ['setmore', /setmore\.com/i],
  ['square appointments', /squareup\.com\/appointments/i],
  ['booksy', /booksy\.com/i],
  ['schedule engine', /scheduleengine\.(com|net)/i],
  ['servicem8', /servicem8\.com/i],
  ['workiz', /workiz\.com/i],
];

/** Anything that implies the customer list is being marketed to. */
const EMAIL_TOOLS = [
  ['mailchimp', /mailchimp\.com|list-manage\.com|chimpstatic/i],
  ['klaviyo', /klaviyo\.com/i],
  ['constant contact', /constantcontact\.com/i],
  ['activecampaign', /activecampaign\.com|trackcmp\.net/i],
  ['convertkit', /convertkit\.com/i],
  ['hubspot', /js\.hsforms\.net|hs-analytics\.net/i],
  ['sendinblue', /sendinblue\.com|brevo\.com/i],
  ['omnisend', /omnisend\.com/i],
  ['emailoctopus', /emailoctopus\.com/i],
];

/** Review and reputation tools — a sign someone is already working it. */
const REVIEW_TOOLS = [
  ['birdeye', /birdeye\.com/i],
  ['nicejob', /nicejob\.(com|co)/i],
  ['podium reviews', /podium\.com\/reviews/i],
  ['grade\\.us', /grade\.us/i],
  ['reviewsio', /reviews\.io/i],
  ['trustpilot', /trustpilot\.com\/(?:bootstrap|trustbox)/i],
];

const has = (haystack, table) => {
  const hit = table.find(([, re]) => re.test(haystack));
  return hit ? hit[0] : null;
};

/** Does the site actually collect an enquiry anywhere? */
function detectForm(html) {
  if (/<form[^>]*>[\s\S]*?<\/form>/i.test(html)) {
    // A search box is not a lead form.
    const forms = html.match(/<form[\s\S]{0,2000}?<\/form>/gi) || [];
    const real = forms.find((f) => /type=["']?(?:email|tel)|name=["'](?:email|phone|message|name)/i.test(f));
    if (real) return true;
  }
  return /jotform|typeform|wufoo|gravityforms|wpforms|formstack|hsforms|contact-form-7/i.test(html);
}

/** Is the phone number one tap away, or does it have to be copied out? */
function detectClickToCall(html) {
  return /href=["']tel:/i.test(html);
}

/**
 * What is leaking, and how badly. Returns a 0-100 score plus the specific
 * reasons, which double as the opening line of the call.
 */
export function scoreRecovery(lead, scan = null) {
  const reasons = [];
  const gaps = {};
  let score = 0;

  const reviews = Number(lead.review_count) || 0;
  const rating = Number(lead.rating) || 0;

  // Volume is the multiplier on everything else. A business doing four
  // jobs a month has nothing meaningful to recover.
  let volume = 0;
  if (reviews >= 300) volume = 30;
  else if (reviews >= 150) volume = 26;
  else if (reviews >= 75) volume = 21;
  else if (reviews >= 30) volume = 15;
  else if (reviews >= 10) volume = 8;
  else volume = 2;
  score += volume;
  if (reviews >= 75) {
    reasons.push(`${reviews} reviews — they are busy enough for the leaks to be worth money`);
  }

  // Past a certain size the owner is not answering the phone and there is
  // already a marketing department with a preferred vendor. Still a real
  // business, just not one a cold call reaches.
  if (reviews >= 5000) {
    score -= 28;
    gaps.too_big = true;
    reasons.push(`${reviews.toLocaleString()} reviews — big enough to have a marketing team. You will not reach the owner.`);
  } else if (reviews >= 2000) {
    score -= 14;
    gaps.large = true;
    reasons.push(`${reviews.toLocaleString()} reviews — large operation, expect a gatekeeper`);
  }

  // No website: nothing to inspect, and the easiest conversation there
  // is, because there is nothing for them to defend.
  if (!lead.website) {
    score += 34;
    gaps.no_website = true;
    reasons.push('No website at all — every enquiry depends on someone picking up the phone');
    if (rating >= 4.3 && reviews >= 20) {
      reasons.push('Good reputation with nowhere to send anyone — the easiest sale on the list');
    }
    return finish(score, reasons, gaps, lead);
  }

  // A site that is down or unchecked is worth more than one that works.
  if (['unreachable', 'timeout', 'server_error', 'not_found'].includes(lead.site_status)) {
    score += 30;
    gaps.site_broken = true;
    reasons.push('Their website is down, so every click on it is lost outright');
    return finish(score, reasons, gaps, lead);
  }

  // Not scanned yet: keep the volume score so the busiest sites rise to
  // the top of the queue to be checked, rather than all sitting flat.
  if (!scan && !lead.site_status) {
    gaps.unchecked = true;
    reasons.push('Not checked yet — run Check websites to see what they are missing');
    if (lead.runs_ads) { score += 12; reasons.push('Running ads'); }
    return finish(score, reasons, gaps, lead);
  }

  const chat = scan?.tools?.chat ?? lead.recovery_chat;
  const booking = scan?.tools?.booking ?? lead.recovery_booking;
  const emailTool = scan?.tools?.email ?? lead.recovery_email_tool;
  const reviewTool = scan?.tools?.review ?? lead.recovery_review_tool;
  const form = scan ? scan.tools.form : lead.recovery_form === 1;
  const clickToCall = scan ? scan.tools.click_to_call : lead.recovery_click_to_call === 1;

  // --- Missed calls -------------------------------------------------
  if (!chat) {
    score += 22;
    gaps.no_chat = true;
    reasons.push('No chat or text widget — a missed call is simply a lost job');
  } else {
    reasons.push(`Already running ${chat}, so someone has sold them on this before`);
  }
  if (!clickToCall) {
    score += 5;
    gaps.no_click_to_call = true;
    reasons.push('Phone number is not tappable on a phone');
  }
  if (!form) {
    score += 6;
    gaps.no_form = true;
    reasons.push('No enquiry form — the phone is the only way in');
  }

  // --- Dead database ------------------------------------------------
  if (!emailTool) {
    score += 16;
    gaps.no_email_marketing = true;
    reasons.push(
      reviews >= 100
        ? `No email marketing anywhere, with ${reviews}+ past customers sitting unused`
        : 'No email marketing — past customers are never contacted again'
    );
  }
  if (!reviewTool && reviews < 100) {
    score += 5;
    gaps.no_review_tool = true;
    reasons.push('Nothing asking customers for reviews');
  }

  // --- No-shows and dead quotes ------------------------------------
  if (!booking) {
    score += 10;
    gaps.no_booking = true;
    reasons.push('No online booking, so every appointment is arranged by hand and forgotten by hand');
  } else {
    score += 4;
    gaps.has_booking = true;
    reasons.push(`Books online through ${booking} — ask what their no-show rate is`);
  }

  // Paying for traffic makes every gap above cost real money.
  if (lead.runs_ads) {
    score += 12;
    gaps.runs_ads = true;
    reasons.push('Paying for ads, so the leads being dropped are ones they bought');
  }

  return finish(score, reasons, gaps, lead);
}

function finish(score, reasons, gaps, lead) {
  const capped = Math.max(0, Math.min(100, Math.round(score)));
  // A chain cannot buy from you whatever it is leaking.
  const final = lead.is_chain ? Math.round(capped * 0.25) : capped;
  return { score: final, reasons, gaps };
}

/** The single line to open a call with. */
export function recoveryPitch(lead) {
  const reviews = Number(lead.review_count) || 0;
  if (!lead.website) {
    return `${reviews} reviews and no website — every one of those customers found them by phone. Ask how many calls they miss in a week.`;
  }
  if (['unreachable', 'timeout', 'server_error', 'not_found'].includes(lead.site_status)) {
    return 'Their site is down. Ask what happens to someone who searches for them right now.';
  }
  if (lead.runs_ads && !lead.recovery_chat) {
    return 'Paying for ads and nothing catches the ones who do not get through. Ask what a booked job is worth.';
  }
  if (!lead.recovery_chat && reviews >= 75) {
    return `${reviews} reviews, no way to catch an overflow call. Ask how often the phone rings out on a busy day.`;
  }
  if (!lead.recovery_email_tool && reviews >= 100) {
    return `${reviews}+ past customers and nothing ever goes out to them. Ask when they last contacted an old customer.`;
  }
  if (!lead.recovery_booking) {
    return 'Everything is booked by hand, so everything is chased by hand. Ask who follows up an unaccepted quote.';
  }
  return 'Tooling is in place — find out what actually gets used, and what happens after hours.';
}

/** Read every recovery signal off a page. */
export function detectTools(html) {
  return {
    chat: has(html, CHAT_TOOLS),
    booking: has(html, BOOKING_TOOLS),
    email: has(html, EMAIL_TOOLS),
    review: has(html, REVIEW_TOOLS),
    form: detectForm(html),
    click_to_call: detectClickToCall(html),
  };
}

export { CHAT_TOOLS, BOOKING_TOOLS, EMAIL_TOOLS, REVIEW_TOOLS };
