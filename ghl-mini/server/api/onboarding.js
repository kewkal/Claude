import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Router, json, bad, notFound } from '../lib/http.js';
import { all, get, run, ROOT } from '../lib/db.js';
import { queueRun } from '../lib/agents.js';
import { allSettings } from '../lib/settings.js';
import { sendEmail } from '../lib/email.js';

/** The default form. This is the "everything I need to build your site" list. */
export const DEFAULT_FIELDS = [
  { key: 'client_name', label: 'Your name', type: 'text', required: true },
  { key: 'business', label: 'Business name', type: 'text', required: true },
  { key: 'email', label: 'Best email', type: 'email', required: true },
  { key: 'phone', label: 'Best phone', type: 'tel', required: true },
  { key: 'website', label: 'Current website (if any)', type: 'url' },
  { key: 'industry', label: 'What does the business do?', type: 'textarea', required: true },
  { key: 'services', label: 'List your services, one per line', type: 'textarea', required: true },
  { key: 'service_area', label: 'Where do you serve?', type: 'text', required: true },
  { key: 'customer', label: 'Who is your ideal customer?', type: 'textarea', required: true },
  { key: 'differentiator', label: 'Why do customers pick you over the competition?', type: 'textarea', required: true },
  { key: 'goal', label: 'What should the site get you? (calls, bookings, quote forms)', type: 'text', required: true },
  { key: 'cta', label: 'What is the main action a visitor should take?', type: 'text', required: true },
  { key: 'pages', label: 'Pages you want', type: 'text', placeholder: 'Home, Services, About, Reviews, Contact' },
  { key: 'brand_colors', label: 'Brand colors (or "you pick")', type: 'text' },
  { key: 'logo_url', label: 'Link to your logo / photos (Drive, Dropbox)', type: 'url' },
  { key: 'examples', label: 'Sites you like and why', type: 'textarea' },
  { key: 'testimonials', label: 'Paste 2-3 reviews you want featured', type: 'textarea' },
  { key: 'hours', label: 'Business hours', type: 'text' },
  { key: 'social', label: 'Social links', type: 'textarea' },
  { key: 'domain', label: 'Domain name (owned or wanted)', type: 'text' },
  { key: 'anything_else', label: 'Anything else I should know?', type: 'textarea' },
];

const router = new Router();

export function ensureDefaultForm() {
  const existing = get('SELECT id FROM onboarding_forms LIMIT 1');
  if (existing) return existing;
  const info = run(
    'INSERT INTO onboarding_forms (slug, title, intro, fields_json) VALUES (?, ?, ?, ?)',
    [
      'new-client',
      'New client onboarding',
      'Thanks for coming on board. Fill this out once and I have everything I need to build your site. Takes about 8 minutes.',
      JSON.stringify(DEFAULT_FIELDS),
    ]
  );
  return { id: Number(info.lastInsertRowid) };
}

router.get('/api/onboarding/forms', ({ res }) => {
  const settings = allSettings();
  const forms = all('SELECT * FROM onboarding_forms ORDER BY id').map((f) => ({
    ...f,
    fields: JSON.parse(f.fields_json),
    public_url: `${settings.public_url.replace(/\/$/, '')}/f/${f.slug}`,
    responses: get('SELECT COUNT(*) AS n FROM onboarding_responses WHERE form_id = ?', [f.id]).n,
  }));
  json(res, { forms });
});

router.post('/api/onboarding/forms', ({ res, body }) => {
  const slug = String(body.slug || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
  if (!slug) throw bad('A form needs a URL slug');
  if (!body.title) throw bad('A form needs a title');
  if (get('SELECT id FROM onboarding_forms WHERE slug = ?', [slug])) throw bad('That slug is already taken');
  const info = run(
    'INSERT INTO onboarding_forms (slug, title, intro, fields_json) VALUES (?, ?, ?, ?)',
    [slug, body.title, body.intro || '', JSON.stringify(body.fields || DEFAULT_FIELDS)]
  );
  json(res, { form: get('SELECT * FROM onboarding_forms WHERE id = ?', [Number(info.lastInsertRowid)]) }, 201);
});

router.patch('/api/onboarding/forms/:id', ({ res, params, body }) => {
  const form = get('SELECT * FROM onboarding_forms WHERE id = ?', [params.id]);
  if (!form) throw notFound('Form not found');
  const data = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.intro !== undefined) data.intro = body.intro;
  if (body.active !== undefined) data.active = body.active ? 1 : 0;
  if (body.fields !== undefined) data.fields_json = JSON.stringify(body.fields);
  if (!Object.keys(data).length) throw bad('Nothing to update');
  run(
    `UPDATE onboarding_forms SET ${Object.keys(data).map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`,
    [...Object.values(data), params.id]
  );
  json(res, { form: get('SELECT * FROM onboarding_forms WHERE id = ?', [params.id]) });
});

