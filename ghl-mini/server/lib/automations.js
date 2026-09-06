import { all, get, run } from './db.js';
import { allSettings } from './settings.js';
import { sendMessage, sendSequenceEmail, render, leadVars, nextAllowedSendTime, stopEnrollments } from './messaging.js';

const sqlTime = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const parseUtc = (v) => new Date(String(v).replace(' ', 'T') + (/[Zz]$/.test(String(v)) ? '' : 'Z'));

/**
 * Queue a job. `dedupeKey` makes scheduling idempotent, so the sweep can
 * run every minute without ever double-booking the same reminder.
 */
export function schedule({ kind, runAt, payload = {}, dedupeKey = null }) {
  try {
    const info = run(
      'INSERT INTO scheduled_jobs (kind, dedupe_key, run_at, payload_json) VALUES (?, ?, ?, ?)',
      [kind, dedupeKey, sqlTime(runAt instanceof Date ? runAt : new Date(runAt)), JSON.stringify(payload)]
    );
    return Number(info.lastInsertRowid);
  } catch {
    return null; // dedupe_key already present — already scheduled.
  }
}

export function cancelJobs(kind, dedupeKeyLike, reason = 'cancelled') {
  return run(
    "UPDATE scheduled_jobs SET status = 'cancelled', result = ? WHERE status = 'pending' AND kind = ? AND dedupe_key LIKE ?",
    [reason, kind, dedupeKeyLike]
  ).changes;
}

// ---------------------------------------------------------------------------
// 1. Missed-call text-back
// ---------------------------------------------------------------------------

/**
 * Fired by the Twilio voice webhook when an inbound call is not answered.
 * The value here is speed, so it sends immediately rather than queueing.
 */
export async function missedCallTextBack({ from, to, callSid }) {
  const s = allSettings();
  if (s.automation_missed_call !== '1') return { skipped: 'Missed-call text-back is off.' };

  const digits = String(from || '').replace(/\D/g, '').slice(-10);
  let lead = digits
    ? get(
        `SELECT * FROM leads
         WHERE replace(replace(replace(replace(replace(phone,'(',''),')',''),'-',''),' ',''),'+','') LIKE ?
         ORDER BY id LIMIT 1`,
        [`%${digits}`]
      )
    : null;

  // An unknown caller who rings you is a lead. Capture it.
  if (!lead && from) {
    const info = run(
      `INSERT INTO leads (name, phone, status, source, score, notes)
       VALUES (?, ?, 'callback', 'inbound_call', 70, ?)`,
      [`Inbound ${from}`, from, 'Called in and did not get through.']
    );
    lead = get('SELECT * FROM leads WHERE id = ?', [Number(info.lastInsertRowid)]);
  }

  run('INSERT INTO calls (lead_id, lead_name, phone, direction, outcome, provider, provider_sid) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    lead?.id ?? null, lead?.name ?? null, from || null, 'inbound', 'no_answer', 'twilio', callSid || null,
  ]);

  const body = render(s.automation_missed_call_body, leadVars(lead || {}));
  const result = await sendMessage({ leadId: lead?.id ?? null, to: from, body, source: 'missed_call' });

  if (lead) {
    run("UPDATE leads SET status = CASE WHEN status = 'dnc' THEN status ELSE 'callback' END, next_action_at = datetime('now') WHERE id = ?", [lead.id]);
  }
  return { lead_id: lead?.id ?? null, ...result };
}

// ---------------------------------------------------------------------------
// 2. Appointment reminders  &  4. No-show recovery
// ---------------------------------------------------------------------------

