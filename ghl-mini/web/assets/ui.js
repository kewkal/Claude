// ---------------------------------------------------------------------------
// Small DOM + fetch helpers. No framework, no build step.
// ---------------------------------------------------------------------------

/** Escape text for safe insertion into HTML. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

/** Tagged template that escapes every interpolation. Use h`<b>${x}</b>`. */
export function h(strings, ...values) {
  return strings.reduce((out, str, i) => {
    if (i === 0) return str;
    const v = values[i - 1];
    const safe = v && v.__raw ? v.value : esc(Array.isArray(v) ? v.join('') : v);
    return out + safe + str;
  }, '');
}

/** Mark a string as already-safe HTML inside an h`` template. */
export const raw = (value) => ({ __raw: true, value: Array.isArray(value) ? value.join('') : String(value ?? '') });

const jsonHeaders = { 'content-type': 'application/json' };

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? jsonHeaders : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { location.href = '/login'; throw new Error('Not signed in'); }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error((data && data.error) || `${method} ${path} failed (${res.status})`);
  return data;
}

export const api = {
  get: (path, params) => {
    const qs = params ? '?' + new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null))
    ) : '';
    return request('GET', path + qs);
  },
  post: (path, body) => request('POST', path, body || {}),
  put: (path, body) => request('PUT', path, body || {}),
  patch: (path, body) => request('PATCH', path, body || {}),
  del: (path) => request('DELETE', path),
};

let toastTimer;
export function toast(message, kind = '') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, kind === 'err' ? 5200 : 2800);
}

export const ok = (m) => toast(m, 'ok');
export const err = (m) => toast(m, 'err');

/** Wrap an async handler so thrown errors surface as a toast. */
export function guard(fn) {
  return async (...args) => {
    try { return await fn(...args); }
    catch (e) { err(e.message); }
  };
}

/** Open a modal. `render` gets a `close` function. Returns close. */
export function modal(render) {
  const wrap = document.getElementById('modal');
  const card = document.getElementById('modalCard');
  const close = () => {
    wrap.hidden = true;
    card.innerHTML = '';
    wrap.onclick = null;
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  wrap.hidden = false;
  wrap.onclick = (e) => { if (e.target === wrap) close(); };
  document.addEventListener('keydown', onKey);
  card.className = 'modal-card';
  render(card, close);
  return close;
}

export function confirmDialog(message, onYes, { danger = true, yes = 'Confirm' } = {}) {
  modal((card, close) => {
    card.innerHTML = h`
      <div class="modal-head"><h2>Are you sure?</h2></div>
      <p class="muted">${message}</p>
      <div class="modal-foot">
        <button class="btn" data-no>Cancel</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${yes}</button>
      </div>`;
    card.querySelector('[data-no]').onclick = close;
    card.querySelector('[data-yes]').onclick = guard(async () => { await onYes(); close(); });
  });
}

/** Collect a form's fields into a plain object. */
export function formData(root) {
  const out = {};
  for (const el of root.querySelectorAll('[name]')) {
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'number') out[el.name] = el.value === '' ? null : Number(el.value);
    else out[el.name] = el.value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** SQLite stores UTC without a zone marker; normalize before parsing. */
export function toDate(value) {
  if (!value) return null;
  const s = String(value);
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  return new Date(/[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z');
}

export function fmtDate(value) {
  const d = toDate(value);
  return d ? d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
}

export function fmtDateTime(value) {
  const d = toDate(value);
  return d ? d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
}

export function fmtTime(value) {
  const d = toDate(value);
  return d ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
}

export function ago(value) {
  const d = toDate(value);
  if (!d) return '—';
  const secs = Math.round((Date.now() - d.getTime()) / 1000);
  const abs = Math.abs(secs);
  const units = [[60, 'sec'], [3600, 'min'], [86400, 'hr'], [604800, 'day'], [2629800, 'wk'], [Infinity, 'mo']];
  let prev = 1;
  for (const [limit, name] of units) {
    if (abs < limit) {
      const n = Math.round(abs / prev);
      const label = `${n} ${name}${n === 1 ? '' : 's'}`;
      return secs >= 0 ? `${label} ago` : `in ${label}`;
    }
    prev = limit;
  }
  return d.toLocaleDateString();
}

export function fmtDuration(seconds) {
  const s = Number(seconds) || 0;
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function fmtMoney(cents) {
  return (Number(cents) / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export const titleCase = (s) => String(s ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const pill = (value, extraClass = '') =>
  h`<span class="pill ${raw(esc(value))} ${raw(esc(extraClass))}">${titleCase(value)}</span>`;

export function scorePill(score) {
  const n = Number(score) || 0;
  const cls = n >= 80 ? 'hot' : n >= 60 ? 'warm' : '';
  return h`<span class="pill score ${raw(cls)}">${n}</span>`;
}

export function stat(label, value, meta = '', kind = '') {
  return h`<div class="stat ${raw(esc(kind))}">
    <div class="label">${label}</div>
    <div class="value">${value}</div>
    ${raw(meta ? h`<div class="meta">${meta}</div>` : '')}
  </div>`;
}

export function emptyState(icon, title, sub = '') {
  return h`<div class="empty"><div class="big">${icon}</div>
    <div style="font-weight:650;font-size:15px;margin-bottom:4px">${title}</div>
    <div class="muted">${sub}</div></div>`;
}

/** Bind [data-on] click handlers declared in a rendered chunk. */
export function on(root, selector, event, handler) {
  root.querySelectorAll(selector).forEach((el) => el.addEventListener(event, handler));
}

export function debounce(fn, ms = 280) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
