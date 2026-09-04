import { Router, json, bad, notFound } from '../lib/http.js';
import { all, get, run } from '../lib/db.js';
import { allSettings } from '../lib/settings.js';
import { logActivity } from './leads.js';
import { sendEmail } from '../lib/email.js';

const router = new Router();

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

router.get('/api/bookings', ({ res, query }) => {
  const where = [];
  const params = [];
  if (query.from) { where.push('starts_at >= ?'); params.push(query.from); }
  if (query.to) { where.push('starts_at <= ?'); params.push(query.to); }
  if (query.status && query.status !== 'all') { where.push('status = ?'); params.push(query.status); }
  if (query.upcoming === '1') where.push("starts_at >= datetime('now')");
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const bookings = all(
    `SELECT b.*, l.name AS lead_business, l.phone AS lead_phone
     FROM bookings b LEFT JOIN leads l ON l.id = b.lead_id
     ${clause} ORDER BY starts_at ASC LIMIT 500`, params
  );
  json(res, { bookings });
});

router.get('/api/bookings/stats', ({ res }) => {
  const stats = get(`
    SELECT
      COALESCE(SUM(CASE WHEN date(starts_at) = date('now') THEN 1 ELSE 0 END), 0) AS today,
      COALESCE(SUM(CASE WHEN starts_at >= datetime('now') AND starts_at <= datetime('now','+7 days') THEN 1 ELSE 0 END), 0) AS this_week,
      COALESCE(SUM(CASE WHEN status = 'no_show' THEN 1 ELSE 0 END), 0) AS no_shows,
      COUNT(*) AS total
    FROM bookings`);
  const next = all(
    "SELECT * FROM bookings WHERE starts_at >= datetime('now') AND status = 'confirmed' ORDER BY starts_at ASC LIMIT 5"
  );
  json(res, { ...stats, next });
});

router.post('/api/bookings', async ({ res, body }) => {
  if (!body.name) throw bad('A booking needs a name');
  if (!body.starts_at) throw bad('A booking needs a start time');
  const settings = allSettings();
  const durationMin = Number(body.duration_min) || Number(settings.booking_duration_min) || 30;
  const start = new Date(body.starts_at);
  if (Number.isNaN(start.getTime())) throw bad('That start time is not a valid date');
  const end = body.ends_at ? new Date(body.ends_at) : new Date(start.getTime() + durationMin * 60000);

  const info = run(
    `INSERT INTO bookings (lead_id, title, name, email, phone, starts_at, ends_at, timezone, status, notes, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      body.lead_id || null, body.title || settings.booking_title || 'Discovery call',
      body.name, body.email || null, body.phone || null,
      iso(start), iso(end), body.timezone || settings.timezone,
      body.status || 'confirmed', body.notes || '', body.source || 'internal',
    ]
  );
  const id = Number(info.lastInsertRowid);

  if (body.lead_id) {
    run("UPDATE leads SET status = 'booked', next_action_at = ?, updated_at = datetime('now') WHERE id = ?", [
      iso(start), body.lead_id,
    ]);
    logActivity(body.lead_id, 'booking', `Booked ${start.toISOString()}`);
  }

  if (body.notify !== false && body.email) {
    await sendEmail({
      to: body.email,
      leadId: body.lead_id || null,
      subject: `Confirmed: ${body.title || settings.booking_title} — ${start.toUTCString()}`,
      body: `Hi ${body.name},\n\nYou're booked in for ${start.toUTCString()}.\n\n${body.notes || ''}\n\n— ${settings.business_name}`,
    }).catch(() => {});
  }

  json(res, { booking: get('SELECT * FROM bookings WHERE id = ?', [id]) }, 201);
});