/** Idempotent sweep: queue reminder and no-show jobs for upcoming bookings. */
export function sweepBookings() {
  const s = allSettings();
  const queued = { reminders: 0, noShows: 0 };

  if (s.automation_reminder === '1') {
    const hours = Number(s.automation_reminder_hours) || 24;
    // Look well past the reminder point rather than only just past it. The
    // exact send time comes from `fireAt` below, so a wide window costs
    // nothing and means a booking cannot slip through unreminded while the
    // app happens to be stopped.
    const bookings = all(
      `SELECT * FROM bookings
       WHERE status = 'confirmed' AND starts_at > datetime('now')
         AND starts_at <= datetime('now', ?)`,
      [`+${hours + 72} hours`]
    );
    // Short notice is exactly when a reminder earns its keep, so a booking
    // made inside the window still gets one — just sent right away rather
    // than at a time that has already passed.
    const MIN_LEAD_MS = 30 * 60000;
    for (const b of bookings) {
      const startsAt = parseUtc(b.starts_at).getTime();
      const ideal = startsAt - hours * 3600e3;
      if (startsAt - Date.now() < MIN_LEAD_MS) continue;
      const fireAt = new Date(Math.max(ideal, Date.now()));
      if (schedule({
        kind: 'booking_reminder',
        runAt: fireAt,
        payload: { booking_id: b.id },
        dedupeKey: `reminder:${b.id}`,
      })) queued.reminders++;
    }
  }

  if (s.automation_no_show === '1') {
    const mins = Number(s.automation_no_show_minutes) || 15;
    const bookings = all(
      `SELECT * FROM bookings
       WHERE status = 'confirmed' AND starts_at <= datetime('now')
         AND starts_at >= datetime('now', '-2 days')`
    );
    for (const b of bookings) {
      const fireAt = new Date(parseUtc(b.starts_at).getTime() + mins * 60000);
      if (schedule({
        kind: 'no_show_check',
        runAt: fireAt,
        payload: { booking_id: b.id },
        dedupeKey: `noshow:${b.id}`,
      })) queued.noShows++;
    }
  }

  return queued;
}

async function runBookingReminder({ booking_id }) {
  const s = allSettings();
  const b = get('SELECT * FROM bookings WHERE id = ?', [booking_id]);
  if (!b) return 'Booking no longer exists.';
  if (b.status !== 'confirmed') return `Booking is ${b.status}, skipped.`;

  const lead = b.lead_id ? get('SELECT * FROM leads WHERE id = ?', [b.lead_id]) : null;
  const when = parseUtc(b.starts_at).toLocaleString('en-US', {
    timeZone: s.timezone || 'UTC', weekday: 'long', hour: 'numeric', minute: '2-digit',
  });
  const vars = leadVars({ ...(lead || {}), name: b.name }, { when, title: b.title });
  const done = [];

  if (s.automation_reminder_sms === '1') {
    const r = await sendMessage({
      leadId: b.lead_id, to: b.phone || lead?.phone,
      body: render(s.automation_reminder_body, vars), source: 'reminder',
    });
    done.push(`sms:${r.sent ? 'sent' : r.error || 'skipped'}`);
  }
  if (s.automation_reminder_email === '1' && (b.email || lead?.email)) {
    const r = await sendSequenceEmail({
      leadId: b.lead_id, to: b.email || lead?.email,
      subject: `Reminder: ${b.title} ${when}`,
      body: render(s.automation_reminder_body, vars) + `\n\n— ${s.business_name}`,
    });
    done.push(`email:${r.sent ? 'sent' : r.error || 'not sent'}`);
  }
  return done.join(' · ') || 'Nothing enabled to send.';
}

async function runNoShowCheck({ booking_id }) {
  const s = allSettings();
  const b = get('SELECT * FROM bookings WHERE id = ?', [booking_id]);
  if (!b) return 'Booking no longer exists.';
  if (b.status !== 'confirmed') return `Already marked ${b.status}.`;

  // A call logged around the booking means it happened.
  const held = b.lead_id && get(
    `SELECT id FROM calls WHERE lead_id = ? AND started_at >= datetime(?, '-15 minutes')`,
    [b.lead_id, b.starts_at]
  );
  if (held) {
    run("UPDATE bookings SET status = 'completed' WHERE id = ?", [booking_id]);
    return 'Call was logged — marked completed.';
  }

  run("UPDATE bookings SET status = 'no_show' WHERE id = ?", [booking_id]);
  if (b.lead_id) {
    run("UPDATE leads SET status = 'callback', next_action_at = datetime('now','+1 day') WHERE id = ?", [b.lead_id]);
    run('INSERT INTO activity (lead_id, kind, summary) VALUES (?, ?, ?)', [
      b.lead_id, 'booking', 'No-show — recovery message sent',
    ]);
  }
  const lead = b.lead_id ? get('SELECT * FROM leads WHERE id = ?', [b.lead_id]) : null;
  const r = await sendMessage({
    leadId: b.lead_id, to: b.phone || lead?.phone,
    body: render(s.automation_no_show_body, leadVars({ ...(lead || {}), name: b.name })),
    source: 'no_show',
  });
  return `Marked no-show. Text ${r.sent ? 'sent' : r.error || 'skipped'}.`;
}

