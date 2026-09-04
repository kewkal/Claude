import { Router, json, bad, notFound } from '../lib/http.js';
import { all, get, run } from '../lib/db.js';
import { allSettings } from '../lib/settings.js';
import { enroll, schedule, runJob, sweepBookings, missedCallTextBack } from '../lib/automations.js';
import { sendMessage, render, leadVars, stopEnrollments, nextAllowedSendTime } from '../lib/messaging.js';
import { tick, stats, pending } from '../lib/scheduler.js';

const router = new Router();

export const TRIGGERS = [
  { id: 'manual', label: 'Only when I add someone' },
  { id: 'lead_status:queued', label: 'Automatically when a lead is queued' },
  { id: 'lead_status:new', label: 'Automatically when a lead is added' },
  { id: 'lead_status:callback', label: 'Automatically when a lead asks for a callback' },
];

/** GET /api/automations — the four system automations plus scheduler health. */
router.get('/api/automations', ({ res }) => {
  const s = allSettings();
  const base = (s.public_url || '').replace(/\/$/, '');
  const twilioReady = Boolean(s.twilio_account_sid && s.twilio_auth_token && s.twilio_from_number);
  const publicHost = !/localhost|127\.0\.0\.1/.test(base);

  json(res, {
    automations: [
      {
        id: 'missed_call',
        name: 'Missed-call text-back',
        blurb: 'Someone rings you and does not get through, so they get a text within seconds.',
        enabled: s.automation_missed_call === '1',
        setting: 'automation_missed_call',
        body_setting: 'automation_missed_call_body',
        body: s.automation_missed_call_body,
        needs: { twilio: twilioReady, public_url: publicHost, owner_phone: Boolean(s.owner_phone) },
        webhook: `${base}/webhooks/twilio/voice`,
      },
      {
        id: 'reminder',
        name: 'Appointment reminder',
        blurb: `Texts and emails the client ${s.automation_reminder_hours} hours before the call.`,
        enabled: s.automation_reminder === '1',
        setting: 'automation_reminder',
        body_setting: 'automation_reminder_body',
        body: s.automation_reminder_body,
        needs: { twilio: twilioReady },
      },
      {
        id: 'no_show',
        name: 'No-show recovery',
        blurb: `Marks the booking and offers new times ${s.automation_no_show_minutes} minutes after a missed call.`,
        enabled: s.automation_no_show === '1',
        setting: 'automation_no_show',
        body_setting: 'automation_no_show_body',
        body: s.automation_no_show_body,
        needs: { twilio: twilioReady },
      },
      {
        id: 'sequences',
        name: 'Drip sequences',
        blurb: 'Runs your multi-day email and text follow-ups without you touching them.',
        enabled: s.automation_sequences === '1',
        setting: 'automation_sequences',
        needs: { twilio: twilioReady },
      },
    ],
    scheduler: {
      ...stats,
      enabled: s.scheduler_enabled === '1',
      pending: pending(),
      quiet_hours: `${s.quiet_start}–${s.quiet_end} ${s.timezone}`,
      sending_now: nextAllowedSendTime(new Date()) === null,
    },
    webhooks: {
      voice: `${base}/webhooks/twilio/voice`,
      sms: `${base}/webhooks/twilio/sms`,
      reachable: publicHost,
    },
    triggers: TRIGGERS,
  });
});

/** POST /api/automations/tick — run a pass right now. */
router.post('/api/automations/tick', async ({ res }) => {
  sweepBookings();
  const result = await tick();
  json(res, { ...result, pending: pending() });
});

