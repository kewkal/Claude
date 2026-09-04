import crypto from 'node:crypto';
import { Router, text } from '../lib/http.js';
import { allSettings } from '../lib/settings.js';
import { recordInbound } from '../lib/messaging.js';
import { missedCallTextBack } from '../lib/automations.js';

const router = new Router();

const xml = (res, body) => {
  res.writeHead(200, { 'content-type': 'text/xml; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
};

const escapeXml = (v) => String(v ?? '').replace(/[<>&"']/g, (c) => ({
  '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
})[c]);

/**
 * Twilio signs every request with HMAC-SHA1 over the full URL plus the
 * POST params sorted by key. Without this check anyone who finds the URL
 * can fake inbound calls and texts.
 */
function verifyTwilio(req, body) {
  const s = allSettings();
  const token = s.twilio_auth_token;
  if (!token) return false;

  const signature = req.headers['x-twilio-signature'];
  if (!signature) return false;

  const base = (s.public_url || '').replace(/\/$/, '');
  const url = base + req.url;
  const payload = Object.keys(body).sort().reduce((acc, k) => acc + k + body[k], url);
  const expected = crypto.createHmac('sha1', token).update(Buffer.from(payload, 'utf8')).digest('base64');

  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function guard(req, res, body) {
  if (String(process.env.TWILIO_SKIP_VERIFY || '').toLowerCase() === 'true') return true;
  if (verifyTwilio(req, body)) return true;
  console.warn('[webhook] rejected an unsigned Twilio request');
  text(res, 'Signature check failed', 403);
  return false;
}

/**
 * Inbound voice. Rings your real phone; if that does not connect, the
 * `action` callback below fires the text-back.
 */
router.post('/webhooks/twilio/voice', ({ req, res, body }) => {
  if (!guard(req, res, body)) return;
  const s = allSettings();
  const base = (s.public_url || '').replace(/\/$/, '');
  const forward = s.owner_phone;

  if (!forward) {
    return xml(res, `<?xml version="1.0" encoding="UTF-8"?><Response>` +
      `<Say>Thanks for calling ${escapeXml(s.business_name)}. We will text you right back.</Say>` +
      `<Redirect method="POST">${escapeXml(base)}/webhooks/twilio/missed</Redirect></Response>`);
  }

  xml(res, `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<Dial timeout="18" callerId="${escapeXml(body.From || s.twilio_from_number)}" ` +
    `action="${escapeXml(base)}/webhooks/twilio/missed" method="POST">` +
    `${escapeXml(forward)}</Dial></Response>`);
});

/** Dial finished. Anything but "completed" means they did not get through. */
router.post('/webhooks/twilio/missed', async ({ req, res, body }) => {
  if (!guard(req, res, body)) return;
  const status = body.DialCallStatus || 'no-answer';

  if (status === 'completed' || status === 'answered') {
    return xml(res, '<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
  await missedCallTextBack({ from: body.From, to: body.To, callSid: body.CallSid }).catch((e) =>
    console.error('[webhook] text-back failed:', e.message)
  );
  const s = allSettings();
  xml(res, `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<Say>Sorry we missed you. ${escapeXml(s.business_name)} has just sent you a text.</Say></Response>`);
});

/** Inbound SMS: log it, honor STOP, and stop any drip for that lead. */
router.post('/webhooks/twilio/sms', ({ req, res, body }) => {
  if (!guard(req, res, body)) return;
  let reply = '';
  try {
    const result = recordInbound({
      from: body.From, to: body.To, body: body.Body, sid: body.MessageSid,
    });
    if (result.action === 'opted_out') reply = 'You will not get any more texts from us. Reply START to opt back in.';
  } catch (e) {
    console.error('[webhook] inbound sms failed:', e.message);
  }
  xml(res, '<?xml version="1.0" encoding="UTF-8"?><Response>' +
    (reply ? `<Message>${escapeXml(reply)}</Message>` : '') + '</Response>');
});

export default router;
