import { Router, json, bad, notFound } from '../lib/http.js';
import { all, get, run } from '../lib/db.js';
import { placeCall, sendSms } from '../lib/telephony.js';
import { logActivity } from './leads.js';

export const OUTCOMES = [
  'connected', 'no_answer', 'voicemail', 'gatekeeper', 'callback',
  'booked', 'not_interested', 'wrong_number', 'dnc',
];

/** How a call outcome moves the lead through the pipeline. */
const OUTCOME_TO_STATUS = {
  booked: 'booked',
  callback: 'callback',
  not_interested: 'lost',
  wrong_number: 'lost',
  dnc: 'dnc',
  connected: 'contacted',
  voicemail: 'contacted',
  gatekeeper: 'contacted',
  no_answer: 'contacted',
};

const router = new Router();

/** GET /api/calls — history, filterable. */
router.get('/api/calls', ({ res, query }) => {
  const limit = Math.min(500, Math.max(1, Number(query.limit) || 100));
  const page = Math.max(1, Number(query.page) || 1);
  const where = [];
  const params = [];
  if (query.outcome && query.outcome !== 'all') { where.push('c.outcome = ?'); params.push(query.outcome); }
  if (query.lead_id) { where.push('c.lead_id = ?'); params.push(query.lead_id); }
  if (query.since) { where.push('c.started_at >= ?'); params.push(query.since); }
  if (query.q) {
    where.push('(c.lead_name LIKE ? OR c.phone LIKE ? OR c.notes LIKE ?)');
    const like = `%${query.q}%`;
    params.push(like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = get(`SELECT COUNT(*) AS n FROM calls c ${clause}`, params).n;
  const rows = all(
    `SELECT c.*, l.status AS lead_status, l.city AS lead_city
     FROM calls c LEFT JOIN leads l ON l.id = c.lead_id
     ${clause} ORDER BY c.started_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit]
  );
  json(res, { calls: rows, total, page, limit, pages: Math.ceil(total / limit) || 1, outcomes: OUTCOMES });
});

/** GET /api/calls/stats */
router.get('/api/calls/stats', ({ res }) => {
  const today = get(`
    SELECT COUNT(*) AS calls,
           COALESCE(SUM(CASE WHEN outcome = 'connected' THEN 1 ELSE 0 END), 0) AS connected,
           COALESCE(SUM(CASE WHEN outcome = 'booked' THEN 1 ELSE 0 END), 0) AS booked,
           COALESCE(SUM(duration_sec), 0) AS talk_time
    FROM calls WHERE date(started_at) = date('now')`);
  const week = get(`
    SELECT COUNT(*) AS calls,
           COALESCE(SUM(CASE WHEN outcome = 'booked' THEN 1 ELSE 0 END), 0) AS booked
    FROM calls WHERE started_at >= datetime('now', '-7 days')`);
  const byOutcome = all(
    "SELECT outcome, COUNT(*) AS n FROM calls WHERE started_at >= datetime('now','-30 days') GROUP BY outcome ORDER BY n DESC"
  );
  const daily = all(`
    SELECT date(started_at) AS day, COUNT(*) AS calls,
           SUM(CASE WHEN outcome = 'booked' THEN 1 ELSE 0 END) AS booked
    FROM calls WHERE started_at >= datetime('now', '-14 days')
    GROUP BY day ORDER BY day ASC`);
  json(res, { today, week, byOutcome, daily });
});

/** GET /api/calls/queue — who to dial next. */
router.get('/api/calls/queue', ({ res, query }) => {
  const limit = Math.min(200, Number(query.limit) || 25);
  const rows = all(
    `SELECT * FROM leads
     WHERE phone IS NOT NULL AND phone != ''
       AND status NOT IN ('dnc', 'lost', 'won')
       AND (next_action_at IS NULL OR next_action_at <= datetime('now'))
     ORDER BY
       CASE status WHEN 'callback' THEN 0 WHEN 'queued' THEN 1 WHEN 'new' THEN 2 ELSE 3 END,
       score DESC, attempts ASC
     LIMIT ?`,
    [limit]
  );
  json(res, { queue: rows });
});

/** POST /api/calls/dial — place the call through Twilio, or log a manual one. */
router.post('/api/calls/dial', async ({ res, body }) => {
  const leadId = body.lead_id ? Number(body.lead_id) : null;
  const lead = leadId ? get('SELECT * FROM leads WHERE id = ?', [leadId]) : null;
  const phone = String(body.phone || lead?.phone || '').trim();
  if (!phone) throw bad('No phone number to dial');

  const result = await placeCall({ to: body.bridge_to || phone, bridgeTo: body.bridge_to ? phone : null });

  const info = run(
    `INSERT INTO calls (lead_id, lead_name, phone, direction, outcome, script_id, provider, provider_sid)
     VALUES (?, ?, ?, 'outbound', 'no_answer', ?, ?, ?)`,
    [leadId, lead?.name || body.name || null, phone, body.script_id || null, result.provider, result.sid]
  );
  if (leadId) {
    run("UPDATE leads SET attempts = attempts + 1, last_contacted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", [leadId]);
    logActivity(leadId, 'call', `Dialed ${phone}`, { provider: result.provider });
  }
  json(res, { call_id: Number(info.lastInsertRowid), ...result }, 201);
});

/** POST /api/calls — log a call outcome. */
router.post('/api/calls', ({ res, body }) => {
  const leadId = body.lead_id ? Number(body.lead_id) : null;
  const lead = leadId ? get('SELECT * FROM leads WHERE id = ?', [leadId]) : null;
  const outcome = body.outcome || 'no_answer';
  if (!OUTCOMES.includes(outcome)) throw bad(`Unknown outcome: ${outcome}`);

  const info = run(
    `INSERT INTO calls (lead_id, lead_name, phone, direction, outcome, duration_sec, notes, script_id, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
    [
      leadId, lead?.name || body.lead_name || null, body.phone || lead?.phone || null,
      body.direction || 'outbound', outcome, Number(body.duration_sec) || 0,
      body.notes || '', body.script_id || null, body.started_at || null,
    ]
  );

  if (leadId) {
    const nextStatus = OUTCOME_TO_STATUS[outcome];
    const nextAction = body.next_action_at || defaultFollowUp(outcome);
    run(
      `UPDATE leads SET status = COALESCE(?, status), last_contacted_at = datetime('now'),
       next_action_at = ?, attempts = attempts + 1, updated_at = datetime('now') WHERE id = ?`,
      [nextStatus || null, nextAction, leadId]
    );
    logActivity(leadId, 'call', `Call: ${outcome}${body.notes ? ` — ${body.notes}` : ''}`);
  }
  if (body.script_id) run('UPDATE scripts SET uses = uses + 1 WHERE id = ?', [body.script_id]);
  if (body.script_id && outcome === 'booked') run('UPDATE scripts SET wins = wins + 1 WHERE id = ?', [body.script_id]);

  json(res, { call: get('SELECT * FROM calls WHERE id = ?', [Number(info.lastInsertRowid)]) }, 201);
});

/** PATCH /api/calls/:id — fix up notes or outcome after the fact. */
router.patch('/api/calls/:id', ({ res, params, body }) => {
  const call = get('SELECT * FROM calls WHERE id = ?', [params.id]);
  if (!call) throw notFound('Call not found');
  const allowed = ['outcome', 'notes', 'duration_sec', 'recording_url'];
  const data = {};
  for (const f of allowed) if (body[f] !== undefined) data[f] = body[f];
  if (!Object.keys(data).length) throw bad('Nothing to update');
  if (data.outcome && !OUTCOMES.includes(data.outcome)) throw bad(`Unknown outcome: ${data.outcome}`);
  run(
    `UPDATE calls SET ${Object.keys(data).map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(data), params.id]
  );
  json(res, { call: get('SELECT * FROM calls WHERE id = ?', [params.id]) });
});

/** DELETE /api/calls/:id */
router.delete('/api/calls/:id', ({ res, params }) => {
  const info = run('DELETE FROM calls WHERE id = ?', [params.id]);
  if (!info.changes) throw notFound('Call not found');
  json(res, { deleted: true });
});

/** POST /api/calls/sms */
router.post('/api/calls/sms', async ({ res, body }) => {
  const leadId = body.lead_id ? Number(body.lead_id) : null;
  const lead = leadId ? get('SELECT * FROM leads WHERE id = ?', [leadId]) : null;
  const to = String(body.phone || lead?.phone || '').trim();
  if (!to) throw bad('No number to text');
  if (!body.body) throw bad('No message body');
  const result = await sendSms({ to, body: body.body });
  if (leadId) logActivity(leadId, 'sms', body.body.slice(0, 140), { sid: result.sid });
  json(res, result, 201);
});

function defaultFollowUp(outcome) {
  const days = { no_answer: 2, voicemail: 3, gatekeeper: 2, callback: 1, connected: 5 }[outcome];
  if (!days) return null;
  return new Date(Date.now() + days * 864e5).toISOString().slice(0, 19).replace('T', ' ');
}

export default router;
