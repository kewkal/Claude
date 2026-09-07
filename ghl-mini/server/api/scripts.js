import { Router, json, bad, notFound } from '../lib/http.js';
import { all, get, run } from '../lib/db.js';
import { queueRun } from '../lib/agents.js';

export const SCRIPT_KINDS = ['call', 'email', 'sms', 'voicemail', 'objection'];

const router = new Router();

router.get('/api/scripts', ({ res, query }) => {
  const where = [];
  const params = [];
  if (query.kind && query.kind !== 'all') { where.push('kind = ?'); params.push(query.kind); }
  if (query.segment) { where.push('segment = ?'); params.push(query.segment); }
  if (query.q) { where.push('(name LIKE ? OR body LIKE ?)'); params.push(`%${query.q}%`, `%${query.q}%`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const scripts = all(
    `SELECT * FROM scripts ${clause} ORDER BY is_default DESC, uses DESC, name ASC`, params
  );
  const segments = all("SELECT DISTINCT segment FROM scripts WHERE segment != '' ORDER BY segment").map((r) => r.segment);
  json(res, { scripts, kinds: SCRIPT_KINDS, segments });
});

router.get('/api/scripts/:id', ({ res, params }) => {
  const script = get('SELECT * FROM scripts WHERE id = ?', [params.id]);
  if (!script) throw notFound('Script not found');
  json(res, { script });
});

router.post('/api/scripts', ({ res, body }) => {
  if (!body.name) throw bad('A script needs a name');
  const kind = body.kind || 'call';
  if (!SCRIPT_KINDS.includes(kind)) throw bad(`Unknown script kind: ${kind}`);
  const info = run(
    'INSERT INTO scripts (name, kind, segment, subject, body, is_default) VALUES (?, ?, ?, ?, ?, ?)',
    [body.name, kind, body.segment || 'general', body.subject || null, body.body || '', body.is_default ? 1 : 0]
  );
  json(res, { script: get('SELECT * FROM scripts WHERE id = ?', [Number(info.lastInsertRowid)]) }, 201);
});

router.patch('/api/scripts/:id', ({ res, params, body }) => {
  const script = get('SELECT * FROM scripts WHERE id = ?', [params.id]);
  if (!script) throw notFound('Script not found');
  const allowed = ['name', 'kind', 'segment', 'subject', 'body', 'is_default'];
  const data = {};
  for (const f of allowed) if (body[f] !== undefined) data[f] = f === 'is_default' ? (body[f] ? 1 : 0) : body[f];
  if (!Object.keys(data).length) throw bad('Nothing to update');
  run(
    `UPDATE scripts SET ${Object.keys(data).map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`,
    [...Object.values(data), params.id]
  );
  json(res, { script: get('SELECT * FROM scripts WHERE id = ?', [params.id]) });
});

router.delete('/api/scripts/:id', ({ res, params }) => {
  const info = run('DELETE FROM scripts WHERE id = ?', [params.id]);
  if (!info.changes) throw notFound('Script not found');
  json(res, { deleted: true });
});

/** POST /api/scripts/:id/render — fill {{tokens}} from a lead. */
router.post('/api/scripts/:id/render', ({ res, params, body }) => {
  const script = get('SELECT * FROM scripts WHERE id = ?', [params.id]);
  if (!script) throw notFound('Script not found');
  const lead = body.lead_id ? get('SELECT * FROM leads WHERE id = ?', [body.lead_id]) : {};
  const owner = lead?.owner_name || '';
  const vars = {
    ...(lead || {}),
    owner,
    owner_first: owner.split(' ')[0] || '',
    owner_email: lead?.owner_email || lead?.email || '',
    ...(body.vars || {}),
  };
  json(res, {
    subject: render(script.subject || '', vars),
    body: render(script.body || '', vars),
  });
});

/** POST /api/scripts/generate — hand it to the Outreach Writer agent. */
router.post('/api/scripts/generate', ({ res, body }) => {
  const agent = body.kind === 'call' || body.kind === 'objection' ? 'call-closer' : 'outreach-writer';
  const queued = queueRun({
    agent,
    task: body.task || `Write ${body.kind || 'email'} scripts for the "${body.segment}" segment and save them to the scripts table.`,
    input: { segment: body.segment || 'general', offer: body.offer || '', tone: body.tone || '', kind: body.kind || 'email' },
  });
  json(res, { run: queued }, 202);
});

export function render(template, vars) {
  return String(template).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key) => {
    const value = key.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), vars);
    return value == null || value === '' ? match : String(value);
  });
}

export default router;