/** GET /api/onboarding/responses */
router.get('/api/onboarding/responses', ({ res, query }) => {
  const where = [];
  const params = [];
  if (query.status && query.status !== 'all') { where.push('status = ?'); params.push(query.status); }
  if (query.form_id) { where.push('form_id = ?'); params.push(query.form_id); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const responses = all(
    `SELECT * FROM onboarding_responses ${clause} ORDER BY created_at DESC LIMIT 200`, params
  ).map((r) => ({ ...r, answers: JSON.parse(r.answers_json || '{}') }));
  json(res, { responses });
});

router.get('/api/onboarding/responses/:id', ({ res, params }) => {
  const r = get('SELECT * FROM onboarding_responses WHERE id = ?', [params.id]);
  if (!r) throw notFound('Response not found');
  const form = get('SELECT * FROM onboarding_forms WHERE id = ?', [r.form_id]);
  json(res, {
    response: { ...r, answers: JSON.parse(r.answers_json || '{}') },
    fields: form ? JSON.parse(form.fields_json) : DEFAULT_FIELDS,
  });
});

router.patch('/api/onboarding/responses/:id', ({ res, params, body }) => {
  const r = get('SELECT * FROM onboarding_responses WHERE id = ?', [params.id]);
  if (!r) throw notFound('Response not found');
  if (!body.status) throw bad('Nothing to update');
  run('UPDATE onboarding_responses SET status = ? WHERE id = ?', [body.status, params.id]);
  json(res, { response: get('SELECT * FROM onboarding_responses WHERE id = ?', [params.id]) });
});

/** POST /api/onboarding/responses/:id/brief — write the brief and wake the agents. */
router.post('/api/onboarding/responses/:id/brief', ({ res, params, body }) => {
  const r = get('SELECT * FROM onboarding_responses WHERE id = ?', [params.id]);
  if (!r) throw notFound('Response not found');
  const form = get('SELECT * FROM onboarding_forms WHERE id = ?', [r.form_id]);
  const fields = form ? JSON.parse(form.fields_json) : DEFAULT_FIELDS;
  const answers = JSON.parse(r.answers_json || '{}');

  const slug = String(r.business || r.client_name || `client-${r.id}`)
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const filename = `${String(r.id).padStart(3, '0')}-${slug}.md`;
  const relPath = `briefs/${filename}`;
  writeFileSync(join(ROOT, relPath), renderBrief(r, fields, answers), 'utf8');
  run("UPDATE onboarding_responses SET brief_path = ?, status = 'briefed' WHERE id = ?", [relPath, r.id]);

  let queued = null;
  if (body.run_agent !== false) {
    queued = queueRun({
      agent: body.agent || 'site-builder',
      task: `Build the site described in ${relPath}. Client: ${r.business || r.client_name}.`,
      input: { brief: relPath, response_id: r.id, stack: body.stack || 'Static HTML + CSS' },
    });
  }
  json(res, { brief_path: relPath, run: queued }, 201);
});

/** GET /api/onboarding/responses/:id/brief.md */
router.get('/api/onboarding/responses/:id/brief.md', ({ res, params }) => {
  const r = get('SELECT * FROM onboarding_responses WHERE id = ?', [params.id]);
  if (!r) throw notFound('Response not found');
  const form = get('SELECT * FROM onboarding_forms WHERE id = ?', [r.form_id]);
  const fields = form ? JSON.parse(form.fields_json) : DEFAULT_FIELDS;
  const body = renderBrief(r, fields, JSON.parse(r.answers_json || '{}'));
  res.writeHead(200, {
    'content-type': 'text/markdown; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
});

/**
 * Public submit. Used by the shareable /f/:slug form, so it must work
 * without a session.
 */
export async function submitResponse(slug, payload) {
  const form = get('SELECT * FROM onboarding_forms WHERE slug = ? AND active = 1', [slug]);
  if (!form) throw notFound('That form is not available');
  const fields = JSON.parse(form.fields_json);

  const answers = {};
  for (const f of fields) {
    const v = payload[f.key];
    if (f.required && (v == null || String(v).trim() === '')) {
      throw bad(`"${f.label}" is required`);
    }
    if (v != null && String(v).trim() !== '') answers[f.key] = String(v).trim();
  }

  const email = answers.email || null;
  let leadId = null;
  if (email) {
    const existing = get('SELECT id FROM leads WHERE email = ?', [email]);
    leadId = existing ? existing.id : null;
  }
  if (!leadId && answers.business) {
    const info = run(
      "INSERT INTO leads (name, email, phone, website, status, source, score, notes) VALUES (?, ?, ?, ?, 'won', 'onboarding', 100, ?)",
      [answers.business, email, answers.phone || null, answers.website || null, 'Came in through the onboarding form.']
    );
    leadId = Number(info.lastInsertRowid);
  } else if (leadId) {
    run("UPDATE leads SET status = 'won', updated_at = datetime('now') WHERE id = ?", [leadId]);
  }

  const info = run(
    `INSERT INTO onboarding_responses (form_id, lead_id, client_name, business, email, phone, answers_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [form.id, leadId, answers.client_name || null, answers.business || null, email, answers.phone || null,
     JSON.stringify(answers)]
  );
  const id = Number(info.lastInsertRowid);

  const settings = allSettings();
  if (settings.owner_email) {
    sendEmail({
      to: settings.owner_email,
      subject: `New onboarding: ${answers.business || answers.client_name || 'client'}`,
      body: `${answers.business || ''} just submitted the onboarding form.\n\n` +
        Object.entries(answers).map(([k, v]) => `${k}: ${v}`).join('\n') +
        `\n\nOpen it: ${settings.public_url.replace(/\/$/, '')}/#/onboarding/${id}`,
    }).catch(() => {});
  }

  return { id, form: form.title };
}

export function getPublicForm(slug) {
  const form = get('SELECT * FROM onboarding_forms WHERE slug = ? AND active = 1', [slug]);
  if (!form) return null;
  return { ...form, fields: JSON.parse(form.fields_json) };
}

function renderBrief(r, fields, answers) {
  const label = (key) => fields.find((f) => f.key === key)?.label || key;
  const out = [
    `# Build brief — ${r.business || r.client_name || `Client ${r.id}`}`,
    '',
    `- **Response ID**: ${r.id}`,
    `- **Submitted**: ${r.created_at}`,
    `- **Contact**: ${r.client_name || '—'} · ${r.email || '—'} · ${r.phone || '—'}`,
    r.lead_id ? `- **Lead ID**: ${r.lead_id}` : '',
    '',
    '## What the client told us',
    '',
  ].filter(Boolean);

  for (const f of fields) {
    const v = answers[f.key];
    if (!v) continue;
    out.push(`### ${label(f.key)}`, '', v, '');
  }

  out.push(
    '## Build instructions',
    '',
    `1. Build the pages listed above. If none were given, use: Home, Services, About, Reviews, Contact.`,
    `2. Lead with the differentiator in the hero. The main call to action is: ${answers.cta || 'contact the business'}.`,
    `3. Every page ends with the call to action. Phone number is clickable on mobile.`,
    `4. Bake the service area into the copy and page titles so it ranks locally.`,
    `5. Ship a deploy-ready folder. No build step unless the client asked for one.`,
    '',
    '## Questions to resolve before shipping',
    '',
    ...fields.filter((f) => !answers[f.key]).map((f) => `- [ ] Missing: ${f.label}`),
    ''
  );
  return out.join('\n');
}

export default router;
