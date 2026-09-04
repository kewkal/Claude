import { api, h, raw, guard, ok, err, formData, fmtDateTime, titleCase, pill, emptyState } from '../ui.js';

export default {
  async render(root, ctx) {
    await reload(root, ctx);
  },
};

async function reload(root, ctx) {
  const [{ settings }, conn, { outbox }] = await Promise.all([
    api.get('/api/settings'),
    api.get('/api/settings/connections'),
    api.get('/api/outbox', { limit: 20 }),
  ]);
  root.innerHTML = layout(settings, conn, outbox);
  wire(root, ctx, settings);
}

function layout(s, conn, outbox) {
  return h`
    <div class="card" style="margin-bottom:14px">
      <h2>What's connected</h2>
      <p class="sub">${conn.ready} of ${conn.connections.length} plugged in. Everything works without these, you just do more by hand.</p>
      <div class="grid cols-2">
        ${raw(conn.connections.map((c) => h`<div class="conn ${raw(c.connected ? 'on' : '')}">
          <div class="dot"></div>
          <div class="grow">
            <div class="n">${c.name} ${raw(c.connected ? '<span class="pill won">connected</span>' : '<span class="pill">not set up</span>')}</div>
            <div class="w">${c.why}</div>
            <div class="h">${c.help}</div>
          </div>
          ${raw(['email', 'google_maps', 'twilio'].includes(c.id)
            ? h`<button class="btn sm" data-test="${c.id}">Test</button>` : '')}
        </div>`).join(''))}
      </div>
      <div class="grid cols-3" style="margin-top:14px">
        ${raw(Object.entries(conn.counts).map(([k, v]) =>
          h`<div class="stat"><div class="label">${titleCase(k)}</div><div class="value">${v.toLocaleString()}</div></div>`).join(''))}
      </div>
    </div>

    <form id="settingsForm">
      <div class="grid cols-2">
        <div class="card">
          <h2>Business</h2>
          <p class="sub">Shows on your forms, booking page and outgoing email.</p>
          <label class="field"><span>Business name</span><input name="business_name" value="${s.business_name}"></label>
          <label class="field"><span>Your name</span><input name="owner_name" value="${s.owner_name}"></label>
          <label class="field"><span>Your email</span><input type="email" name="owner_email" value="${s.owner_email}"
            placeholder="Where new onboarding submissions get sent"></label>
          <label class="field"><span>Timezone</span><input name="timezone" value="${s.timezone}"></label>
          <label class="field"><span>Public URL</span><input name="public_url" value="${s.public_url}">
            <div class="hint">Used to build shareable form and booking links.</div></label>
        </div>

        <div class="card">
          <h2>Email</h2>
          <p class="sub">Give the agents a way to actually send. Resend is the fastest to set up.</p>
          <label class="field"><span>Provider</span>
            <select name="email_provider">
              ${raw(['none', 'resend', 'mailgun', 'postmark'].map((p) =>
                h`<option value="${p}" ${raw(s.email_provider === p ? 'selected' : '')}>${p === 'none' ? 'Not connected' : titleCase(p)}</option>`).join(''))}
            </select></label>
          <label class="field"><span>API key</span><input name="email_api_key" value="${s.email_api_key}"
            placeholder="re_… / key-… / server token"></label>
          <label class="field"><span>Send from</span><input name="email_from" value="${s.email_from}"
            placeholder="you@yourdomain.com"></label>
          <label class="field"><span>Mailgun domain</span><input name="mailgun_domain" value="${s.mailgun_domain}"
            placeholder="mg.yourdomain.com"><div class="hint">Mailgun only.</div></label>
        </div>

        <div class="card">
          <h2>Google Maps API</h2>
          <p class="sub">This is the lead machine. Places API in Google Cloud Console.</p>
          <label class="field"><span>API key</span><input name="google_maps_api_key" value="${s.google_maps_api_key}"
            placeholder="AIza…"></label>
          <label class="field"><span>Default search radius (meters)</span>
            <input type="number" name="default_search_radius_m" value="${s.default_search_radius_m}"></label>
          <div class="hint">Enable "Places API" and "Places API (New)". Set a quota cap so a runaway scrape can't surprise you.</div>
        </div>

        <div class="card">
          <h2>Twilio</h2>
          <p class="sub">Optional. Click-to-call and SMS. Without it the dialer still logs everything.</p>
          <label class="field"><span>Account SID</span><input name="twilio_account_sid" value="${s.twilio_account_sid}" placeholder="AC…"></label>
          <label class="field"><span>Auth token</span><input name="twilio_auth_token" value="${s.twilio_auth_token}"></label>
          <label class="field"><span>From number</span><input name="twilio_from_number" value="${s.twilio_from_number}" placeholder="+15125550100"></label>
        </div>

        <div class="card">
          <h2>Agents</h2>
          <p class="sub">How the six agents actually get run.</p>
          <label class="field"><span>Claude Code binary</span><input name="claude_bin" value="${s.claude_bin}" placeholder="claude"></label>
          <label class="field">
            <input type="checkbox" name="agents_enabled" ${raw(s.agents_enabled === '1' ? 'checked' : '')}>
            Run agents automatically when queued
          </label>
          <div class="hint">Off means tasks still get written to <span class="mono">agent-queue/</span> for you to run by hand.</div>
        </div>

        <div class="card">
          <h2>Targets</h2>
          <p class="sub">What Daily HQ measures you against.</p>
          <label class="field"><span>Daily hours target</span><input type="number" step="0.5" name="daily_target_hours" value="${s.daily_target_hours}"></label>
          <label class="field"><span>Daily call target</span><input type="number" name="daily_call_target" value="${s.daily_call_target}"></label>
          <label class="field"><span>Default booking title</span><input name="booking_title" value="${s.booking_title}"></label>
          <label class="field"><span>Default booking length (min)</span><input type="number" name="booking_duration_min" value="${s.booking_duration_min}"></label>
        </div>
      </div>

      <div class="bar" style="margin-top:16px">
        <div class="hint">Secrets are encrypted in the database. Leave a masked field alone to keep the current value.</div>
        <button type="submit" class="btn primary">Save settings</button>
      </div>
    </form>

    <div class="card" style="margin-top:14px">
      <h2>Change password</h2>
      <form id="pwForm" class="inline" style="margin-top:10px">
        <label class="field"><span>New password</span><input type="password" name="password" minlength="8" required></label>
        <button class="btn" type="submit">Change it</button>
      </form>
      <div class="hint">You'll be signed out of every device.</div>
    </div>

    <div class="card">
      <h2>Email outbox</h2>
      <p class="sub">Everything the app tried to send, whether or not a provider was connected.</p>
      ${raw(outbox.length ? h`<div class="table-wrap"><table>
        <thead><tr><th>When</th><th>To</th><th>Subject</th><th>Status</th></tr></thead>
        <tbody>${raw(outbox.map((e) => h`<tr>
          <td class="nowrap dim">${fmtDateTime(e.created_at)}</td>
          <td class="truncate">${e.to_addr}</td>
          <td class="truncate">${e.subject}</td>
          <td>${raw(pill(e.status))}${raw(e.error ? h`<div class="s dim truncate" title="${e.error}">${e.error}</div>` : '')}</td>
        </tr>`).join(''))}</tbody></table></div>`
        : emptyState('📭', 'Nothing sent yet', 'Confirmations and outreach show up here.'))}
    </div>
  `;
}

function wire(root, ctx, settings) {
  root.querySelector('#settingsForm').onsubmit = guard(async (e) => {
    e.preventDefault();
    const v = formData(e.target);
    v.agents_enabled = v.agents_enabled ? '1' : '0';
    await api.put('/api/settings', { settings: v });
    ok('Settings saved');
    reload(root, ctx);
  });

  root.querySelector('#pwForm').onsubmit = guard(async (e) => {
    e.preventDefault();
    const v = formData(e.target);
    const r = await api.post('/api/settings/password', { password: v.password });
    ok(r.message);
    setTimeout(() => { location.href = '/login'; }, 1400);
  });

  root.querySelectorAll('[data-test]').forEach((btn) => {
    btn.onclick = guard(async () => {
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Testing…';
      try {
        const r = await api.post(`/api/settings/test/${btn.dataset.test}`, {});
        if (r.ok) ok(`${titleCase(btn.dataset.test.replace('_', ' '))} works`);
        else err(r.message || 'Test came back not-ok');
      } finally {
        btn.disabled = false;
        btn.textContent = label;
      }
    });
  });
}
