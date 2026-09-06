import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env before anything reads process.env.
const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(HERE, '..');

// Create a working .env before anything reads process.env, so a first run
// boots straight into a usable app instead of stopping at a hidden file.
const { ensureEnvFile, firstRunBanner } = await import('./first-run.js');
ensureEnvFile(APP_ROOT);
loadEnv(join(APP_ROOT, '.env'));

const { Router, json, html, text, redirect, readJson, serveStatic, HttpError, notFound, bad } =
  await import('./lib/http.js');
const { ensureOwner, login, logout, attachSession, currentUser, requireUser, authDisabled } =
  await import('./lib/auth.js');
const { ensureDefaultForm, submitResponse, getPublicForm } = await import('./api/onboarding.js');
const { loginPage, formPage, bookingPage, notFoundPage } = await import('./public-pages.js');
const { seedIfEmpty } = await import('./seed.js');

const leadsRoutes = (await import('./api/leads.js')).default;
const callsRoutes = (await import('./api/calls.js')).default;
const scriptsRoutes = (await import('./api/scripts.js')).default;
const calendarRoutes = (await import('./api/calendar.js')).default;
const onboardingRoutes = (await import('./api/onboarding.js')).default;
const dailyRoutes = (await import('./api/daily.js')).default;
const settingsRoutes = (await import('./api/settings.js')).default;
const agentsRoutes = (await import('./api/agents.js')).default;
const automationRoutes = (await import('./api/automations.js')).default;
const webhookRoutes = (await import('./api/webhooks.js')).default;
const scheduler = await import('./lib/scheduler.js');

const { all, get, run } = await import('./lib/db.js');
const { allSettings } = await import('./lib/settings.js');

const PORT = Number(process.env.PORT) || 4000;
const WEB_DIR = join(APP_ROOT, 'web');

const owner = ensureOwner();
ensureDefaultForm();
seedIfEmpty();

// ---------------------------------------------------------------------------
// Routes that never need a session.
// ---------------------------------------------------------------------------
const publicRouter = new Router();

publicRouter.get('/login', ({ res, query }) => html(res, loginPage(query.error || '')));

publicRouter.post('/login', async ({ req, res, body }) => {
  const session = login(body.email, body.password);
  if (!session) return html(res, loginPage('Wrong email or password.'), 401);
  attachSession(res, session.token);
  const wantsJson = (req.headers.accept || '').includes('application/json');
  if (wantsJson) return json(res, { user: session.user });
  redirect(res, '/');
});

publicRouter.post('/api/auth/login', ({ res, body }) => {
  const session = login(body.email, body.password);
  if (!session) throw new HttpError(401, 'Wrong email or password.');
  attachSession(res, session.token);
  json(res, { user: session.user });
});

publicRouter.post('/api/auth/logout', ({ req, res }) => {
  logout(req, res);
  json(res, { ok: true });
});

publicRouter.get('/api/auth/me', ({ req, res }) => {
  const user = currentUser(req);
  if (!user) throw new HttpError(401, 'Not signed in');
  const s = allSettings();
  json(res, { user, business_name: s.business_name, timezone: s.timezone, auth_disabled: authDisabled() });
});

publicRouter.get('/logout', ({ req, res }) => {
  logout(req, res);
  redirect(res, '/login');
});

// Public onboarding form: GET renders, POST submits.
publicRouter.get('/f/:slug', ({ res, params }) => {
  const form = getPublicForm(params.slug);
  if (!form) return html(res, notFoundPage('That onboarding form is closed or does not exist.'), 404);
  html(res, formPage(form));
});

publicRouter.post('/f/:slug', async ({ res, params, body }) => {
  const result = await submitResponse(params.slug, body);
  json(res, { ok: true, ...result }, 201);
});

// Public booking page.
publicRouter.get('/book', ({ res }) => html(res, bookingPage()));

publicRouter.get('/api/public/slots', ({ req, res, query, params }) =>
  calendarRoutes.match('GET', '/api/slots').handler({ req, res, query, params, body: {} })
);

publicRouter.post('/api/public/book', async ({ req, res, body }) => {
  if (!body.name || !body.email || !body.starts_at) throw bad('Name, email and a time are required');
  const handler = calendarRoutes.match('POST', '/api/bookings').handler;
  await handler({ req, res, params: {}, query: {}, body: { ...body, source: 'public' } });
});

publicRouter.merge(webhookRoutes);

publicRouter.get('/health', ({ res }) => json(res, { ok: true, uptime: Math.round(process.uptime()) }));

