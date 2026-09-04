import { allSettings } from './settings.js';
import { HttpError } from './http.js';

/**
 * Places a click-to-call through Twilio: Twilio rings YOUR phone first,
 * then bridges to the lead. Falls back to "manual" mode when Twilio is
 * not configured, so the dialer still works as a log-only tool.
 */
export async function placeCall({ to, bridgeTo, twiml }) {
  const s = allSettings();
  const sid = s.twilio_account_sid;
  const auth = s.twilio_auth_token;
  const from = s.twilio_from_number;

  if (!sid || !auth || !from) {
    return { provider: 'manual', sid: null, status: 'manual', message: 'Twilio not configured. Call logged only.' };
  }

  const body = new URLSearchParams({ To: to, From: from });
  if (twiml) body.set('Twiml', twiml);
  else if (bridgeTo) body.set('Twiml', `<Response><Dial callerId="${escapeXml(from)}">${escapeXml(bridgeTo)}</Dial></Response>`);
  else body.set('Twiml', '<Response><Say>Connecting your call.</Say></Response>');

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
    method: 'POST',
    headers: {
      authorization: 'Basic ' + Buffer.from(`${sid}:${auth}`).toString('base64'),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new HttpError(res.status, `Twilio: ${data.message || 'call failed'}`);
  }
  return { provider: 'twilio', sid: data.sid, status: data.status };
}

export async function sendSms({ to, body }) {
  const s = allSettings();
  const sid = s.twilio_account_sid;
  const auth = s.twilio_auth_token;
  const from = s.twilio_from_number;
  if (!sid || !auth || !from) {
    throw new HttpError(400, 'Twilio not configured. Add credentials in Settings.');
  }
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      authorization: 'Basic ' + Buffer.from(`${sid}:${auth}`).toString('base64'),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (!res.ok) throw new HttpError(res.status, `Twilio: ${data.message || 'sms failed'}`);
  return { sid: data.sid, status: data.status };
}

function escapeXml(v) {
  return String(v ?? '').replace(/[<>&"']/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
  })[c]);
}
