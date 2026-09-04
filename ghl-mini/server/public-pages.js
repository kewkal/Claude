import { escapeHtml } from './lib/http.js';
import { allSettings } from './lib/settings.js';

const shell = (title, body, extraCss = '') => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='26' font-size='26'>&#9889;</text></svg>">
<style>
  :root{--bg:#0f1115;--card:#171a21;--line:#262a33;--fg:#e8eaed;--muted:#9aa3b2;--accent:#4f8cff;--ok:#2fbf71;--err:#ff5c5c}
  @media (prefers-color-scheme: light){
    :root{--bg:#f6f7f9;--card:#fff;--line:#e3e6ec;--fg:#161a20;--muted:#69707d;--accent:#2563eb}
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:32px 16px}
  .wrap{max-width:680px;margin:0 auto}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px;margin-bottom:16px}
  h1{margin:0 0 8px;font-size:26px;letter-spacing:-.02em}
  h2{margin:24px 0 8px;font-size:16px}
  p.intro{color:var(--muted);margin:0 0 24px}
  label{display:block;margin:18px 0 6px;font-weight:600;font-size:14px}
  .req{color:var(--accent)}
  input,textarea,select{width:100%;padding:11px 13px;border:1px solid var(--line);border-radius:9px;background:var(--bg);color:var(--fg);font:inherit}
  input:focus,textarea:focus,select:focus{outline:2px solid var(--accent);outline-offset:-1px;border-color:transparent}
  textarea{min-height:96px;resize:vertical}
  button{margin-top:24px;width:100%;padding:13px;border:0;border-radius:9px;background:var(--accent);color:#fff;font:inherit;font-weight:650;cursor:pointer}
  button:hover{filter:brightness(1.08)}
  button:disabled{opacity:.55;cursor:not-allowed}
  .msg{padding:12px 14px;border-radius:9px;margin-bottom:16px;display:none}
  .msg.err{display:block;background:rgba(255,92,92,.12);color:var(--err);border:1px solid rgba(255,92,92,.3)}
  .done{text-align:center;padding:40px 20px}
  .done .tick{font-size:44px;margin-bottom:12px}
  .foot{text-align:center;color:var(--muted);font-size:13px;margin-top:20px}
  ${extraCss}
</style></head><body><div class="wrap">${body}</div></body></html>`;

export function loginPage(error = '') {
  const s = allSettings();
  return shell(`Sign in — ${s.business_name}`, `
    <div class="card">
      <h1>${escapeHtml(s.business_name)}</h1>
      <p class="intro">Sign in to your HQ.</p>
      ${error ? `<div class="msg err">${escapeHtml(error)}</div>` : ''}
      <form method="POST" action="/login">
        <label>Email</label>
        <input type="email" name="email" required autocomplete="username" autofocus>
        <label>Password</label>
        <input type="password" name="password" required autocomplete="current-password">
        <button type="submit">Sign in</button>
      </form>
    </div>
    <p class="foot">ghl-mini · self-hosted</p>
  `);
}

export function formPage(form) {
  const s = allSettings();
  const fields = form.fields.map((f) => {
    const req = f.required ? ' <span class="req">*</span>' : '';
    const attrs = `name="${escapeHtml(f.key)}" id="f_${escapeHtml(f.key)}"${f.required ? ' required' : ''}${f.placeholder ? ` placeholder="${escapeHtml(f.placeholder)}"` : ''}`;
    let input;
    if (f.type === 'textarea') input = `<textarea ${attrs}></textarea>`;
    else if (f.type === 'select') {
      input = `<select ${attrs}>${(f.options || []).map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('')}</select>`;
    } else input = `<input type="${escapeHtml(f.type || 'text')}" ${attrs}>`;
    return `<label for="f_${escapeHtml(f.key)}">${escapeHtml(f.label)}${req}</label>${input}`;
  }).join('\n');

  return shell(`${form.title} — ${s.business_name}`, `
    <div class="card" id="formCard">
      <h1>${escapeHtml(form.title)}</h1>
      <p class="intro">${escapeHtml(form.intro)}</p>
      <div class="msg" id="msg"></div>
      <form id="onboardForm">${fields}<button type="submit" id="submitBtn">Submit</button></form>
    </div>
    <div class="card done" id="doneCard" hidden>
      <div class="tick">✅</div>
      <h1>Got it</h1>
      <p class="intro">Thanks. Everything we need is in. We'll be in touch shortly.</p>
    </div>
    <p class="foot">${escapeHtml(s.business_name)}</p>
    <script>
      const form = document.getElementById('onboardForm');
      const msg = document.getElementById('msg');
      const btn = document.getElementById('submitBtn');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        btn.disabled = true; btn.textContent = 'Sending…'; msg.className = 'msg';
        const payload = Object.fromEntries(new FormData(form));
        try {
          const res = await fetch(location.pathname, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Something went wrong');
          document.getElementById('formCard').hidden = true;
          document.getElementById('doneCard').hidden = false;
          window.scrollTo(0, 0);
        } catch (err) {
          msg.className = 'msg err'; msg.textContent = err.message;
          btn.disabled = false; btn.textContent = 'Submit';
        }
      });
    </script>
  `);
}

export function bookingPage() {
  const s = allSettings();
  return shell(`Book a call — ${s.business_name}`, `
    <div class="card" id="bookCard">
      <h1>Book a call</h1>
      <p class="intro">${escapeHtml(s.booking_duration_min)} minutes with ${escapeHtml(s.business_name)}. Pick a time that works.</p>
      <div class="msg" id="msg"></div>
      <div id="slots"><p class="intro">Loading times…</p></div>
      <form id="bookForm" hidden>
        <label>Your name <span class="req">*</span></label>
        <input name="name" required>
        <label>Email <span class="req">*</span></label>
        <input type="email" name="email" required>
        <label>Phone</label>
        <input type="tel" name="phone">
        <label>What do you want to cover?</label>
        <textarea name="notes"></textarea>
        <button type="submit" id="bookBtn">Confirm booking</button>
      </form>
    </div>
    <div class="card done" id="doneCard" hidden>
      <div class="tick">📅</div><h1>You're booked</h1>
      <p class="intro" id="doneWhen"></p>
    </div>
    <style>
      .slot{display:inline-block;margin:4px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;cursor:pointer;background:var(--bg);font-size:13px}
      .slot:hover{border-color:var(--accent)}
      .slot.sel{background:var(--accent);color:#fff;border-color:var(--accent)}
      .dayhead{margin:16px 0 6px;font-weight:650;font-size:13px;color:var(--muted)}
    </style>
    <script>
      let chosen = null;
      const msg = document.getElementById('msg');
      (async () => {
        const res = await fetch('/api/public/slots?days=14');
        const { slots } = await res.json();
        const box = document.getElementById('slots');
        if (!slots.length) { box.innerHTML = '<p class="intro">No times open right now. Email us instead.</p>'; return; }
        const byDay = {};
        for (const s of slots) {
          const d = new Date(s.starts_at).toDateString();
          (byDay[d] ||= []).push(s);
        }
        box.innerHTML = Object.entries(byDay).map(([day, list]) =>
          '<div class="dayhead">' + day + '</div>' + list.map(s =>
            '<span class="slot" data-start="' + s.starts_at + '" data-end="' + s.ends_at + '">' +
            new Date(s.starts_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '</span>'
          ).join('')
        ).join('');
        box.addEventListener('click', (e) => {
          const el = e.target.closest('.slot');
          if (!el) return;
          box.querySelectorAll('.slot').forEach(s => s.classList.remove('sel'));
          el.classList.add('sel');
          chosen = { starts_at: el.dataset.start, ends_at: el.dataset.end };
          document.getElementById('bookForm').hidden = false;
        });
      })();
      document.getElementById('bookForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!chosen) { msg.className = 'msg err'; msg.textContent = 'Pick a time first.'; return; }
        const btn = document.getElementById('bookBtn');
        btn.disabled = true; btn.textContent = 'Booking…';
        const payload = { ...Object.fromEntries(new FormData(e.target)), ...chosen };
        const res = await fetch('/api/public/book', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) {
          msg.className = 'msg err'; msg.textContent = data.error || 'Could not book that slot.';
          btn.disabled = false; btn.textContent = 'Confirm booking'; return;
        }
        document.getElementById('doneWhen').textContent = new Date(chosen.starts_at).toLocaleString();
        document.getElementById('bookCard').hidden = true;
        document.getElementById('doneCard').hidden = false;
      });
    </script>
  `);
}

export function notFoundPage(message = 'That page does not exist.') {
  return shell('Not found', `<div class="card done"><div class="tick">🤷</div><h1>Not found</h1><p class="intro">${escapeHtml(message)}</p></div>`);
}