// ---------------------------------------------------------------------------
// Everything behind the session.
// ---------------------------------------------------------------------------
const apiRouter = new Router()
  .merge(leadsRoutes)
  .merge(callsRoutes)
  .merge(scriptsRoutes)
  .merge(calendarRoutes)
  .merge(onboardingRoutes)
  .merge(dailyRoutes)
  .merge(settingsRoutes)
  .merge(agentsRoutes)
  .merge(automationRoutes);

/** GET /api/overview — one call that fills the dashboard. */
apiRouter.get('/api/overview', ({ res }) => {
  const leads = get(`SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN date(created_at) = date('now') THEN 1 ELSE 0 END), 0) AS today,
      COALESCE(SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END), 0) AS won
    FROM leads`);
  const calls = get(`SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN date(started_at) = date('now') THEN 1 ELSE 0 END), 0) AS today,
      COALESCE(SUM(CASE WHEN outcome = 'booked' THEN 1 ELSE 0 END), 0) AS booked
    FROM calls`);
  const bookings = get(`SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN starts_at >= datetime('now') THEN 1 ELSE 0 END), 0) AS upcoming
    FROM bookings`);
  const clients = get('SELECT COUNT(*) AS total FROM onboarding_responses').total;
  const runs = get(`SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END), 0) AS running FROM agent_runs`);
  json(res, { leads, calls, bookings, clients, runs });
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const query = Object.fromEntries(url.searchParams);

  try {
    const needsBody = ['POST', 'PUT', 'PATCH'].includes(req.method);
    const body = needsBody ? await readJson(req) : {};

    // 1. Public routes.
    const pub = publicRouter.match(req.method, pathname);
    if (pub) return await pub.handler({ req, res, params: pub.params, query, body, user: null });

    // 2. API routes (session required).
    if (pathname.startsWith('/api/')) {
      const user = requireUser(req);
      const hit = apiRouter.match(req.method, pathname);
      if (!hit) throw notFound(`No API route for ${req.method} ${pathname}`);
      return await hit.handler({ req, res, params: hit.params, query, body, user });
    }

    // 3. Static assets.
    if (pathname.startsWith('/assets/') || /\.(js|css|svg|png|ico|woff2)$/.test(pathname)) {
      return await serveStatic(res, WEB_DIR, pathname);
    }

    // 4. The app shell. Anything else falls through to the SPA.
    if (!currentUser(req)) return redirect(res, '/login');
    const shellPath = join(WEB_DIR, 'index.html');
    if (!existsSync(shellPath)) return html(res, notFoundPage('The web UI is missing from web/index.html'), 500);
    return html(res, readFileSync(shellPath, 'utf8'));
  } catch (err) {
    handleError(err, req, res);
  }
});

function handleError(err, req, res) {
  if (res.headersSent) return;
  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500) console.error(`[error] ${req.method} ${req.url}`, err);
  const wantsJson =
    req.url.startsWith('/api/') ||
    (req.headers.accept || '').includes('application/json') ||
    (req.headers['content-type'] || '').includes('application/json');
  if (wantsJson) {
    return json(res, { error: err.message || 'Server error', details: err.details }, status);
  }
  if (status === 401) return redirect(res, '/login');
  html(res, notFoundPage(err.message), status);
}

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

server.listen(PORT, () => {
  const s = allSettings();
  if (s.scheduler_enabled === '1') scheduler.start();
  // Only shout the password when this boot actually created the account.
  // An existing database keeps its own login, whatever .env now says.
  if (owner.created) {
    console.log(firstRunBanner({ email: owner.email, password: owner.password, port: PORT }));
  }
  console.log('');
  console.log(`  ghl-mini running`);
  console.log(`  ───────────────────────────────────────`);
  console.log(`  HQ            http://localhost:${PORT}`);
  console.log(`  Onboarding    http://localhost:${PORT}/f/new-client`);
  console.log(`  Booking page  http://localhost:${PORT}/book`);
  console.log(`  Sign in as    ${owner.email || '—'}`);
  if (!owner.created) {
    console.log(`  Forgot it?    node server/account.js ${owner.email}`);
  }
  console.log(`  Integrations  maps:${s.google_maps_api_key ? 'on' : 'off'} · twilio:${s.twilio_account_sid ? 'on' : 'off'} · email:${s.email_provider !== 'none' ? s.email_provider : 'off'}`);
  console.log(`  Automations   ${s.scheduler_enabled === '1' ? 'scheduler on' : 'scheduler OFF'} · quiet ${s.quiet_start}-${s.quiet_end} ${s.timezone}`);
  console.log('');
});

process.on('SIGINT', () => { console.log('\nbye'); process.exit(0); });
process.on('SIGTERM', () => process.exit(0));
