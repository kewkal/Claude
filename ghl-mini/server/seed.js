import { get, run, tx } from './lib/db.js';
import { scoreLead } from './lib/maps.js';

/** Starter call and email scripts. Written to be used, not admired. */
const SCRIPTS = [
  {
    name: 'Cold call — no website',
    kind: 'call',
    segment: 'no-website',
    is_default: 1,
    body: `OPEN (say it fast, sound busy)
"Hey, is this {{name}}? — Great. My name's [YOU], I'll be quick. I build websites for {{category}} companies around {{city}}. I looked you up and you've got {{review_count}} reviews at {{rating}} stars, which is better than most, but I couldn't find a website anywhere. Is that on purpose or just never got to it?"

[SHUT UP. Let them answer.]

THE HOOK
"That's what I figured. Here's the thing: people are searching '{{category}} near me' in {{city}} right now, they find your Google listing, they click for a website, there's nothing there, and they go to the next guy. That's not a marketing problem, that's a leak."

THE ASK
"I'm not going to pitch you on the phone. Give me 15 minutes on a call, I'll show you exactly what your competitors' sites look like and what yours would look like. If it's not obvious you'd make money on it, I'll leave you alone. Do you have Tuesday or Thursday open?"

IF THEY BOOK
"Perfect. What's the best email? I'll send a confirmation. See you [DAY] at [TIME]."

IF THEY STALL
"No problem. Can I text you two examples of sites I built for {{category}} shops? If it's not a fit, ignore me forever."`,
  },
  {
    name: 'Cold call — bad or dated website',
    kind: 'call',
    segment: 'bad-website',
    body: `OPEN
"Hey {{name}}, [YOU] here. Quick one. I build sites for {{category}} businesses in {{city}}. I pulled up yours — it loads, but on my phone I had to pinch and zoom to find your number. Do you get much work off the site right now?"

[They usually say "not really" or "no idea."]

THE DIAGNOSIS
"That's the answer I hear every time. Over half your traffic is on a phone. If they have to work to call you, they just don't. It's usually not a redesign you need, it's the phone number, the reviews and the quote form in the right place."

THE ASK
"Fifteen minutes, I'll screen-share your site next to two competitors and you can decide. Tuesday or Thursday?"`,
  },
  {
    name: 'Voicemail — 18 seconds',
    kind: 'voicemail',
    segment: 'general',
    is_default: 1,
    body: `"Hey {{name}}, it's [YOU]. I build websites for {{category}} companies around {{city}} — saw your listing, had a quick question about how you're getting work right now. Call me back at [NUMBER]. That's [NUMBER]. Thanks."

Rules:
- Under 20 seconds or they delete it.
- Say the number twice, slowly.
- Never say "just following up." Ever.`,
  },
  {
    name: 'Cold email — first touch',
    kind: 'email',
    segment: 'no-website',
    is_default: 1,
    subject: '{{name}} — quick question about your website',
    body: `Hi,

Found {{name}} on Google — {{review_count}} reviews at {{rating}} stars. That's real. But I couldn't find a website.

If someone searches "{{category}} in {{city}}" and lands on your listing, there's nowhere for them to go. They call the next name down.

I build 5-page sites for {{category}} businesses. Live in 72 hours, written to turn a search into a phone call.

Worth 15 minutes? Reply "yes" and I'll send times.

[YOU]
[PHONE]`,
  },
  {
    name: 'Cold email — follow-up 1 (day 3)',
    kind: 'email',
    segment: 'no-website',
    subject: 'Re: {{name}} — quick question about your website',
    body: `Hi,

Bumping this once in case it got buried.

Short version: you've got the reviews, you don't have the site. That gap costs you calls every week.

Two options:
1. Fifteen minutes this week, I show you what it'd look like.
2. Tell me no and I'll stop emailing.

Either works.

[YOU]`,
  },
  {
    name: 'Cold email — follow-up 2 (day 8, breakup)',
    kind: 'email',
    segment: 'no-website',
    subject: 'Closing the file on {{name}}',
    body: `Hi,

Last one from me.

I'm assuming a website isn't a priority right now, which is fair. I'll close the file.

If that changes — busy season, a competitor outranking you, whatever — reply to this email and I'll pick it back up.

Good luck either way.

[YOU]`,
  },
  {
    name: 'SMS — after a voicemail',
    kind: 'sms',
    segment: 'general',
    is_default: 1,
    body: `Hey {{name}} — [YOU] here, just left you a voicemail. I build websites for {{category}} businesses in {{city}}. Worth a 15 min call? Reply Y or N, either is fine.`,
  },
  {
    name: 'Objection handling',
    kind: 'objection',
    segment: 'general',
    is_default: 1,
    body: `"WE ALREADY HAVE A GUY"
"Good — most people don't. When did he last touch it? ... Right. I'm not trying to replace him, I'm asking if the site is bringing you work. If it is, I'll get off the phone."

"WE GET ALL OUR WORK FROM REFERRALS"
"That's the best kind. Here's the thing though — referrals still Google you before they call. Right now they find nothing, or they find something from 2016. The site isn't there to replace referrals, it's there to stop you losing them."

"HOW MUCH?"
"Depends on the pages, but it starts at [PRICE] and hosting is [PRICE]/month. Before I quote you anything I want to see what you actually need, because half the time it's smaller than people think. That's what the 15 minutes is for."

"SEND ME SOME INFO"
"Happy to. What specifically — pricing, or examples of {{category}} sites I've built? ... I'll send that today. And so it doesn't sit in your inbox forever, can I put 15 minutes on the calendar for Thursday? If the info answers everything you cancel it."

"I'M BUSY"
"Of course you are, that's a good sign. When's your quiet hour — early morning or after 5?"

"NOT INTERESTED"
"Fair enough. Before I go — is it that the site isn't a priority, or that you've been burned on one before?"
[The answer tells you whether to close the file or come back in 90 days.]`,
  },
  {
    name: 'Booking confirmation email',
    kind: 'email',
    segment: 'booked',
    subject: 'Confirmed — {{starts_at}}',
    body: `Hi {{name}},

You're booked in. I'll call you on {{phone}}.

What I'll have ready:
- Your Google listing next to your two closest competitors
- What a site for {{name}} would actually look like
- Straight pricing, no packages

Takes 15 minutes. If something comes up, reply here and we'll move it.

[YOU]`,
  },
  {
    name: 'Post-sale onboarding email',
    kind: 'email',
    segment: 'won',
    subject: 'Welcome aboard — one form and we start',
    body: `Hi {{name}},

Payment received, thank you. We start today.

One thing from you: this form. It's the only time I'll ask you questions.

[ONBOARDING LINK]

Takes about 8 minutes. Once it's in, you get a first draft within 72 hours.

[YOU]`,
  },
];

