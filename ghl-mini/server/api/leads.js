import { Router, json, bad, notFound } from '../lib/http.js';
import { all, get, run, tx } from '../lib/db.js';
import { searchPlaces, scoreLead } from '../lib/maps.js';
import { queueRun } from '../lib/agents.js';

export const LEAD_STATUSES = [
  'new', 'queued', 'contacted', 'callback', 'booked', 'won', 'lost', 'dnc',
];

const FIELDS = [
  'name', 'category', 'phone', 'email', 'website', 'address', 'city', 'state',
  'postal_code', 'country', 'lat', 'lng', 'rating', 'review_count', 'place_id',
  'source', 'status', 'score', 'pipeline_value', 'tags', 'notes', 'search_query',
  'next_action_at',
];

export function logActivity(leadId, kind, summary, meta = {}) {
  if (!leadId) return;
  run('INSERT INTO activity (lead_id, kind, summary, meta_json) VALUES (?, ?, ?, ?)', [
    leadId, kind, summary, JSON.stringify(meta),
  ]);
}

const router = new Router();

/** GET /api/leads — paged, filtered, searchable. */
router.get('/api/leads', ({ res, query }) => {
  const limit = Math.min(500, Math.max(1, Number(query.limit) || 50));
  const page = Math.max(1, Number(query.page) || 1);
  const offset = (page - 1) * limit;

  const where = [];
  const params = [];

  if (query.status && query.status !== 'all') {
    where.push('status = ?');
    params.push(query.status);
  }
  if (query.city) { where.push('city LIKE ?'); params.push(`%${query.city}%`); }
  if (query.source) { where.push('source = ?'); params.push(query.source); }
  if (query.tag) { where.push('tags LIKE ?'); params.push(`%${query.tag}%`); }
  if (query.has_website === '0') where.push("(website IS NULL OR website = '')");
  if (query.has_website === '1') where.push("(website IS NOT NULL AND website != '')");
  if (query.has_phone === '1') where.push("(phone IS NOT NULL AND phone != '')");
  if (query.min_score) { where.push('score >= ?'); params.push(Number(query.min_score)); }
  if (query.q) {
    const like = `%${query.q}%`;
    // Someone typing a number back from a missed call types digits, not
    // "(404) 555-1234", so match against the stripped number too.
    const digits = String(query.q).replace(/\D/g, '');
    if (digits.length >= 4) {
      where.push(
        `(name LIKE ? OR phone LIKE ? OR email LIKE ? OR address LIKE ? OR category LIKE ?
          OR replace(replace(replace(replace(replace(phone,'(',''),')',''),'-',''),' ',''),'+','') LIKE ?)`
      );
      params.push(like, like, like, like, like, `%${digits}%`);
    } else {
      where.push('(name LIKE ? OR phone LIKE ? OR email LIKE ? OR address LIKE ? OR category LIKE ?)');
      params.push(like, like, like, like, like);
    }
  }
  if (query.due === '1') {
    where.push("next_action_at IS NOT NULL AND next_action_at <= datetime('now')");
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sortMap = {
    score: 'score DESC, review_count DESC',
    newest: 'created_at DESC',
    oldest: 'created_at ASC',
    name: 'name COLLATE NOCASE ASC',
    reviews: 'review_count DESC',
    next: 'next_action_at IS NULL, next_action_at ASC',
  };
  const order = sortMap[query.sort] || sortMap.score;

  const total = get(`SELECT COUNT(*) AS n FROM leads ${clause}`, params).n;
  const rows = all(
    `SELECT * FROM leads ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  json(res, { leads: rows, total, page, limit, pages: Math.ceil(total / limit) || 1 });
});

/** GET /api/leads/stats — counts for the dashboard. */
router.get('/api/leads/stats', ({ res }) => {
  const byStatus = Object.fromEntries(
    all('SELECT status, COUNT(*) AS n FROM leads GROUP BY status').map((r) => [r.status, r.n])
  );
  const totals = get(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN website IS NULL OR website = '' THEN 1 ELSE 0 END), 0) AS no_website,
           COALESCE(SUM(CASE WHEN phone IS NOT NULL AND phone != '' THEN 1 ELSE 0 END), 0) AS callable,
           COALESCE(SUM(CASE WHEN date(created_at) = date('now') THEN 1 ELSE 0 END), 0) AS added_today,
           COALESCE(SUM(pipeline_value), 0) AS pipeline_value
    FROM leads`);
  const due = get(
    "SELECT COUNT(*) AS n FROM leads WHERE next_action_at IS NOT NULL AND next_action_at <= datetime('now')"
  ).n;
  const topCities = all(
    "SELECT city, COUNT(*) AS n FROM leads WHERE city IS NOT NULL AND city != '' GROUP BY city ORDER BY n DESC LIMIT 8"
  );
  json(res, { byStatus, ...totals, due, topCities, statuses: LEAD_STATUSES });
});

/** GET /api/leads/:id — lead plus its history. */
router.get('/api/leads/:id', ({ res, params }) => {
  const lead = get('SELECT * FROM leads WHERE id = ?', [params.id]);
  if (!lead) throw notFound('Lead not found');
  const calls = all('SELECT * FROM calls WHERE lead_id = ? ORDER BY started_at DESC LIMIT 50', [params.id]);
  const bookings = all('SELECT * FROM bookings WHERE lead_id = ? ORDER BY starts_at DESC', [params.id]);
  const emails = all('SELECT * FROM email_outbox WHERE lead_id = ? ORDER BY created_at DESC LIMIT 25', [params.id]);
  const activity = all('SELECT * FROM activity WHERE lead_id = ? ORDER BY created_at DESC LIMIT 50', [params.id]);
  json(res, { lead, calls, bookings, emails, activity });
});

/** POST /api/leads — create one by hand. */
router.post('/api/leads', ({ res, body }) => {
  if (!body.name) throw bad('A lead needs a name');
  const data = pick(body);
  data.score = data.score || scoreLead(data);
  const cols = Object.keys(data);
  const res2 = run(
    `INSERT INTO leads (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    cols.map((c) => data[c])
  );
  const id = Number(res2.lastInsertRowid);
  logActivity(id, 'created', 'Lead added by hand');
  json(res, { lead: get('SELECT * FROM leads WHERE id = ?', [id]) }, 201);
});

/** PATCH /api/leads/:id */
router.patch('/api/leads/:id', ({ res, params, body }) => {
  const lead = get('SELECT * FROM leads WHERE id = ?', [params.id]);
  if (!lead) throw notFound('Lead not found');
  const data = pick(body);
  if (Object.keys(data).length === 0) throw bad('Nothing to update');
  if (data.status && !LEAD_STATUSES.includes(data.status)) throw bad(`Unknown status: ${data.status}`);

  const sets = Object.keys(data).map((c) => `${c} = ?`);
  run(`UPDATE leads SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`, [
    ...Object.keys(data).map((c) => data[c]), params.id,
  ]);
  if (data.status && data.status !== lead.status) {
    logActivity(lead.id, 'status', `${lead.status} → ${data.status}`);
  }
  json(res, { lead: get('SELECT * FROM leads WHERE id = ?', [params.id]) });
});

/** DELETE /api/leads/:id */
router.delete('/api/leads/:id', ({ res, params }) => {
  const info = run('DELETE FROM leads WHERE id = ?', [params.id]);
  if (!info.changes) throw notFound('Lead not found');
  json(res, { deleted: true });
});

/** POST /api/leads/bulk — status changes, tagging and deletes over a selection. */
router.post('/api/leads/bulk', ({ res, body }) => {
  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Boolean) : [];
  if (!ids.length) throw bad('No leads selected');
  const marks = ids.map(() => '?').join(', ');

  if (body.action === 'delete') {
    const info = run(`DELETE FROM leads WHERE id IN (${marks})`, ids);
    return json(res, { deleted: info.changes });
  }
  if (body.action === 'status') {
    if (!LEAD_STATUSES.includes(body.status)) throw bad(`Unknown status: ${body.status}`);
    const info = run(
      `UPDATE leads SET status = ?, updated_at = datetime('now') WHERE id IN (${marks})`,
      [body.status, ...ids]
    );
    return json(res, { updated: info.changes });
  }
  if (body.action === 'tag') {
    const tag = String(body.tag || '').trim();
    if (!tag) throw bad('No tag given');
    tx(() => {
      for (const id of ids) {
        const lead = get('SELECT tags FROM leads WHERE id = ?', [id]);
        if (!lead) continue;
        const tags = new Set(String(lead.tags || '').split(',').map((t) => t.trim()).filter(Boolean));
        tags.add(tag);
        run("UPDATE leads SET tags = ?, updated_at = datetime('now') WHERE id = ?", [[...tags].join(', '), id]);
      }
    });
    return json(res, { updated: ids.length });
  }
  if (body.action === 'queue') {
    const info = run(
      `UPDATE leads SET status = 'queued', updated_at = datetime('now') WHERE id IN (${marks})`, ids
    );
    return json(res, { updated: info.changes });
  }
  throw bad(`Unknown bulk action: ${body.action}`);
});

/** POST /api/leads/scrape — pull leads from Google Maps. */
router.post('/api/leads/scrape', async ({ res, body }) => {
  const query = String(body.query || '').trim();
  if (!query) throw bad('Give it something to search for, like "plumbers in Denver CO"');

  const found = await searchPlaces({
    query,
    pages: Number(body.pages) || 3,
    minRating: Number(body.min_rating) || 0,
    maxReviews: body.max_reviews ? Number(body.max_reviews) : null,
  });

  let inserted = 0;
  let skipped = 0;
  tx(() => {
    for (const lead of found) {
      const exists = lead.place_id
        ? get('SELECT id FROM leads WHERE place_id = ?', [lead.place_id])
        : get('SELECT id FROM leads WHERE name = ? AND phone IS ? ', [lead.name, lead.phone]);
      if (exists) { skipped++; continue; }
      const cols = Object.keys(lead);
      run(
        `INSERT INTO leads (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        cols.map((c) => lead[c])
      );
      inserted++;
    }
  });

  json(res, { found: found.length, inserted, duplicates: skipped, query });
});

