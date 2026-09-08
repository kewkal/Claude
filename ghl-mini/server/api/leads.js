import { Router, json, bad, notFound } from '../lib/http.js';
import { all, get, run, tx } from '../lib/db.js';
import { searchPlaces, searchMany, scoreLead } from '../lib/maps.js';
import { scanSite, runsAds, pitchAngle } from '../lib/sitescan.js';
import { looksLikeChain, findMultiLocation, matchesKnownBrand } from '../lib/chains.js';
import { findOwner } from '../lib/owner.js';
import { scoreRecovery, recoveryPitch } from '../lib/recovery.js';
import { allSettings } from '../lib/settings.js';
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
/**
 * Every filter the Leads screen offers, in one place. The list route and
 * the CSV export both use it, so an export always matches what is on
 * screen rather than quietly returning everything.
 */
export function buildLeadFilter(query = {}) {
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
  if (query.runs_ads === '1') where.push('runs_ads = 1');
  if (query.runs_ads === '0') where.push("(runs_ads = 0 AND site_status = 'ok')");
  if (query.no_tracking === '1') {
    where.push("(site_status = 'ok' AND has_meta_pixel = 0 AND has_google_tag = 0 AND has_analytics = 0 AND has_google_ads = 0)");
  }
  if (query.site_broken === '1') where.push("site_status IN ('unreachable','timeout','server_error','not_found')");
  if (query.not_mobile === '1') where.push("(site_status = 'ok' AND mobile_ready = 0)");
  if (query.platform) { where.push('site_platform = ?'); params.push(query.platform); }
  if (query.unscanned === '1') where.push("site_status IS NULL AND website IS NOT NULL AND website != ''");
  if (query.has_owner === '1') where.push('owner_name IS NOT NULL');
  if (query.has_owner_email === '1') where.push("owner_email IS NOT NULL AND owner_email != ''");
  if (query.no_chat === '1') where.push("(recovery_chat IS NULL AND (site_status = 'ok' OR website IS NULL OR website = ''))");
  if (query.no_email_tool === '1') where.push("recovery_email_tool IS NULL AND site_status = 'ok'");
  if (query.no_booking === '1') where.push("recovery_booking IS NULL AND site_status = 'ok'");
  if (query.busy === '1') where.push('review_count >= 75');
  if (query.leaking === '1') where.push('recovery_score >= 60');
  if (query.has_email === '1') where.push("email IS NOT NULL AND email != ''");
  if (query.is_chain === '1') where.push('is_chain = 1');
  if (query.is_chain === '0') where.push('is_chain = 0');
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

  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

router.get('/api/leads', ({ res, query }) => {
  const limit = Math.min(500, Math.max(1, Number(query.limit) || 50));
  const page = Math.max(1, Number(query.page) || 1);
  const offset = (page - 1) * limit;

  const { clause, params } = buildLeadFilter(query);
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
  const tech = get(`
    SELECT
      COALESCE(SUM(CASE WHEN site_status IS NOT NULL THEN 1 ELSE 0 END), 0) AS scanned,
      COALESCE(SUM(CASE WHEN site_status IS NULL AND website IS NOT NULL AND website != '' THEN 1 ELSE 0 END), 0) AS unscanned,
      COALESCE(SUM(runs_ads), 0) AS runs_ads,
      COALESCE(SUM(has_meta_pixel), 0) AS meta_pixel,
      COALESCE(SUM(CASE WHEN has_google_tag = 1 OR has_analytics = 1 THEN 1 ELSE 0 END), 0) AS google_tag,
      COALESCE(SUM(CASE WHEN site_status = 'ok' AND has_meta_pixel = 0 AND has_google_tag = 0
                        AND has_analytics = 0 AND has_google_ads = 0 THEN 1 ELSE 0 END), 0) AS no_tracking,
      COALESCE(SUM(CASE WHEN site_status IN ('unreachable','timeout','server_error','not_found') THEN 1 ELSE 0 END), 0) AS broken,
      COALESCE(SUM(CASE WHEN site_status = 'ok' AND mobile_ready = 0 THEN 1 ELSE 0 END), 0) AS not_mobile,
      COALESCE(SUM(is_chain), 0) AS chains,
      COALESCE(SUM(CASE WHEN owner_name IS NOT NULL THEN 1 ELSE 0 END), 0) AS owners,
      COALESCE(SUM(CASE WHEN owner_email IS NOT NULL AND owner_email != '' THEN 1 ELSE 0 END), 0) AS owner_emails,
      COALESCE(SUM(CASE WHEN email IS NOT NULL AND email != '' THEN 1 ELSE 0 END), 0) AS any_email,
      COALESCE(SUM(CASE WHEN review_count >= 75 THEN 1 ELSE 0 END), 0) AS busy,
      COALESCE(SUM(CASE WHEN recovery_score >= 60 THEN 1 ELSE 0 END), 0) AS leaking,
      COALESCE(SUM(CASE WHEN recovery_chat IS NULL AND (site_status = 'ok' OR website IS NULL OR website = '') THEN 1 ELSE 0 END), 0) AS no_chat,
      COALESCE(SUM(CASE WHEN recovery_email_tool IS NULL AND site_status = 'ok' THEN 1 ELSE 0 END), 0) AS no_email_tool,
      COALESCE(SUM(CASE WHEN recovery_booking IS NULL AND site_status = 'ok' THEN 1 ELSE 0 END), 0) AS no_booking
    FROM leads`);
  const platforms = all(
    "SELECT site_platform AS platform, COUNT(*) AS n FROM leads WHERE site_platform IS NOT NULL GROUP BY site_platform ORDER BY n DESC"
  );
  json(res, { byStatus, ...totals, due, topCities, tech, platforms, statuses: LEAD_STATUSES });
});

/** Column sets, so an export can be the right shape for its job. */
export const EXPORT_SHAPES = {
  calling: {
    label: 'Calling list',
    hint: 'What you need on the phone and nothing else.',
    cols: ['name', 'phone', 'owner_name', 'owner_email', 'city', 'review_count',
      'recovery_score', 'recovery_chat', 'recovery_email_tool', 'pitch_angle', 'status'],
  },
  full: {
    label: 'Everything',
    hint: 'Every column, for a spreadsheet or another tool.',
    cols: ['id', 'name', 'category', 'phone', 'email', 'website', 'address', 'city', 'state',
      'postal_code', 'rating', 'review_count', 'status', 'score', 'tags', 'notes',
      'owner_name', 'owner_role', 'owner_source', 'owner_confidence',
      'owner_email', 'owner_email_kind', 'owner_email_confidence',
      'site_status', 'site_platform', 'runs_ads', 'has_meta_pixel', 'has_google_tag',
      'has_analytics', 'has_google_ads', 'mobile_ready', 'has_ssl',
      'is_chain', 'chain_reason', 'pitch_angle', 'attempts', 'last_contacted_at',
      'next_action_at', 'source', 'search_query', 'created_at'],
  },
  mailmerge: {
    label: 'Mail merge',
    hint: 'Named columns for an email tool or a mail-merge template.',
    cols: ['owner_name', 'owner_email', 'name', 'phone', 'city', 'category', 'website', 'pitch_angle'],
  },
  crm: {
    label: 'Import into another CRM',
    hint: 'The plain contact fields most systems expect.',
    cols: ['name', 'owner_name', 'phone', 'email', 'website', 'address', 'city', 'state',
      'postal_code', 'category', 'status', 'notes'],
  },
};

/**
 * GET /api/leads/export.csv — honours every filter the Leads screen has,
 * so what you are looking at is what you get.
 */
router.get('/api/leads/export.csv', ({ res, query }) => {
  const shape = EXPORT_SHAPES[query.shape] || EXPORT_SHAPES.full;
  const { clause, params } = buildLeadFilter(query);
  const sortMap = {
    score: 'score DESC, review_count DESC', newest: 'created_at DESC',
    name: 'name COLLATE NOCASE ASC', reviews: 'review_count DESC',
  };
  const rows = all(
    `SELECT * FROM leads ${clause} ORDER BY ${sortMap[query.sort] || sortMap.score}`, params
  );

  const header = shape.cols.map((c) => ({
    name: 'business', owner_name: 'owner', pitch_angle: 'why_to_call',
    review_count: 'reviews', runs_ads: 'runs_ads', site_status: 'website_status',
  }[c] || c));

  const lines = [header.join(',')];
  for (const r of rows) lines.push(shape.cols.map((c) => csvCell(r[c])).join(','));
  const body = lines.join('\n');

  const stamp = new Date().toISOString().slice(0, 10);
  res.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="leads-${query.shape || 'full'}-${stamp}.csv"`,
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
});

/** GET /api/leads/export/shapes — what the export box offers. */
router.get('/api/leads/export/shapes', ({ res, query }) => {
  const { clause, params } = buildLeadFilter(query);
  json(res, {
    shapes: Object.entries(EXPORT_SHAPES).map(([id, s]) => ({
      id, label: s.label, hint: s.hint, columns: s.cols.length,
    })),
    matching: get(`SELECT COUNT(*) AS n FROM leads ${clause}`, params).n,
    total: get('SELECT COUNT(*) AS n FROM leads').n,
  });
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

  const excludeChains = body.exclude_chains !== false;
  let inserted = 0;
  let skipped = 0;
  let chains = 0;
  const insertedIds = [];

  tx(() => {
    for (const lead of found) {
      const exists = lead.place_id
        ? get('SELECT id FROM leads WHERE place_id = ?', [lead.place_id])
        : get('SELECT id FROM leads WHERE name = ? AND phone IS ? ', [lead.name, lead.phone]);
      if (exists) { skipped++; continue; }

      const chainReason = looksLikeChain(lead);
      if (chainReason && excludeChains) { chains++; continue; }
      if (chainReason) {
        lead.is_chain = 1;
        lead.chain_reason = chainReason;
        chains++;
      }

      const cols = Object.keys(lead);
      const info = run(
        `INSERT INTO leads (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        cols.map((c) => lead[c])
      );
      insertedIds.push(Number(info.lastInsertRowid));
      inserted++;
    }
  });

  // A known-brand check cannot spot a regional chain. Comparing the whole
  // database can: the same name in several cities, or several listings
  // behind one domain.
  const swept = sweepChains({ excludeChains, onlyIds: insertedIds });
  chains += swept.flagged;
  inserted -= swept.removed;

  json(res, { found: found.length, inserted, duplicates: skipped, chains_skipped: chains, query });
});