/**
 * The default drip. Days become minutes here because the scheduler works
 * in minutes: 0, 3 days, 4 days, 8 days.
 */
const SEQUENCE = {
  name: 'Cold outreach — no website',
  description: 'Four touches over eight days. Stops the moment they reply or book.',
  trigger: 'lead_status:queued',
  steps: [
    {
      delay_minutes: 0,
      channel: 'email',
      subject: '{{name}} — quick question about your website',
      body: `Hi,

Found {{name}} on Google — {{review_count}} reviews at {{rating}} stars. That's real. But I couldn't find a website.

If someone searches "{{category}} in {{city}}" and lands on your listing, there's nowhere for them to go. They call the next name down.

I build 5-page sites for {{category}} businesses. Live in 72 hours, written to turn a search into a phone call.

Worth 15 minutes? Reply "yes" and I'll send times.

{{owner_name}}`,
    },
    {
      delay_minutes: 3 * 24 * 60,
      channel: 'email',
      subject: 'Re: {{name}} — quick question about your website',
      body: `Hi,

Bumping this once in case it got buried.

Short version: you've got the reviews, you don't have the site. That gap costs you calls every week.

Two options:
1. Fifteen minutes this week, I show you what it'd look like.
2. Tell me no and I'll stop emailing.

Either works.

{{owner_name}}`,
    },
    {
      delay_minutes: 24 * 60,
      channel: 'sms',
      body: `Hi {{first_name}}, {{owner_name}} here — emailed you about a website for {{name}}. Worth 15 mins? Reply Y or N, either is fine. Reply STOP to opt out.`,
    },
    {
      delay_minutes: 4 * 24 * 60,
      channel: 'email',
      subject: 'Closing the file on {{name}}',
      body: `Hi,

Last one from me.

I'm assuming a website isn't a priority right now, which is fair. I'll close the file.

If that changes — busy season, a competitor outranking you, whatever — reply to this email and I'll pick it back up.

Good luck either way.

{{owner_name}}`,
    },
  ],
};