/** POST /api/automations/:id/test — send the real message to a number. */
router.post('/api/automations/:id/test', async ({ res, params, body }) => {
  const s = allSettings();
  const to = String(body.to || s.owner_phone || '').trim();
  if (!to) throw bad('Give it a number to text, or set your phone in Settings.');

  const map = {
    missed_call: s.automation_missed_call_body,
    reminder: s.automation_reminder_body,
    no_show: s.automation_no_show_body,
  };
  const template = map[params.id];
  if (!template) throw bad(`Nothing to test for "${params.id}"`);

  const preview = render(template, leadVars(
    { name: 'Test Lead', phone: to },
    { when: 'tomorrow at 10:00 AM', title: 'Discovery call' }
  ));
  const result = await sendMessage({ to, body: preview, source: 'test', force: true });
  json(res, { ...result, preview });
});

// ---------------------------------------------------------------------------
// Sequences
// ---------------------------------------------------------------------------

router.get('/api/sequences', ({ res }) => {
  const sequences = all('SELECT * FROM sequences ORDER BY id').map((seq) => ({
    ...seq,
    steps: all('SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY position', [seq.id]),
    active_enrollments: get("SELECT COUNT(*) AS n FROM enrollments WHERE sequence_id = ? AND status = 'active'", [seq.id]).n,
    total_enrollments: get('SELECT COUNT(*) AS n FROM enrollments WHERE sequence_id = ?', [seq.id]).n,
  }));
  json(res, { sequences, triggers: TRIGGERS });
});

router.post('/api/sequences', ({ res, body }) => {
  if (!body.name) throw bad('A sequence needs a name');
  const info = run('INSERT INTO sequences (name, description, trigger) VALUES (?, ?, ?)', [
    body.name, body.description || '', body.trigger || 'manual',
  ]);
  json(res, { sequence: get('SELECT * FROM sequences WHERE id = ?', [Number(info.lastInsertRowid)]) }, 201);
});

router.patch('/api/sequences/:id', ({ res, params, body }) => {
  const seq = get('SELECT * FROM sequences WHERE id = ?', [params.id]);
  if (!seq) throw notFound('Sequence not found');
  const data = {};
  for (const f of ['name', 'description', 'trigger']) if (body[f] !== undefined) data[f] = body[f];
  if (body.active !== undefined) data.active = body.active ? 1 : 0;
  if (Object.keys(data).length) {
    run(
      `UPDATE sequences SET ${Object.keys(data).map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`,
      [...Object.values(data), params.id]
    );
  }
  if (Array.isArray(body.steps)) {
    run('DELETE FROM sequence_steps WHERE sequence_id = ?', [params.id]);
    body.steps.forEach((step, i) => {
      run(
        'INSERT INTO sequence_steps (sequence_id, position, delay_minutes, channel, subject, body, active) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [params.id, i, Number(step.delay_minutes) || 0, step.channel || 'email',
         step.subject || null, step.body || '', step.active === false ? 0 : 1]
      );
    });
  }
  json(res, {
    sequence: get('SELECT * FROM sequences WHERE id = ?', [params.id]),
    steps: all('SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY position', [params.id]),
  });
});

router.delete('/api/sequences/:id', ({ res, params }) => {
  const info = run('DELETE FROM sequences WHERE id = ?', [params.id]);
  if (!info.changes) throw notFound('Sequence not found');
  json(res, { deleted: true });
});

/** POST /api/sequences/:id/enroll — add leads to a drip. */
router.post('/api/sequences/:id/enroll', ({ res, params, body }) => {
  const ids = Array.isArray(body.lead_ids) ? body.lead_ids.map(Number).filter(Boolean) : [];
  if (!ids.length) throw bad('No leads selected');
  const results = ids.map((leadId) => {
    try { return { lead_id: leadId, ...enroll(Number(params.id), leadId, { restart: body.restart === true }) }; }
    catch (err) { return { lead_id: leadId, enrolled: false, reason: err.message }; }
  });
  json(res, {
    enrolled: results.filter((r) => r.enrolled).length,
    skipped: results.filter((r) => !r.enrolled).length,
    results,
  }, 201);
});

