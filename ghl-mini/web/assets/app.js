import { api, err, toast, closeModal } from './ui.js';

import dailyView from './views/daily.js';
import leadsView from './views/leads.js';
import dialerView from './views/dialer.js';
import scriptsView from './views/scripts.js';
import callsView from './views/calls.js';
import calendarView from './views/calendar.js';
import onboardingView from './views/onboarding.js';
import agentsView from './views/agents.js';
import automationsView from './views/automations.js';
import settingsView from './views/settings.js';

const ROUTES = [
  { path: 'daily',      title: 'Daily HQ',     icon: '🎯', view: dailyView },
  { path: 'agents',     title: 'Agents',       icon: '🤖', view: agentsView },
  { path: 'leads',      title: 'Leads',        icon: '📇', view: leadsView },
  { path: 'dialer',     title: 'Dialer',       icon: '☎️', view: dialerView },
  { path: 'scripts',    title: 'Scripts',      icon: '📝', view: scriptsView },
  { path: 'calls',      title: 'Call history', icon: '📊', view: callsView },
  { path: 'calendar',   title: 'Calendar',     icon: '📅', view: calendarView },
  { path: 'automations',title: 'Automations',  icon: '⚡', view: automationsView },
  { path: 'onboarding', title: 'Onboarding',   icon: '📋', view: onboardingView },
  { path: 'settings',   title: 'Settings',     icon: '⚙️', view: settingsView },
];

const viewEl = document.getElementById('view');
const titleEl = document.getElementById('pageTitle');
const actionsEl = document.getElementById('topbarActions');
const navEl = document.getElementById('nav');
const sidebarEl = document.querySelector('.sidebar');

export const state = { user: null, business: 'HQ', badges: {} };

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, ...rest] = raw.split('/');
  return { path: path || 'daily', arg: rest.join('/') || null };
}

function renderNav(active) {
  navEl.innerHTML = ROUTES.map((r) => {
    const badge = state.badges[r.path];
    return `<a class="nav-item${r.path === active ? ' active' : ''}" href="#/${r.path}">
      <span class="ico">${r.icon}</span><span>${r.title}</span>
      ${badge ? `<span class="badge">${badge}</span>` : ''}
    </a>`;
  }).join('');
}

/** Views call this to put buttons in the top bar. */
export function setActions(html = '') {
  actionsEl.innerHTML = html;
  return actionsEl;
}

/** Views call this to update a sidebar badge count. */
export function setBadge(path, count) {
  if (count) state.badges[path] = count;
  else delete state.badges[path];
  renderNav(parseHash().path);
}

export function navigate(path) {
  location.hash = `#/${path}`;
}

let rendering = false;
let renderPending = false;

/**
 * Views await their data before writing to the DOM, so two overlapping
 * renders can finish out of order and the older one wins. Serialize them:
 * a request that arrives mid-render is coalesced and re-run afterwards
 * against whatever the hash says by then.
 */
async function render() {
  if (rendering) { renderPending = true; return; }
  rendering = true;
  try {
    do {
      renderPending = false;
      await renderOnce();
    } while (renderPending);
  } finally {
    rendering = false;
  }
}

async function renderOnce() {
  const { path, arg } = parseHash();
  const route = ROUTES.find((r) => r.path === path) || ROUTES[0];

  // A modal left open would sit over the new screen and swallow clicks.
  closeModal();

  titleEl.textContent = route.title;
  document.title = `${route.title} — ${state.business}`;
  renderNav(route.path);
  setActions('');
  sidebarEl.classList.remove('open');
  viewEl.innerHTML = '<div class="loading">Loading…</div>';

  try {
    await route.view.render(viewEl, { arg, navigate, setActions, setBadge, state });
  } catch (e) {
    viewEl.innerHTML = `<div class="card"><h2>Could not load ${route.title}</h2>
      <p class="muted">${e.message}</p>
      <button class="btn" onclick="location.reload()">Reload</button></div>`;
    err(e.message);
  }
}

async function boot() {
  try {
    const me = await api.get('/api/auth/me');
    state.user = me.user;
    state.business = me.business_name || 'HQ';
    document.getElementById('brandName').textContent = state.business;
  } catch {
    location.href = '/login';
    return;
  }

  checkVersion();
  setInterval(checkVersion, 120000);

  // Badge the sidebar with anything waiting on you.
  refreshBadges();
  setInterval(refreshBadges, 60000);

  window.addEventListener('hashchange', render);
  document.getElementById('menuBtn').onclick = () => sidebarEl.classList.toggle('open');
  render();
}

/** Warn when the files on disk are newer than the running server. */
async function checkVersion() {
  try {
    const v = await api.get('/api/version');
    const existing = document.getElementById('staleBanner');
    if (!v.stale) { existing?.remove(); return; }
    if (existing) return;
    const bar = document.createElement('div');
    bar.id = 'staleBanner';
    bar.style.cssText = 'background:var(--warn);color:#000;padding:9px 16px;font-weight:650;' +
      'font-size:13px;text-align:center';
    bar.textContent = 'This app was updated on disk. Stop the server and start it again to load the new version.';
    document.querySelector('.main').prepend(bar);
  } catch { /* a version check is never worth breaking the page over */ }
}

async function refreshBadges() {
  try {
    const [leads, responses] = await Promise.all([
      api.get('/api/leads/stats'),
      api.get('/api/onboarding/responses', { status: 'new' }),
    ]);
    if (leads.due) state.badges.dialer = leads.due;
    else delete state.badges.dialer;
    if (responses.responses.length) state.badges.onboarding = responses.responses.length;
    else delete state.badges.onboarding;
    renderNav(parseHash().path);
  } catch { /* silent — badges are a nicety */ }
}

boot();