// ---------------------------------------------------------------------------
// 3. Drip sequences
// ---------------------------------------------------------------------------

export function enroll(sequenceId, leadId, { restart = false } = {}) {
  const seq = get('SELECT * FROM sequences WHERE id = ?', [sequenceId]);
  if (!seq) throw new Error('No such sequence');
  const lead = get('SELECT * FROM leads WHERE id = ?', [leadId]);
  if (!lead) throw new Error('No such lead');
  if (lead.status === 'dnc') return { enrolled: false, reason: 'Lead is do-not-call' };

  const steps = all('SELECT * FROM sequence_steps WHERE sequence_id = ? AND active = 1 ORDER BY position', [sequenceId]);
  if (!steps.length) return { enrolled: false, reason: 'Sequence has no steps' };

  const existing = get('SELECT * FROM enrollments WHERE sequence_id = ? AND lead_id = ?', [sequenceId, leadId]);
  if (existing && existing.status === 'active') return { enrolled: false, reason: 'Already enrolled' };
  if (existing && !restart) return { enrolled: false, reason: `Already ran (${existing.status})` };

  const firstAt = new Date(Date.now() + (steps[0].delay_minutes || 0) * 60000);
  if (existing) {
    run(
      `UPDATE enrollments SET status = 'active', step_index = 0, next_run_at = ?, stop_reason = NULL,
       started_at = datetime('now'), completed_at = NULL WHERE id = ?`,
      [sqlTime(firstAt), existing.id]
    );
  } else {
    run('INSERT INTO enrollments (sequence_id, lead_id, next_run_at) VALUES (?, ?, ?)', [
      sequenceId, leadId, sqlTime(firstAt),
    ]);
  }
  const enrollment = get('SELECT * FROM enrollments WHERE sequence_id = ? AND lead_id = ?', [sequenceId, leadId]);
  schedule({
    kind: 'sequence_step',
    runAt: firstAt,
    payload: { enrollment_id: enrollment.id, lead_id: leadId, step_index: 0 },
    dedupeKey: `seq:${enrollment.id}:0`,
  });
  return { enrolled: true, enrollment_id: enrollment.id, first_touch: sqlTime(firstAt) };
}

async function runSequenceStep({ enrollment_id, step_index }) {
  const e = get('SELECT * FROM enrollments WHERE id = ?', [enrollment_id]);
  if (!e) return 'Enrollment gone.';
  if (e.status !== 'active') return `Enrollment is ${e.status}.`;

  const steps = all('SELECT * FROM sequence_steps WHERE sequence_id = ? AND active = 1 ORDER BY position', [e.sequence_id]);
  const step = steps[step_index];
  if (!step) {
    run("UPDATE enrollments SET status = 'done', completed_at = datetime('now'), next_run_at = NULL WHERE id = ?", [enrollment_id]);
    return 'Sequence finished.';
  }

  const lead = get('SELECT * FROM leads WHERE id = ?', [e.lead_id]);
  if (!lead) return 'Lead gone.';
  if (lead.status === 'dnc') {
    stopEnrollments(lead.id, 'do-not-call');
    return 'Lead is do-not-call — stopped.';
  }

  const vars = leadVars(lead);
  let outcome;
  if (step.channel === 'sms') {
    const r = await sendMessage({ leadId: lead.id, body: render(step.body, vars), source: 'sequence' });
    outcome = `sms ${r.sent ? 'sent' : r.error || 'skipped'}`;
  } else if (step.channel === 'email') {
    const r = await sendSequenceEmail({
      leadId: lead.id, subject: render(step.subject || '', vars), body: render(step.body, vars),
    });
    outcome = `email ${r.sent ? 'sent' : r.error || 'not sent'}`;
  } else {
    run('INSERT INTO tasks (day, title, lead_id) VALUES (date(\'now\'), ?, ?)', [
      render(step.body, vars) || `Follow up with ${lead.name}`, lead.id,
    ]);
    outcome = 'task added';
  }

  run('INSERT INTO activity (lead_id, kind, summary) VALUES (?, ?, ?)', [
    lead.id, 'sequence', `Step ${step_index + 1}: ${outcome}`,
  ]);
  if (lead.status === 'new' || lead.status === 'queued') {
    run("UPDATE leads SET status = 'contacted', updated_at = datetime('now') WHERE id = ?", [lead.id]);
  }

  const next = steps[step_index + 1];
  if (!next) {
    run("UPDATE enrollments SET status = 'done', step_index = ?, completed_at = datetime('now'), next_run_at = NULL WHERE id = ?", [
      step_index + 1, enrollment_id,
    ]);
    return `${outcome}. Sequence finished.`;
  }

  const nextAt = new Date(Date.now() + (next.delay_minutes || 0) * 60000);
  run('UPDATE enrollments SET step_index = ?, next_run_at = ? WHERE id = ?', [
    step_index + 1, sqlTime(nextAt), enrollment_id,
  ]);
  schedule({
    kind: 'sequence_step',
    runAt: nextAt,
    payload: { enrollment_id, lead_id: lead.id, step_index: step_index + 1 },
    dedupeKey: `seq:${enrollment_id}:${step_index + 1}`,
  });
  return `${outcome}. Next step ${sqlTime(nextAt)}.`;
}