/** POST /api/leads/import — paste CSV. */
router.post('/api/leads/import', ({ res, body }) => {
  const csv = String(body.csv || '').trim();
  if (!csv) throw bad('No CSV supplied');
  const rows = parseCsv(csv);
  if (!rows.length) throw bad('No rows found in that CSV');

  let inserted = 0;
  tx(() => {
    for (const row of rows) {
      if (!row.name) continue;
      const lead = pick(row);
      lead.source = lead.source || 'import';
      lead.score = lead.score || scoreLead(lead);
      const cols = Object.keys(lead);
      try {
        run(
          `INSERT INTO leads (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
          cols.map((c) => lead[c])
        );
        inserted++;
      } catch { /* duplicate place_id */ }
    }
  });
  json(res, { rows: rows.length, inserted });
});

/** GET /api/leads/export.csv */
router.get('/api/leads/export.csv', ({ res, query }) => {
  const where = query.status && query.status !== 'all' ? 'WHERE status = ?' : '';
  const params = where ? [query.status] : [];
  const rows = all(`SELECT * FROM leads ${where} ORDER BY score DESC`, params);
  const cols = ['id', 'name', 'category', 'phone', 'email', 'website', 'address', 'city', 'state',
    'rating', 'review_count', 'status', 'score', 'tags', 'created_at'];
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(','));
  const body = lines.join('\n');
  res.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': 'attachment; filename="leads.csv"',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
});

/** POST /api/leads/:id/rescore */
router.post('/api/leads/:id/rescore', ({ res, params }) => {
  const lead = get('SELECT * FROM leads WHERE id = ?', [params.id]);
  if (!lead) throw notFound('Lead not found');
  const score = scoreLead(lead);
  run('UPDATE leads SET score = ? WHERE id = ?', [score, lead.id]);
  json(res, { score });
});

/** POST /api/leads/scout — hand the search to the Lead Scout agent. */
router.post('/api/leads/scout', ({ res, body }) => {
  const run_ = queueRun({
    agent: 'lead-scout',
    task: body.task || `Find and qualify leads for: ${body.query}`,
    input: { query: body.query, pages: body.pages || 3, focus: body.focus || '' },
  });
  json(res, { run: run_ }, 202);
});

function pick(body) {
  const out = {};
  for (const f of FIELDS) {
    if (body[f] !== undefined && body[f] !== null) out[f] = body[f];
  }
  return out;
}

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Minimal RFC4180-ish CSV parser. First row is the header. */
export function parseCsv(input) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(cell); cell = ''; continue; }
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    if (c === '\r') continue;
    cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const alias = {
    business: 'name', business_name: 'name', company: 'name',
    phone_number: 'phone', telephone: 'phone',
    url: 'website', site: 'website',
    zip: 'postal_code', zipcode: 'postal_code', postal: 'postal_code',
    reviews: 'review_count', review_total: 'review_count',
  };
  return rows.slice(1).filter((r) => r.some((c) => c.trim() !== '')).map((r) => {
    const obj = {};
    header.forEach((h, i) => {
      const key = alias[h] || h;
      const v = (r[i] ?? '').trim();
      if (v !== '') obj[key] = v;
    });
    if (obj.rating) obj.rating = Number(obj.rating) || null;
    if (obj.review_count) obj.review_count = Number(obj.review_count) || null;
    return obj;
  });
}

export default router;
