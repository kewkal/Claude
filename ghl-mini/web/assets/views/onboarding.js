import {
  api, h, raw, stat, pill, guard, ok, err, modal, formData,
  fmtDateTime, ago, emptyState, titleCase,
} from '../ui.js';

let statusFilter = 'all';

export default {
  async render(root, ctx) {
    ctx.setActions(h`<button class="btn primary" id="newFormBtn">New form</button>`);
    document.getElementById('newFormBtn').onclick = () => newFormModal(() => reload(root, ctx));
    await reload(root, ctx);
    if (ctx.arg) responseModal(ctx.arg, () => reload(root, ctx));
  },
};

async function reload(root, ctx) {
  const [{ forms }, { responses }] = await Promise.all([
    api.get('/api/onboarding/forms'),
    api.get('/api/onboarding/responses', { status: statusFilter }),
  ]);
  root.innerHTML = layout(forms, responses);
  wire(root, ctx, forms, responses);
}

function layout(forms, responses) {
  const counts = responses.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});

  return h`
    <div class="grid cols-4" style="margin-bottom:14px">
      ${raw(stat('Responses', responses.length, 'total submitted'))}
      ${raw(stat('Waiting on you', counts.new || 0, 'not yet briefed', counts.new ? 'warn' : ''))}
      ${raw(stat('Briefed', counts.briefed || 0, 'ready to build', 'accent'))}
      ${raw(stat('Delivered', counts.delivered || 0, 'sites shipped', 'ok'))}
    </div>

    <div class="card" style="margin-bottom:14px">
      <h2>Your forms</h2>
      <p class="sub">Send the link once the client pays. Everything you need to build comes back in one submission.</p>
      <div class="list">
        ${raw(forms.map((f) => h`<div class="list-item">
          <div class="grow">
            <div class="t">${f.title} ${raw(f.active ? '' : '<span class="pill lost">off</span>')}</div>
            <div class="s mono">${f.public_url}</div>
          </div>
          <span class="pill">${f.responses} response${f.responses === 1 ? '' : 's'}</span>
          <span class="pill">${f.fields.length} fields</span>
          <button class="btn sm" data-copy="${f.public_url}">Copy link</button>
          <a class="btn sm" href="/f/${f.slug}" target="_blank">Preview</a>
          <button class="btn sm" data-edit-form="${f.id}">Fields</button>
        </div>`).join(''))}
      </div>
    </div>

    <div class="chips" style="margin-bottom:14px">
      ${raw(['all', 'new', 'briefed', 'building', 'delivered'].map((s) =>
        h`<button class="chip ${raw(statusFilter === s ? 'active' : '')}" data-status="${s}">${titleCase(s)}</button>`).join(''))}
    </div>

    ${raw(responses.length ? table(responses) : emptyState('📋', 'No responses yet',
      'Send a client the form link. When they fill it out, it lands here and the agents can take it from there.'))}
  `;
}

function table(responses) {
  return h`<div class="table-wrap"><table>
    <thead><tr><th>Business</th><th>Contact</th><th>Submitted</th><th>Status</th><th>Brief</th><th></th></tr></thead>
    <tbody>${raw(responses.map((r) => h`<tr class="row-click" data-response="${r.id}">
      <td><div class="name">${r.business || '—'}</div><div class="sub">${r.answers.industry ? String(r.answers.industry).slice(0, 46) : ''}</div></td>
      <td><div>${r.client_name || '—'}</div><div class="sub">${r.email || ''}</div></td>
      <td class="nowrap dim">${ago(r.created_at)}</td>
      <td>${raw(pill(r.status))}</td>
      <td class="mono dim">${r.brief_path || '—'}</td>
      <td class="right"><button class="btn sm" data-open>Open</button></td>
    </tr>`).join(''))}</tbody>
  </table></div>`;
}

function wire(root, ctx, forms, responses) {
  root.querySelectorAll('[data-status]').forEach((b) => {
    b.onclick = () => { statusFilter = b.dataset.status; reload(root, ctx); };
  });
  root.querySelectorAll('[data-copy]').forEach((b) => {
    b.onclick = async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); ok('Link copied'); }
      catch { err('Clipboard blocked. Link: ' + b.dataset.copy); }
    };
  });
  root.querySelectorAll('[data-edit-form]').forEach((b) => {
    b.onclick = () => fieldsModal(forms.find((f) => f.id === Number(b.dataset.editForm)), () => reload(root, ctx));
  });
  root.querySelectorAll('[data-response]').forEach((tr) => {
    const open = () => responseModal(tr.dataset.response, () => reload(root, ctx));
    tr.querySelector('[data-open]').onclick = (e) => { e.stopPropagation(); open(); };
    tr.onclick = (e) => { if (!e.target.closest('button, a')) open(); };
  });
}

