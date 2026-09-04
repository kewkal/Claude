import { Router, json, bad } from '../lib/http.js';
import { publicSettings, setSetting, allSettings, DEFAULTS, SECRET_KEYS } from '../lib/settings.js';
import { changePassword } from '../lib/auth.js';
import { get, all } from '../lib/db.js';
import { sendEmail } from '../lib/email.js';
import { HttpError } from '../lib/http.js';

const router = new Router();

router.get('/api/settings', ({ res }) => {
  json(res, { settings: publicSettings(), keys: Object.keys(DEFAULTS), secrets: [...SECRET_KEYS] });
});

router.put('/api/settings', ({ res, body }) => {
  const updates = body.settings || body;
  const changed = [];
  for (const [key, value] of Object.entries(updates)) {
    if (!(key in DEFAULTS)) continue;
    // A masked value coming back means "leave it alone".
    if (SECRET_KEYS.has(key) && String(value).startsWith('••••')) continue;
    setSetting(key, value);
    changed.push(key);
  }
  json(res, { settings: publicSettings(), changed });
});

/** POST /api/settings/password */
router.post('/api/settings/password', ({ res, body, user }) => {
  const pw = String(body.password || '');
  if (pw.length < 8) throw bad('Use at least 8 characters');
  changePassword(user.id, pw);
  json(res, { changed: true, message: 'Password changed. Sign in again.' });
});

/**
 * GET /api/settings/connections — the "what do I still need to plug in"
 * checklist from the Settings screen.
 */
router.get('/api/settings/connections', ({ res }) => {
  const s = allSettings();
  const connections = [
    {
      id: 'email',
      name: 'Email',
      why: 'Sends onboarding confirmations, booking reminders and the outreach your agents write.',
      connected: s.email_provider !== 'none' && Boolean(s.email_api_key && s.email_from),
      fields: ['email_provider', 'email_api_key', 'email_from', 'mailgun_domain'],
      help: 'Resend, Mailgun or Postmark. All three have a free tier big enough to start.',
    },
    {
      id: 'google_maps',
      name: 'Google Maps API',
      why: 'Scrapes leads. This is where the 2,000-lead list comes from.',
      connected: Boolean(s.google_maps_api_key),
      fields: ['google_maps_api_key', 'default_search_radius_m'],
      help: 'Google Cloud Console > Places API. The free monthly credit covers thousands of lookups.',
    },
    {
      id: 'twilio',
      name: 'Twilio',
      why: 'Click-to-call from the dialer and outbound SMS.',
      connected: Boolean(s.twilio_account_sid && s.twilio_auth_token && s.twilio_from_number),
      fields: ['twilio_account_sid', 'twilio_auth_token', 'twilio_from_number'],
      help: 'Optional. Without it the dialer still works as a log-and-track tool.',
    },
    {
      id: 'agents',
      name: 'Claude Code agents',
      why: 'Runs the six agents. This is the part doing the actual work.',
      connected: s.agents_enabled === '1',
      fields: ['claude_bin', 'agents_enabled'],
      help: 'Point this at your `claude` binary. Agent tasks also land in agent-queue/ so you can run them by hand.',
    },
  ];
  const counts = {
    leads: get('SELECT COUNT(*) AS n FROM leads').n,
    calls: get('SELECT COUNT(*) AS n FROM calls').n,
    scripts: get('SELECT COUNT(*) AS n FROM scripts').n,
    bookings: get('SELECT COUNT(*) AS n FROM bookings').n,
    responses: get('SELECT COUNT(*) AS n FROM onboarding_responses').n,
    runs: get('SELECT COUNT(*) AS n FROM agent_runs').n,
  };
  json(res, { connections, counts, ready: connections.filter((c) => c.connected).length });
});

/** POST /api/settings/test/:integration — prove a key actually works. */
router.post('/api/settings/test/:integration', async ({ res, params, body }) => {
  const s = allSettings();
  const which = params.integration;

  if (which === 'email') {
    const to = body.to || s.owner_email;
    if (!to) throw bad('No address to send the test to');
    const result = await sendEmail({
      to,
      subject: 'ghl-mini test email',
      body: 'If you are reading this, your email connection works.',
    });
    return json(res, { ok: result.status === 'sent', ...result });
  }

  if (which === 'google_maps') {
    if (!s.google_maps_api_key) throw bad('No Google Maps API key saved');
    const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
    url.searchParams.set('query', 'coffee shop in Austin TX');
    url.searchParams.set('key', s.google_maps_api_key);
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const data = await r.json();
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      throw new HttpError(400, `Google: ${data.error_message || data.status}`);
    }
    const results = (data.results || []).length;
    // Text Search working does not prove Place Details is enabled, and that
    // is where phone numbers and websites come from.
    let detailsOk = false;
    if (results) {
      const d = new URL('https://maps.googleapis.com/maps/api/place/details/json');
      d.searchParams.set('place_id', data.results[0].place_id);
      d.searchParams.set('fields', 'formatted_phone_number,website');
      d.searchParams.set('key', s.google_maps_api_key);
      const dr = await fetch(d, { signal: AbortSignal.timeout(15000) });
      detailsOk = (await dr.json()).status === 'OK';
    }
    return json(res, {
      ok: true,
      results,
      details: detailsOk,
      message: detailsOk
        ? `Search and details both working (${results} test results).`
        : 'Text Search works, but Place Details did not respond. Phone numbers and websites will be missing.',
    });
  }

  if (which === 'twilio') {
    if (!s.twilio_account_sid || !s.twilio_auth_token) throw bad('Twilio credentials missing');
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${s.twilio_account_sid}.json`, {
      headers: { authorization: 'Basic ' + Buffer.from(`${s.twilio_account_sid}:${s.twilio_auth_token}`).toString('base64') },
      signal: AbortSignal.timeout(15000),
    });
    const data = await r.json();
    if (!r.ok) throw new HttpError(r.status, `Twilio: ${data.message || 'auth failed'}`);
    return json(res, { ok: true, account: data.friendly_name, status: data.status });
  }

  throw bad(`Nothing to test for "${which}"`);
});

/** GET /api/outbox */
router.get('/api/outbox', ({ res, query }) => {
  const limit = Math.min(200, Number(query.limit) || 50);
  json(res, { outbox: all('SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT ?', [limit]) });
});

/** POST /api/email/send */
router.post('/api/email/send', async ({ res, body }) => {
  if (!body.to) throw bad('No recipient');
  const result = await sendEmail({
    to: body.to,
    subject: body.subject || '',
    body: body.body || '',
    leadId: body.lead_id || null,
  });
  json(res, result, 201);
});

export default router;