/** Mon-Fri, 9am-5pm UTC, 30 minute slots. */
const AVAILABILITY = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday, start_min: 9 * 60, end_min: 17 * 60, slot_min: 30,
}));

/** A handful of leads so the UI is not an empty grid on first boot. */
const DEMO_LEADS = [
  { name: 'Northside Roofing', category: 'roofing contractor', phone: '(512) 555-0142', website: null,
    address: '2210 Burnet Rd, Austin, TX 78756', city: 'Austin', state: 'TX', rating: 4.8, review_count: 137, status: 'new' },
  { name: 'Cedar Park Plumbing Co', category: 'plumber', phone: '(512) 555-0198', website: null,
    address: '901 W Whitestone Blvd, Cedar Park, TX 78613', city: 'Cedar Park', state: 'TX', rating: 4.6, review_count: 89, status: 'new' },
  { name: 'Lone Star HVAC', category: 'hvac contractor', phone: '(512) 555-0117', website: 'https://facebook.com/lonestarhvac',
    address: '4400 S Congress Ave, Austin, TX 78745', city: 'Austin', state: 'TX', rating: 4.9, review_count: 212, status: 'queued' },
  { name: 'Hill Country Landscaping', category: 'landscaper', phone: '(512) 555-0163', website: null,
    address: '13000 Hwy 71 W, Bee Cave, TX 78738', city: 'Bee Cave', state: 'TX', rating: 4.4, review_count: 54, status: 'contacted' },
  { name: 'Mueller Electric', category: 'electrician', phone: '(512) 555-0175', website: 'https://muellerelectric.wixsite.com/home',
    address: '1900 Aldrich St, Austin, TX 78723', city: 'Austin', state: 'TX', rating: 4.7, review_count: 76, status: 'callback' },
  { name: 'Barton Creek Dental', category: 'dentist', phone: '(512) 555-0188', website: null,
    address: '2500 Bee Caves Rd, Austin, TX 78746', city: 'Austin', state: 'TX', rating: 4.9, review_count: 341, status: 'booked' },
];

export function seedIfEmpty() {
  const hasScripts = get('SELECT id FROM scripts LIMIT 1');
  const hasAvailability = get('SELECT id FROM availability LIMIT 1');
  const hasLeads = get('SELECT id FROM leads LIMIT 1');

  tx(() => {
    if (!hasScripts) {
      for (const s of SCRIPTS) {
        run('INSERT INTO scripts (name, kind, segment, subject, body, is_default) VALUES (?, ?, ?, ?, ?, ?)',
          [s.name, s.kind, s.segment, s.subject || null, s.body, s.is_default || 0]);
      }
      console.log(`[seed] added ${SCRIPTS.length} starter scripts`);
    }
    if (!hasAvailability) {
      for (const a of AVAILABILITY) {
        run('INSERT INTO availability (weekday, start_min, end_min, slot_min) VALUES (?, ?, ?, ?)',
          [a.weekday, a.start_min, a.end_min, a.slot_min]);
      }
      console.log('[seed] added Mon-Fri 9-5 availability');
    }
    if (!get('SELECT id FROM sequences LIMIT 1')) {
      const info = run('INSERT INTO sequences (name, description, trigger, active) VALUES (?, ?, ?, 0)',
        [SEQUENCE.name, SEQUENCE.description, SEQUENCE.trigger]);
      const seqId = Number(info.lastInsertRowid);
      SEQUENCE.steps.forEach((step, i) => {
        run('INSERT INTO sequence_steps (sequence_id, position, delay_minutes, channel, subject, body) VALUES (?, ?, ?, ?, ?, ?)',
          [seqId, i, step.delay_minutes, step.channel, step.subject || null, step.body]);
      });
      console.log(`[seed] added the "${SEQUENCE.name}" sequence (off until you switch it on)`);
    }
    if (!hasLeads) {
      for (const l of DEMO_LEADS) {
        const lead = { ...l, source: 'demo', score: scoreLead(l), country: 'US' };
        const cols = Object.keys(lead);
        run(`INSERT INTO leads (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
          cols.map((c) => lead[c]));
      }
      console.log(`[seed] added ${DEMO_LEADS.length} demo leads (delete them once you scrape real ones)`);
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { ensureDefaultForm } = await import('./api/onboarding.js');
  const { ensureOwner } = await import('./lib/auth.js');
  ensureOwner();
  ensureDefaultForm();
  seedIfEmpty();
  console.log('[seed] done');
}