/**
 * POST /api/leads/bulk-scrape — a trade x location grid.
 * Every combination is its own query, which is the only way past Google's
 * 60-per-search ceiling.
 */
router.post('/api/leads/bulk-scrape', async ({ res, body }) => {
  const lines = (v) => String(v || '').split(/[\n,;]+/).map((t) => t.trim()).filter(Boolean);
  const trades = lines(body.trades);
  const locations = lines(body.locations);
  if (!trades.length) throw bad('Give it at least one trade, like "roofers"');
  if (!locations.length) throw bad('Give it at least one place, like "Tampa FL"');

  const total = trades.length * locations.length;
  if (total > 60) {
    throw bad(`That is ${total} searches. Keep it under 60 at a time so a mistake cannot burn your quota.`);
  }

  const excludeChains = body.exclude_chains !== false;
  const batches = await searchMany({
    trades,
    locations,
    pages: Number(body.pages) || 3,
    minRating: Number(body.min_rating) || 0,
    maxReviews: body.max_reviews ? Number(body.max_reviews) : null,
  });

  const summary = { queries: total, found: 0, inserted: 0, duplicates: 0, chains_skipped: 0, per_query: [], errors: [] };
  const insertedIds = [];

  for (const batch of batches) {
    if (batch.error) { summary.errors.push({ query: batch.query, error: batch.error }); continue; }
    let inserted = 0;
    let dupes = 0;
    let chains = 0;

    tx(() => {
      for (const lead of batch.found) {
        const exists = lead.place_id
          ? get('SELECT id FROM leads WHERE place_id = ?', [lead.place_id])
          : get('SELECT id FROM leads WHERE name = ? AND phone IS ?', [lead.name, lead.phone]);
        if (exists) { dupes++; continue; }

        const chainReason = looksLikeChain(lead);
        if (chainReason && excludeChains) { chains++; continue; }
        if (chainReason) { lead.is_chain = 1; lead.chain_reason = chainReason; chains++; }

        const cols = Object.keys(lead);
        const info = run(
          `INSERT INTO leads (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
          cols.map((c) => lead[c])
        );
        insertedIds.push(Number(info.lastInsertRowid));
        inserted++;
      }
    });

    summary.found += batch.found.length;
    summary.inserted += inserted;
    summary.duplicates += dupes;
    summary.chains_skipped += chains;
    summary.per_query.push({ query: batch.query, found: batch.found.length, inserted, duplicates: dupes, chains });
  }

  const swept = sweepChains({ excludeChains, onlyIds: insertedIds });
  summary.chains_skipped += swept.flagged;
  summary.inserted -= swept.removed;

  json(res, summary);
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

/**
 * Compares leads against each other to find chains no brand list knows.
 * Runs over everything, because a lead scraped last week only becomes
 * obviously a chain once its sibling in the next city turns up.
 */
function sweepChains({ excludeChains = false, onlyIds = null } = {}) {
  const everything = all('SELECT id, name, city, website FROM leads');
  const flaggedMap = findMultiLocation(everything);

  let flagged = 0;
  let removed = 0;
  tx(() => {
    for (const [id, reason] of flaggedMap) {
      if (onlyIds && !onlyIds.includes(id)) {
        // Still record it, just do not count it against this batch.
        run("UPDATE leads SET is_chain = 1, chain_reason = ? WHERE id = ? AND is_chain = 0", [reason, id]);
        continue;
      }
      if (excludeChains) {
        const info = run("DELETE FROM leads WHERE id = ? AND status = 'new'", [id]);
        if (info.changes) { removed++; flagged++; continue; }
      }
      const info = run("UPDATE leads SET is_chain = 1, chain_reason = ? WHERE id = ? AND is_chain = 0", [reason, id]);
      if (info.changes) flagged++;
    }
  });

  // Rescore whatever changed, since being a chain slashes the score.
  for (const id of flaggedMap.keys()) {
    const lead = get('SELECT * FROM leads WHERE id = ?', [id]);
    if (lead) run('UPDATE leads SET score = ? WHERE id = ?', [scoreLead(lead), lead.id]);
  }
  return { flagged, removed };
}

/**
 * POST /api/leads/find-owners — names from the business name and email
 * address alone. No fetching, no API calls, instant across the whole list.
 */
router.post('/api/leads/find-owners', ({ res }) => {
  let found = 0;
  const leads = all("SELECT * FROM leads WHERE owner_name IS NULL");
  tx(() => {
    for (const lead of leads) {
      const { best } = findOwner({ businessName: lead.name, email: lead.email });
      if (!best) continue;
      run(
        'UPDATE leads SET owner_name = ?, owner_role = ?, owner_source = ?, owner_confidence = ? WHERE id = ?',
        [best.name, best.role, best.sources.join(' + '), best.confidence, lead.id]
      );
      found++;
    }
  });
  json(res, {
    checked: leads.length,
    found,
    total_with_owner: get('SELECT COUNT(*) AS n FROM leads WHERE owner_name IS NOT NULL').n,
  });
});

/**
 * A lead you have already worked is never deleted, however chain-like it
 * looks. Call history, a booking, a sequence or any status past the top of
 * the funnel all mean a human has spent time on it, and a wrong guess by
 * the detector must not throw that away.
 */
function untouched(leadId) {
  if (get('SELECT id FROM calls WHERE lead_id = ? LIMIT 1', [leadId])) return false;
  if (get('SELECT id FROM bookings WHERE lead_id = ? LIMIT 1', [leadId])) return false;
  if (get('SELECT id FROM enrollments WHERE lead_id = ? LIMIT 1', [leadId])) return false;
  if (get('SELECT id FROM onboarding_responses WHERE lead_id = ? LIMIT 1', [leadId])) return false;
  const lead = get('SELECT status, notes FROM leads WHERE id = ?', [leadId]);
  if (!lead) return false;
  if (!['new', 'queued'].includes(lead.status)) return false;
  if (String(lead.notes || '').trim()) return false;
  return true;
}

/**
 * POST /api/leads/sweep-chains — find chains across everything stored.
 * With `remove`, deletes every chain it is safe to delete, not just the
 * multi-location ones the comparison pass happened to flag.
 */
router.post('/api/leads/sweep-chains', ({ res, body }) => {
  // Catch known brands that were imported or scraped before this existed.
  let brands = 0;
  tx(() => {
    for (const lead of all("SELECT id, name FROM leads WHERE is_chain = 0")) {
      const brand = matchesKnownBrand(lead.name);
      if (!brand) continue;
      run("UPDATE leads SET is_chain = 1, chain_reason = ? WHERE id = ?", [`known brand: ${brand}`, lead.id]);
      brands++;
    }
  });

  // Flag only — deleting is handled below so every chain is covered.
  const swept = sweepChains({ excludeChains: false });

  for (const lead of all('SELECT * FROM leads WHERE is_chain = 1')) {
    run('UPDATE leads SET score = ? WHERE id = ?', [scoreLead(lead), lead.id]);
  }

  const flagged = get('SELECT COUNT(*) AS n FROM leads WHERE is_chain = 1').n;
  let removed = 0;
  let kept = 0;

  if (body.remove === true) {
    tx(() => {
      for (const lead of all('SELECT id FROM leads WHERE is_chain = 1')) {
        if (!untouched(lead.id)) { kept++; continue; }
        run('DELETE FROM leads WHERE id = ?', [lead.id]);
        removed++;
      }
    });
  }

  json(res, {
    known_brands: brands,
    multi_location: swept.flagged,
    flagged,
    removed,
    kept_because_worked: kept,
    total_chains: get('SELECT COUNT(*) AS n FROM leads WHERE is_chain = 1').n,
  });
});

/** GET /api/leads/chains/preview — what a remove would actually do. */
router.get('/api/leads/chains/preview', ({ res }) => {
  const chains = all('SELECT id, name, chain_reason, status FROM leads WHERE is_chain = 1');
  const removable = [];
  const keeping = [];
  for (const lead of chains) (untouched(lead.id) ? removable : keeping).push(lead);
  json(res, {
    total: chains.length,
    removable: removable.length,
    keeping: keeping.length,
    sample: removable.slice(0, 8).map((l) => ({ name: l.name, reason: l.chain_reason })),
    kept_sample: keeping.slice(0, 5).map((l) => ({ name: l.name, status: l.status })),
  });
});

/** PATCH /api/leads/:id/not-a-chain — undo a bad call. */
router.post('/api/leads/:id/not-a-chain', ({ res, params }) => {
  const lead = get('SELECT * FROM leads WHERE id = ?', [params.id]);
  if (!lead) throw notFound('Lead not found');
  run("UPDATE leads SET is_chain = 0, chain_reason = NULL WHERE id = ?", [params.id]);
  run('UPDATE leads SET score = ? WHERE id = ?', [scoreLead({ ...lead, is_chain: 0 }), params.id]);
  json(res, { lead: get('SELECT * FROM leads WHERE id = ?', [params.id]) });
});

/** POST /api/leads/:id/rescore */
router.post('/api/leads/:id/rescore', ({ res, params }) => {
  const lead = get('SELECT * FROM leads WHERE id = ?', [params.id]);
  if (!lead) throw notFound('Lead not found');
  const score = scoreLead(lead);
  run('UPDATE leads SET score = ? WHERE id = ?', [score, lead.id]);
  json(res, { score });
});

/**
 * The score reflects whichever offer you are selling. Recovery is the
 * default: missed calls, a dead database, no-shows. The website profile
 * is the older "they need a site built" ranking.
 */
export function rescore(lead) {
  const profile = allSettings().scoring_profile || 'recovery';
  if (profile !== 'recovery') return { score: scoreLead(lead), recovery: null };
  const r = scoreRecovery(lead);
  return { score: r.score, recovery: r };
}

/** Recompute and persist a lead's score under the active profile. */
export function applyScore(lead) {
  const { score, recovery } = rescore(lead);
  if (recovery) {
    run(
      `UPDATE leads SET score = ?, recovery_score = ?, recovery_reasons = ?, recovery_gaps = ?,
       pitch_angle = ?, updated_at = datetime('now') WHERE id = ?`,
      [score, recovery.score, JSON.stringify(recovery.reasons), JSON.stringify(recovery.gaps),
       recoveryPitch(lead), lead.id]
    );
  } else {
    run("UPDATE leads SET score = ?, updated_at = datetime('now') WHERE id = ?", [score, lead.id]);
  }
  return score;
}

/** POST /api/leads/rescore-all — after changing the profile. */
router.post('/api/leads/rescore-all', ({ res }) => {
  const leads = all('SELECT * FROM leads');
  tx(() => { for (const lead of leads) applyScore(lead); });
  const profile = allSettings().scoring_profile || 'recovery';
  json(res, {
    rescored: leads.length,
    profile,
    top: all('SELECT name, score, recovery_reasons FROM leads ORDER BY score DESC LIMIT 5')
      .map((l) => ({ name: l.name, score: l.score })),
  });
});

/** Write one scan result onto a lead and re-score it. */
function applyScan(lead, scan) {
  const patch = {
    site_status: scan.site_status,
    site_checked_at: scan.site_checked_at,
    site_platform: scan.platform,
    site_title: scan.title,
    has_meta_pixel: scan.tags.meta_pixel ? 1 : 0,
    has_google_tag: scan.tags.google_tag_manager ? 1 : 0,
    has_google_ads: scan.tags.google_ads ? 1 : 0,
    has_analytics: scan.tags.google_analytics || scan.tags.universal_analytics ? 1 : 0,
    runs_ads: runsAds(scan) ? 1 : 0,
    mobile_ready: scan.mobile_ready,
    has_ssl: scan.has_ssl,
    tags_json: JSON.stringify({ tags: scan.tags, ids: scan.tag_ids }),
  };
  if (scan.owner_email) {
    patch.owner_email = scan.owner_email.email;
    patch.owner_email_kind = scan.owner_email.kind;
    patch.owner_email_confidence = scan.owner_email.score;
    // Only fill the main email field if it is empty — never overwrite one
    // you typed in yourself.
    if (!lead.email) patch.email = scan.owner_email.email;
  }
  if (scan.emails?.length) patch.emails_json = JSON.stringify(scan.emails);
  if (scan.owner && (!lead.owner_confidence || scan.owner.confidence > lead.owner_confidence)) {
    patch.owner_name = scan.owner.name;
    patch.owner_role = scan.owner.role;
    patch.owner_source = scan.owner.sources.join(' + ');
    patch.owner_confidence = scan.owner.confidence;
  }
  if (scan.franchise_copy && !lead.is_chain) {
    patch.is_chain = 1;
    patch.chain_reason = 'their own site says independently owned and operated';
  }
  if (scan.tools) {
    patch.recovery_chat = scan.tools.chat;
    patch.recovery_booking = scan.tools.booking;
    patch.recovery_email_tool = scan.tools.email;
    patch.recovery_review_tool = scan.tools.review;
    patch.recovery_form = scan.tools.form ? 1 : 0;
    patch.recovery_click_to_call = scan.tools.click_to_call ? 1 : 0;
  }

  const merged = { ...lead, ...patch };
  const profile = allSettings().scoring_profile || 'recovery';
  if (profile === 'recovery') {
    const r = scoreRecovery(merged, scan);
    patch.recovery_score = r.score;
    patch.recovery_reasons = JSON.stringify(r.reasons);
    patch.recovery_gaps = JSON.stringify(r.gaps);
    patch.score = r.score;
    patch.pitch_angle = recoveryPitch(merged);
  } else {
    patch.pitch_angle = pitchAngle(lead, scan);
    patch.score = scoreLead(merged);
  }

  const cols = Object.keys(patch);
  run(
    `UPDATE leads SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`,
    [...cols.map((c) => patch[c]), lead.id]
  );
  return patch;
}

/** POST /api/leads/:id/scan — check one lead's website. */
router.post('/api/leads/:id/scan', async ({ res, params }) => {
  const lead = get('SELECT * FROM leads WHERE id = ?', [params.id]);
  if (!lead) throw notFound('Lead not found');
  if (!lead.website) throw bad('That lead has no website to check.');
  const scan = await scanSite(lead.website, { businessName: lead.name, email: lead.email });
  applyScan(lead, scan);
  json(res, { lead: get('SELECT * FROM leads WHERE id = ?', [params.id]), scan });
});

/**
 * POST /api/leads/scan — check a batch. Pass `ids`, or leave it out and it
 * takes the highest-scoring unscanned leads that actually have a website.
 */
router.post('/api/leads/scan', async ({ res, body }) => {
  const limit = Math.min(200, Math.max(1, Number(body.limit) || 25));
  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Boolean) : null;

  const targets = ids && ids.length
    ? all(
        `SELECT * FROM leads WHERE id IN (${ids.map(() => '?').join(',')})
           AND website IS NOT NULL AND website != ''`, ids
      )
    : all(
        `SELECT * FROM leads
         WHERE website IS NOT NULL AND website != '' AND site_status IS NULL
         ORDER BY score DESC LIMIT ?`, [limit]
      );

  if (!targets.length) {
    return json(res, { scanned: 0, message: 'Nothing to check — those leads have no website, or were checked already.' });
  }

  // Five at a time: fast enough to be useful, polite enough not to look
  // like an attack to anyone's host.
  const summary = { scanned: 0, runs_ads: 0, no_tracking: 0, broken: 0, not_mobile: 0 };
  const CONCURRENCY = 5;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const scans = await Promise.all(batch.map((l) =>
      scanSite(l.website, { businessName: l.name, email: l.email }).catch(() => null)));
    batch.forEach((lead, j) => {
      const scan = scans[j];
      if (!scan) return;
      const patch = applyScan(lead, scan);
      summary.scanned++;
      if (patch.runs_ads) summary.runs_ads++;
      if (scan.site_status === 'ok' && !Object.keys(scan.tags).length) summary.no_tracking++;
      if (['unreachable', 'timeout', 'server_error', 'not_found'].includes(scan.site_status)) summary.broken++;
      if (scan.site_status === 'ok' && !scan.mobile_ready) summary.not_mobile++;
    });
  }
  json(res, summary);
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
