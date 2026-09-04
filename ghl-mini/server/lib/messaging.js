import { all, get, run } from './db.js';
import { allSettings } from './settings.js';
import { sendSms } from './telephony.js';
import { sendEmail } from './email.js';

/** Replies that mean "stop texting me". Honored immediately, no exceptions. */
const OPT_OUT = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|remove|opt\s*out)\b/i;
const OPT_IN = /^\s*(start|unstop|yes\s*please|resume)\b/i;

export const isOptOut = (text) => OPT_OUT.test(String(text || ''));
export const isOptIn = (text) => OPT_IN.test(String(text || ''));

export const digitsOf = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);

/**
 * An opt-out belongs to the phone number, not to a lead row. Someone can
 * text STOP before they are in the database, or from a second number, and
 * they must stay opted out if that number is scraped in later.
 */
export function isSuppressed(phone) {
  const digits = digitsOf(phone);
  if (!digits) return false;
  const last = get(
    `SELECT body FROM messages
     WHERE direction = 'inbound'
       AND replace(replace(replace(replace(replace(from_addr,'(',''),')',''),'-',''),' ',''),'+','') LIKE ?
     ORDER BY id DESC LIMIT 1`,
    [`%${digits}`]
  );
  return last ? isOptOut(last.body) : false;
}

/** Fill {{tokens}} from a lead plus whatever extras the caller supplies. */
export function render(template, vars = {}) {
  const s = allSettings();
  const scope = {
    business_name: s.business_name,
    owner_name: s.owner_name || s.business_name,
    owner_phone: s.owner_phone,
    ...vars,
  };
  return String(template ?? '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key) => {
    const value = key.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), scope);
    return value == null || value === '' ? '' : String(value);
  }).replace(/[ \t]{2,}/g, ' ').trim();
}

/** Minutes since local midnight for `date` in `timezone`. */
export function localMinutes(date, timezone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(date);
    const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
    const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    return (hh % 24) * 60 + mm;
  } catch {
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }
}

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/**
 * Texting people at 3am is illegal in the US and rude everywhere.
 * Returns null when `when` is fine, otherwise the next allowed moment.
 */
export function nextAllowedSendTime(when = new Date()) {
  const s = allSettings();
  const tz = s.timezone || 'UTC';
  const start = toMinutes(s.quiet_start || '08:00');
  const end = toMinutes(s.quiet_end || '21:00');
  if (start === end) return null;

  const now = localMinutes(when, tz);
  const inWindow = start < end ? now >= start && now < end : now >= start || now < end;
  if (inWindow) return null;

  // Push forward to the next window opening.
  let delta = start - now;
  if (delta <= 0) delta += 24 * 60;
  return new Date(when.getTime() + delta * 60000);
}

/**
 * Send one SMS. Every automated send goes through here so the guards
 * cannot be skipped: no number, opted out, or dead lead means no send.
 */
export async function sendMessage({ leadId = null, to = null, body, source = 'manual', force = false }) {
  const s = allSettings();
  const lead = leadId ? get('SELECT * FROM leads WHERE id = ?', [leadId]) : null;
  const number = String(to || lead?.phone || '').trim();
  const text = String(body || '').trim();

  const reject = (status, error) => {
    run(
      `INSERT INTO messages (lead_id, direction, channel, to_addr, from_addr, body, status, source, error)
       VALUES (?, 'outbound', 'sms', ?, ?, ?, ?, ?, ?)`,
      [leadId, number || null, s.twilio_from_number || null, text, status, source, error]
    );
    return { sent: false, status, error };
  };

  if (!text) return reject('skipped', 'Empty message body.');
  if (!number) return reject('skipped', 'That lead has no phone number.');
  if (!force && lead && lead.status === 'dnc') {
    return reject('blocked', 'Lead is marked do-not-call / opted out.');
  }
  if (!force && lead && (lead.tags || '').includes('sms-opt-out')) {
    return reject('blocked', 'Lead replied STOP.');
  }
  if (!force && isSuppressed(number)) {
    return reject('blocked', 'That number replied STOP.');
  }

  const insert = run(
    `INSERT INTO messages (lead_id, direction, channel, to_addr, from_addr, body, status, source)
     VALUES (?, 'outbound', 'sms', ?, ?, ?, 'queued', ?)`,
    [leadId, number, s.twilio_from_number || null, text, source]
  );
  const id = Number(insert.lastInsertRowid);

  try {
    const result = await sendSms({ to: number, body: text });
    run('UPDATE messages SET status = ?, provider_sid = ? WHERE id = ?', ['sent', result.sid, id]);
    if (leadId) {
      run("UPDATE leads SET last_contacted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", [leadId]);
      run('INSERT INTO activity (lead_id, kind, summary) VALUES (?, ?, ?)', [
        leadId, 'sms', `Sent: ${text.slice(0, 120)}`,
      ]);
    }
    return { sent: true, id, sid: result.sid };
  } catch (err) {
    run('UPDATE messages SET status = ?, error = ? WHERE id = ?', ['failed', String(err.message), id]);
    return { sent: false, status: 'failed', error: String(err.message) };
  }
}