function responseModal(id, onDone) {
  modal(async (card, close) => {
    card.className = 'modal-card wide';
    card.innerHTML = '<div class="loading">Loading…</div>';
    const { response, fields } = await api.get(`/api/onboarding/responses/${id}`);
    const statuses = ['new', 'briefed', 'building', 'delivered'];

    card.innerHTML = h`
      <div class="modal-head">
        <h2>${response.business || response.client_name || `Response ${response.id}`}</h2>
        ${raw(pill(response.status))}
        <button class="icon-btn" data-close>×</button>
      </div>
      <div class="bar">
        <div class="muted">Submitted ${fmtDateTime(response.created_at)} · ${response.email || ''} · ${response.phone || ''}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <select id="statusSel" style="width:auto">
            ${raw(statuses.map((s) => h`<option value="${s}" ${raw(response.status === s ? 'selected' : '')}>${titleCase(s)}</option>`).join(''))}
          </select>
          <a class="btn sm" href="/api/onboarding/responses/${response.id}/brief.md" target="_blank">View brief</a>
          <button class="btn sm primary" id="buildBtn">Generate brief &amp; build</button>
        </div>
      </div>
      <div class="split-line"></div>
      <div class="list" style="max-height:56vh;overflow-y:auto">
        ${raw(fields.map((f) => {
          const v = response.answers[f.key];
          if (!v) return '';
          return h`<div class="list-item" style="align-items:flex-start">
            <div class="grow">
              <div class="s">${f.label}</div>
              <div class="t" style="font-size:13.5px;white-space:pre-wrap;font-weight:500">${v}</div>
            </div>
          </div>`;
        }).join(''))}
      </div>
      ${raw(fields.filter((f) => !response.answers[f.key]).length ? h`<div class="hint" style="margin-top:12px">
        Missing: ${fields.filter((f) => !response.answers[f.key]).map((f) => f.label).join(', ')}
      </div>` : '')}`;

    card.querySelector('[data-close]').onclick = close;

    card.querySelector('#statusSel').onchange = guard(async (e) => {
      await api.patch(`/api/onboarding/responses/${response.id}`, { status: e.target.value });
      ok('Status updated');
      onDone();
    });

    card.querySelector('#buildBtn').onclick = guard(async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'Working…';
      const r = await api.post(`/api/onboarding/responses/${response.id}/brief`, { run_agent: true });
      ok(`Brief written to ${r.brief_path}. Site Builder is on it.`);
      close();
      onDone();
    });
  });
}

function newFormModal(onDone) {
  modal((card, close) => {
    card.innerHTML = h`
      <div class="modal-head"><h2>New onboarding form</h2></div>
      <form id="formForm">
        <label class="field"><span>Title</span><input name="title" placeholder="New client onboarding" required></label>
        <label class="field"><span>URL slug</span><input name="slug" placeholder="new-client" required></label>
        <label class="field"><span>Intro shown to the client</span>
          <textarea name="intro" placeholder="Fill this out once and I have everything I need. Takes about 8 minutes."></textarea></label>
        <div class="hint">It starts with the default field set. Edit the fields after you create it.</div>
        <div class="modal-foot">
          <button type="button" class="btn" data-cancel>Cancel</button>
          <button type="submit" class="btn primary">Create</button>
        </div>
      </form>`;
    card.querySelector('[data-cancel]').onclick = close;
    card.querySelector('#formForm').onsubmit = guard(async (e) => {
      e.preventDefault();
      await api.post('/api/onboarding/forms', formData(e.target));
      ok('Form created');
      close();
      onDone();
    });
  });
}

function fieldsModal(form, onDone) {
  modal((card, close) => {
    card.className = 'modal-card wide';
    card.innerHTML = h`
      <div class="modal-head"><h2>Fields — ${form.title}</h2><button class="icon-btn" data-close>×</button></div>
      <p class="muted" style="margin-top:0">One field per line: <span class="mono">key | Label | type | required</span>. Types: text, textarea, email, tel, url, number.</p>
      <textarea id="fieldsBox" class="tall">${form.fields.map((f) =>
        `${f.key} | ${f.label} | ${f.type || 'text'}${f.required ? ' | required' : ''}`).join('\n')}</textarea>
      <div class="modal-foot">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn primary" data-save>Save fields</button>
      </div>`;
    card.querySelector('[data-close]').onclick = close;
    card.querySelector('[data-cancel]').onclick = close;
    card.querySelector('[data-save]').onclick = guard(async () => {
      const fields = card.querySelector('#fieldsBox').value.split('\n')
        .map((line) => line.trim()).filter(Boolean)
        .map((line) => {
          const [key, label, type, req] = line.split('|').map((p) => p.trim());
          if (!key) return null;
          return {
            key: key.replace(/[^a-z0-9_]/gi, '_').toLowerCase(),
            label: label || key,
            type: type || 'text',
            required: /required|yes|true/i.test(req || ''),
          };
        }).filter(Boolean);
      if (!fields.length) return err('Give it at least one field');
      await api.patch(`/api/onboarding/forms/${form.id}`, { fields });
      ok(`Saved ${fields.length} fields`);
      close();
      onDone();
    });
  });
}