router.get('/api/enrollments', ({ res, query }) => {
  const where = [];
  const params = [];
  if (query.status && query.status !== 'all') { where.push('e.status = ?'); params.push(query.status); }
  if (query.sequence_id) { where.push('e.sequence_id = ?'); params.push(query.sequence_id); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  json(res, {
    enrollments: all(
      `SELECT e.*, l.name AS lead_name, l.phone, l.status AS lead_status, s.name AS sequence_name
       FROM enrollments e
       JOIN leads l ON l.id = e.lead_id
       JOIN sequences s ON s.id = e.sequence_id
       ${clause} ORDER BY e.status = 'active' DESC, e.next_run_at LIMIT 200`,
      params
    ),
  });
});

router.post('/api/enrollments/:id/stop', ({ res, params }) => {
  const e = get('SELECT * FROM enrollments WHERE id = ?', [params.id]);
  if (!e) throw notFound('Enrollment not found');
  stopEnrollments(e.lead_id, 'stopped by hand');
  json(res, { stopped: true });
});

// ---------------------------------------------------------------------------
// Jobs and messages
// ---------------------------------------------------------------------------

router.get('/api/jobs', ({ res, query }) => {
  const where = query.status && query.status !== 'all' ? 'WHERE status = ?' : '';
  const params = where ? [query.status] : [];
  json(res, {
    jobs: all(`SELECT * FROM scheduled_jobs ${where} ORDER BY run_at DESC LIMIT 100`, params)
      .map((j) => ({ ...j, payload: JSON.parse(j.payload_json || '{}') })),
    counts: Object.fromEntries(
      all('SELECT status, COUNT(*) AS n FROM scheduled_jobs GROUP BY status').map((r) => [r.status, r.n])
    ),
  });
});

router.post('/api/jobs/:id/run', async ({ res, params }) => {
  const job = get('SELECT * FROM scheduled_jobs WHERE id = ?', [params.id]);
  if (!job) throw notFound('Job not found');
  run("UPDATE scheduled_jobs SET run_at = datetime('now'), status = 'pending' WHERE id = ?", [params.id]);
  await runJob(get('SELECT * FROM scheduled_jobs WHERE id = ?', [params.id]));
  json(res, { job: get('SELECT * FROM scheduled_jobs WHERE id = ?', [params.id]) });
});

router.delete('/api/jobs/:id', ({ res, params }) => {
  const info = run("UPDATE scheduled_jobs SET status = 'cancelled' WHERE id = ? AND status = 'pending'", [params.id]);
  if (!info.changes) throw bad('That job already ran or was cancelled');
  json(res, { cancelled: true });
});

router.get('/api/messages', ({ res, query }) => {
  const where = [];
  const params = [];
  if (query.direction && query.direction !== 'all') { where.push('m.direction = ?'); params.push(query.direction); }
  if (query.lead_id) { where.push('m.lead_id = ?'); params.push(query.lead_id); }
  if (query.q) { where.push('(m.body LIKE ? OR m.to_addr LIKE ? OR m.from_addr LIKE ?)');
    const like = `%${query.q}%`; params.push(like, like, like); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  json(res, {
    messages: all(
      `SELECT m.*, l.name AS lead_name FROM messages m
       LEFT JOIN leads l ON l.id = m.lead_id
       ${clause} ORDER BY m.created_at DESC LIMIT 200`, params
    ),
    counts: Object.fromEntries(
      all('SELECT direction, COUNT(*) AS n FROM messages GROUP BY direction').map((r) => [r.direction, r.n])
    ),
  });
});

/** POST /api/messages — send one by hand from the dialer or a lead. */
router.post('/api/messages', async ({ res, body }) => {
  if (!body.body) throw bad('No message to send');
  const result = await sendMessage({
    leadId: body.lead_id ? Number(body.lead_id) : null,
    to: body.to || null,
    body: body.body,
    source: 'manual',
  });
  if (!result.sent) throw bad(result.error || 'Could not send that text');
  json(res, result, 201);
});

export default router;