/** Log an inbound SMS and apply opt-out / opt-in. */
export function recordInbound({ from, to, body, sid }) {
  const digits = String(from || '').replace(/\D/g, '').slice(-10);
  const lead = digits
    ? get(
        `SELECT * FROM leads
         WHERE replace(replace(replace(replace(replace(phone,'(',''),')',''),'-',''),' ',''),'+','') LIKE ?
         ORDER BY id LIMIT 1`,
        [`%${digits}`]
      )
    : null;

  run(
    `INSERT INTO messages (lead_id, direction, channel, to_addr, from_addr, body, status, source, provider_sid)
     VALUES (?, 'inbound', 'sms', ?, ?, ?, 'received', 'twilio', ?)`,
    [lead?.id ?? null, to || null, from || null, String(body || ''), sid || null]
  );

  if (!lead) return { lead: null, action: isOptOut(body) ? 'opted_out' : 'logged' };

  run('INSERT INTO activity (lead_id, kind, summary) VALUES (?, ?, ?)', [
    lead.id, 'sms_in', `Replied: ${String(body || '').slice(0, 140)}`,
  ]);

  if (isOptOut(body)) {
    const tags = new Set(String(lead.tags || '').split(',').map((t) => t.trim()).filter(Boolean));
    tags.add('sms-opt-out');
    run("UPDATE leads SET status = 'dnc', tags = ?, updated_at = datetime('now') WHERE id = ?", [
      [...tags].join(', '), lead.id,
    ]);
    stopEnrollments(lead.id, 'opted out');
    return { lead, action: 'opted_out' };
  }

  if (isOptIn(body)) {
    const tags = String(lead.tags || '').split(',').map((t) => t.trim())
      .filter((t) => t && t !== 'sms-opt-out').join(', ');
    run("UPDATE leads SET status = 'contacted', tags = ?, updated_at = datetime('now') WHERE id = ?", [tags, lead.id]);
    return { lead, action: 'opted_in' };
  }

  // Any genuine reply means a human is now in the conversation. Automated
  // follow-ups stop so the lead never gets a drip on top of a real reply.
  stopEnrollments(lead.id, 'lead replied');
  run(
    `UPDATE leads SET status = CASE WHEN status IN ('new','queued','contacted') THEN 'callback' ELSE status END,
     next_action_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
    [lead.id]
  );
  return { lead, action: 'replied' };
}

export function stopEnrollments(leadId, reason) {
  const info = run(
    `UPDATE enrollments SET status = 'stopped', stop_reason = ?, completed_at = datetime('now')
     WHERE lead_id = ? AND status = 'active'`,
    [reason, leadId]
  );
  run(
    `UPDATE scheduled_jobs SET status = 'cancelled', result = ?
     WHERE status = 'pending' AND kind = 'sequence_step'
       AND json_extract(payload_json, '$.lead_id') = ?`,
    [reason, leadId]
  );
  return info.changes;
}

/** Email through the same guard rails, so a sequence can mix channels. */
export async function sendSequenceEmail({ leadId, to, subject, body }) {
  const lead = leadId ? get('SELECT * FROM leads WHERE id = ?', [leadId]) : null;
  const addr = to || lead?.email;
  if (!addr) return { sent: false, error: 'That lead has no email address.' };
  if (lead && lead.status === 'dnc') return { sent: false, error: 'Lead is marked do-not-call.' };
  const result = await sendEmail({ to: addr, subject, body, leadId });
  return { sent: result.status === 'sent', ...result };
}

export function leadVars(lead, extra = {}) {
  return {
    ...lead,
    name: lead?.name || 'there',
    first_name: String(lead?.name || '').split(/[\s,]/)[0] || 'there',
    ...extra,
  };
}