router.patch('/api/bookings/:id', ({ res, params, body }) => {
  const booking = get('SELECT * FROM bookings WHERE id = ?', [params.id]);
  if (!booking) throw notFound('Booking not found');
  const allowed = ['title', 'name', 'email', 'phone', 'starts_at', 'ends_at', 'status', 'notes'];
  const data = {};
  for (const f of allowed) if (body[f] !== undefined) data[f] = body[f];
  if (!Object.keys(data).length) throw bad('Nothing to update');
  run(
    `UPDATE bookings SET ${Object.keys(data).map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(data), params.id]
  );
  if (data.status === 'no_show' && booking.lead_id) {
    run("UPDATE leads SET status = 'callback', next_action_at = datetime('now','+1 day') WHERE id = ?", [booking.lead_id]);
    logActivity(booking.lead_id, 'booking', 'No-show — moved to callback');
  }
  json(res, { booking: get('SELECT * FROM bookings WHERE id = ?', [params.id]) });
});

router.delete('/api/bookings/:id', ({ res, params }) => {
  const info = run('DELETE FROM bookings WHERE id = ?', [params.id]);
  if (!info.changes) throw notFound('Booking not found');
  json(res, { deleted: true });
});

/** GET /api/availability */
router.get('/api/availability', ({ res }) => {
  const rows = all('SELECT * FROM availability ORDER BY weekday, start_min');
  json(res, { availability: rows.map((r) => ({ ...r, weekday_name: DAY_NAMES[r.weekday] })), days: DAY_NAMES });
});

router.put('/api/availability', ({ res, body }) => {
  const rules = Array.isArray(body.availability) ? body.availability : [];
  run('DELETE FROM availability');
  for (const r of rules) {
    run('INSERT INTO availability (weekday, start_min, end_min, slot_min, active) VALUES (?, ?, ?, ?, ?)', [
      Number(r.weekday), Number(r.start_min), Number(r.end_min), Number(r.slot_min) || 30, r.active === false ? 0 : 1,
    ]);
  }
  json(res, { availability: all('SELECT * FROM availability ORDER BY weekday, start_min') });
});

/** GET /api/slots?days=14 — free slots for the public booking page. */
router.get('/api/slots', ({ res, query }) => {
  const days = Math.min(60, Math.max(1, Number(query.days) || 14));
  const rules = all('SELECT * FROM availability WHERE active = 1');
  const booked = all("SELECT starts_at, ends_at FROM bookings WHERE status != 'cancelled' AND starts_at >= datetime('now')");
  const slots = [];
  const now = Date.now();

  for (let d = 0; d < days; d++) {
    const day = new Date(now + d * 864e5);
    const weekday = day.getUTCDay();
    for (const rule of rules.filter((r) => r.weekday === weekday)) {
      for (let m = rule.start_min; m + rule.slot_min <= rule.end_min; m += rule.slot_min) {
        const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, m));
        if (start.getTime() < now + 3600e3) continue;
        const end = new Date(start.getTime() + rule.slot_min * 60000);
        const clash = booked.some((b) => {
          const bs = new Date(b.starts_at.replace(' ', 'T') + 'Z').getTime();
          const be = new Date(b.ends_at.replace(' ', 'T') + 'Z').getTime();
          return start.getTime() < be && end.getTime() > bs;
        });
        if (!clash) slots.push({ starts_at: start.toISOString(), ends_at: end.toISOString(), minutes: rule.slot_min });
      }
    }
  }
  slots.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  json(res, { slots: slots.slice(0, 200) });
});

/** GET /api/calendar.ics — subscribe from any calendar app. */
router.get('/api/calendar.ics', ({ res }) => {
  const bookings = all("SELECT * FROM bookings WHERE status != 'cancelled' ORDER BY starts_at");
  const settings = allSettings();
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ghl-mini//EN', 'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${settings.business_name} bookings`,
  ];
  for (const b of bookings) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:ghl-mini-${b.id}@localhost`,
      `DTSTAMP:${icsTime(b.created_at)}`,
      `DTSTART:${icsTime(b.starts_at)}`,
      `DTEND:${icsTime(b.ends_at)}`,
      `SUMMARY:${icsEscape(`${b.title} — ${b.name}`)}`,
      `DESCRIPTION:${icsEscape([b.email, b.phone, b.notes].filter(Boolean).join(' | '))}`,
      `STATUS:${b.status === 'confirmed' ? 'CONFIRMED' : 'TENTATIVE'}`,
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  const body = lines.join('\r\n');
  res.writeHead(200, {
    'content-type': 'text/calendar; charset=utf-8',
    'content-disposition': 'inline; filename="bookings.ics"',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
});

const iso = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const icsTime = (v) => new Date(String(v).replace(' ', 'T') + (String(v).endsWith('Z') ? '' : 'Z'))
  .toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
const icsEscape = (v) => String(v ?? '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');

export default router;
