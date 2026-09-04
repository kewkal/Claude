import { allSettings } from './settings.js';
import { HttpError } from './http.js';
import { run } from './db.js';

/**
 * Sends through whichever HTTP email API is configured. No SMTP library,
 * no dependencies. Everything is written to email_outbox either way so
 * the agents have a readable history.
 */
export async function sendEmail({ to, subject, body, leadId = null, html = null }) {
  const s = allSettings();
  const provider = s.email_provider || 'none';
  const from = s.email_from;
  const apiKey = s.email_api_key;

  const queued = run(
    'INSERT INTO email_outbox (lead_id, to_addr, subject, body, status, provider) VALUES (?, ?, ?, ?, ?, ?)',
    [leadId, to, subject, body, 'queued', provider]
  );
  const id = Number(queued.lastInsertRowid);

  if (provider === 'none' || !apiKey || !from) {
    run("UPDATE email_outbox SET status = 'not_sent', error = ? WHERE id = ?", [
      'Email provider not configured. Message saved to outbox only.',
      id,
    ]);
    return { id, status: 'not_sent', message: 'Email not configured; saved to outbox.' };
  }

  try {
    const result = await dispatch(provider, { from, apiKey, to, subject, body, html, domain: s.mailgun_domain });
    run("UPDATE email_outbox SET status = 'sent', provider_id = ?, sent_at = datetime('now') WHERE id = ?", [
      result.id || null, id,
    ]);
    return { id, status: 'sent', providerId: result.id };
  } catch (err) {
    run("UPDATE email_outbox SET status = 'failed', error = ? WHERE id = ?", [String(err.message), id]);
    throw err;
  }
}

async function dispatch(provider, opts) {
  if (provider === 'resend') return resend(opts);
  if (provider === 'mailgun') return mailgun(opts);
  if (provider === 'postmark') return postmark(opts);
  throw new HttpError(400, `Unknown email provider: ${provider}`);
}

async function resend({ apiKey, from, to, subject, body, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text: body, ...(html ? { html } : {}) }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (!res.ok) throw new HttpError(res.status, `Resend: ${data.message || 'send failed'}`);
  return { id: data.id };
}

async function mailgun({ apiKey, from, to, subject, body, html, domain }) {
  if (!domain) throw new HttpError(400, 'Mailgun needs a sending domain (Settings > Email).');
  const form = new URLSearchParams({ from, to, subject, text: body });
  if (html) form.set('html', html);
  const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
    method: 'POST',
    headers: {
      authorization: 'Basic ' + Buffer.from(`api:${apiKey}`).toString('base64'),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: form,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (!res.ok) throw new HttpError(res.status, `Mailgun: ${data.message || 'send failed'}`);
  return { id: data.id };
}

async function postmark({ apiKey, from, to, subject, body, html }) {
  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      'x-postmark-server-token': apiKey,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ From: from, To: to, Subject: subject, TextBody: body, ...(html ? { HtmlBody: html } : {}) }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (!res.ok) throw new HttpError(res.status, `Postmark: ${data.Message || 'send failed'}`);
  return { id: data.MessageID };
}
