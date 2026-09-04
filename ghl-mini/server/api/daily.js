import { Router, json, bad, notFound } from '../lib/http.js';
import { all, get, run } from '../lib/db.js';
import { allSettings } from '../lib/settings.js';

const router = new Router();

const today = () => new Date().toISOString().slice(0, 10);

/** GET /api/daily — the Daily HQ payload for one day. */
router.get('/api/daily', ({ res, query }) => {
  const day = query.day || today();
  const settings = allSettings();

  let log = get('SELECT * FROM daily_logs WHERE day = ?', [day]);
  if (!log) {
    run('INSERT INTO daily_logs (day, target_hours) VALUES (?, ?)', [day, Number(settings.daily_target_hours) || 6]);
    log = get('SELECT * FROM daily_logs WHERE day = ?', [day]);
  }

  const calls = get(
    `SELECT COUNT(*) AS made,
            COALESCE(SUM(CASE WHEN outcome = 'connected' THEN 1 ELSE 0 END), 0) AS connected,
            COALESCE(SUM(CASE WHEN outcome = 'booked' THEN 1 ELSE 0 END), 0) AS booked,
            COALESCE(SUM(duration_sec), 0) AS talk_time
     FROM calls WHERE date(started_at) = ?`, [day]
  );
  const leads = get('SELECT COUNT(*) AS added FROM leads WHERE date(created_at) = ?', [day]);
  const bookings = all(
    `SELECT b.*, l.name AS lead_business FROM bookings b LEFT JOIN leads l ON l.id = b.lead_id
     WHERE date(b.starts_at) = ? ORDER BY b.starts_at`, [day]
  );
  const tasks = all('SELECT * FROM tasks WHERE day = ? OR (day IS NULL AND done = 0) ORDER BY done, id', [day]);
  const due = all(
    `SELECT id, name, phone, status, score, next_action_at FROM leads
     WHERE next_action_at IS NOT NULL AND date(next_action_at) <= ?
       AND status NOT IN ('won','lost','dnc')
     ORDER BY next_action_at LIMIT 25`, [day]
  );
  const onboarding = all(
    "SELECT id, business, client_name, status, created_at FROM onboarding_responses WHERE status IN ('new','briefed') ORDER BY created_at DESC LIMIT 10"
  );

  json(res, {
    day,
    log,
    targets: {
      hours: Number(settings.daily_target_hours) || 6,
      calls: Number(settings.daily_call_target) || 40,
    },
    calls, leads, bookings, tasks, due, onboarding,
  });
});

/** PUT /api/daily — save the day. */
router.put('/api/daily', ({ res, body }) => {
  const day = body.day || today();
  const allowed = ['target_hours', 'worked_hours', 'focus', 'wins', 'blockers', 'notes', 'revenue_cents'];
  const data = {};
  for (const f of allowed) if (body[f] !== undefined) data[f] = body[f];
  if (!Object.keys(data).length) throw bad('Nothing to save');

  run('INSERT OR IGNORE INTO daily_logs (day) VALUES (?)', [day]);
  run(
    `UPDATE daily_logs SET ${Object.keys(data).map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE day = ?`,
    [...Object.values(data), day]
  );
  json(res, { log: get('SELECT * FROM daily_logs WHERE day = ?', [day]) });
});

/** GET /api/daily/history?days=30 */
router.get('/api/daily/history', ({ res, query }) => {
  const days = Math.min(365, Math.max(1, Number(query.days) || 30));
  const logs = all(
    `SELECT * FROM daily_logs WHERE day >= date('now', ?) ORDER BY day DESC`, [`-${days} days`]
  );
  const calls = all(
    `SELECT date(started_at) AS day, COUNT(*) AS calls,
            SUM(CASE WHEN outcome = 'booked' THEN 1 ELSE 0 END) AS booked
     FROM calls WHERE started_at >= date('now', ?) GROUP BY day`, [`-${days} days`]
  );
  const callsByDay = Object.fromEntries(calls.map((c) => [c.day, c]));
  json(res, {
    history: logs.map((l) => ({ ...l, calls: callsByDay[l.day]?.calls || 0, booked: callsByDay[l.day]?.booked || 0 })),
    totals: {
      hours: logs.reduce((s, l) => s + (l.worked_hours || 0), 0),
      revenue_cents: logs.reduce((s, l) => s + (l.revenue_cents || 0), 0),
      calls: calls.reduce((s, c) => s + c.calls, 0),
      booked: calls.reduce((s, c) => s + c.booked, 0),
    },
  });
});

/** Tasks on the day board. */
router.post('/api/tasks', ({ res, body }) => {
  if (!body.title) throw bad('A task needs a title');
  const info = run('INSERT INTO tasks (day, title, lead_id) VALUES (?, ?, ?)', [
    body.day || today(), body.title, body.lead_id || null,
  ]);
  json(res, { task: get('SELECT * FROM tasks WHERE id = ?', [Number(info.lastInsertRowid)]) }, 201);
});

router.patch('/api/tasks/:id', ({ res, params, body }) => {
  const task = get('SELECT * FROM tasks WHERE id = ?', [params.id]);
  if (!task) throw notFound('Task not found');
  const data = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.done !== undefined) data.done = body.done ? 1 : 0;
  if (body.day !== undefined) data.day = body.day;
  if (!Object.keys(data).length) throw bad('Nothing to update');
  run(
    `UPDATE tasks SET ${Object.keys(data).map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(data), params.id]
  );
  json(res, { task: get('SELECT * FROM tasks WHERE id = ?', [params.id]) });
});

router.delete('/api/tasks/:id', ({ res, params }) => {
  const info = run('DELETE FROM tasks WHERE id = ?', [params.id]);
  if (!info.changes) throw notFound('Task not found');
  json(res, { deleted: true });
});

export default router;