// ---------------------------------------------------------------------------
// Job dispatch
// ---------------------------------------------------------------------------

const HANDLERS = {
  sequence_step: runSequenceStep,
  booking_reminder: runBookingReminder,
  no_show_check: runNoShowCheck,
};

/** Does this job type text a person? Those obey quiet hours. */
const TEXTS_PEOPLE = new Set(['sequence_step', 'booking_reminder', 'no_show_check']);

export async function runJob(job) {
  const handler = HANDLERS[job.kind];
  if (!handler) {
    run("UPDATE scheduled_jobs SET status = 'failed', last_error = ?, ran_at = datetime('now') WHERE id = ?", [
      `No handler for "${job.kind}"`, job.id,
    ]);
    return;
  }

  // Defer rather than drop, so a reminder queued for 2am still goes out at 8am.
  if (TEXTS_PEOPLE.has(job.kind)) {
    const defer = nextAllowedSendTime(new Date());
    if (defer) {
      run("UPDATE scheduled_jobs SET run_at = ?, result = 'deferred past quiet hours' WHERE id = ?", [
        sqlTime(defer), job.id,
      ]);
      return;
    }
  }

  run("UPDATE scheduled_jobs SET status = 'running', attempts = attempts + 1 WHERE id = ?", [job.id]);
  try {
    const result = await handler(JSON.parse(job.payload_json || '{}'));
    run("UPDATE scheduled_jobs SET status = 'done', result = ?, ran_at = datetime('now') WHERE id = ?", [
      String(result ?? 'ok').slice(0, 500), job.id,
    ]);
  } catch (err) {
    const failed = job.attempts + 1 >= 3;
    run(
      `UPDATE scheduled_jobs SET status = ?, last_error = ?, run_at = ?, ran_at = datetime('now') WHERE id = ?`,
      [
        failed ? 'failed' : 'pending',
        String(err.message).slice(0, 500),
        sqlTime(new Date(Date.now() + 10 * 60000)),
        job.id,
      ]
    );
  }
}

export function dueJobs(limit = 25) {
  return all(
    "SELECT * FROM scheduled_jobs WHERE status = 'pending' AND run_at <= datetime('now') ORDER BY run_at LIMIT ?",
    [limit]
  );
}

/** Auto-enroll leads into sequences whose trigger matches their status. */
export function sweepTriggers() {
  const s = allSettings();
  if (s.automation_sequences !== '1') return 0;
  let count = 0;
  const sequences = all("SELECT * FROM sequences WHERE active = 1 AND trigger LIKE 'lead_status:%'");
  for (const seq of sequences) {
    const status = seq.trigger.split(':')[1];
    const leads = all(
      `SELECT l.id FROM leads l
       WHERE l.status = ? AND l.status != 'dnc'
         AND NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.lead_id = l.id AND e.sequence_id = ?)
       LIMIT 100`,
      [status, seq.id]
    );
    for (const lead of leads) {
      try { if (enroll(seq.id, lead.id).enrolled) count++; } catch { /* skip */ }
    }
  }
  return count;
}
