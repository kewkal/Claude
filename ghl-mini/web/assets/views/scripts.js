import { api, h, raw, guard, ok, err, modal, confirmDialog, formData, emptyState, titleCase } from '../ui.js';

let kindFilter = 'all';

export default {
  async render(root, ctx) {
    ctx.setActions(h`
      <button class="btn" id="genBtn">Have an agent write one</button>
      <button class="btn primary" id="newBtn">New script</button>
    `);
    document.getElementById('newBtn').onclick = () => editModal(null, () => reload(root, ctx));
    document.getElementById('genBtn').onclick = () => generateModal(() => reload(root, ctx));
    await reload(root, ctx);
  },
};

async function reload(root, ctx) {
  const data = await api.get('/api/scripts', { kind: kindFilter });
  root.innerHTML = layout(data);
  wire(root, ctx, data);
}

function layout(data) {
  const kinds = ['all', ...data.kinds];
  return h`
    <div class="chips" style="margin-bottom:16px">
      ${raw(kinds.map((k) => h`<button class="chip ${raw(kindFilter === k ? 'active' : '')}" data-kind="${k}">${titleCase(k)}</button>`).join(''))}
    </div>
    ${raw(data.scripts.length
      ? h`<div class="grid cols-2">${raw(data.scripts.map(cardFor).join(''))}</div>`
      : emptyState('📝', 'No scripts here yet', 'Write one, or let the Outreach Writer draft the first pass.'))}
  `;
}

function cardFor(s) {
  const winRate = s.uses ? Math.round((s.wins / s.uses) * 100) : null;
  return h`<div class="card" data-script="${s.id}">
    <div class="bar" style="margin-bottom:8px">
      <div>
        <h2 style="margin:0">${s.name}</h2>
        <div class="sub" style="margin:2px 0 0">
          <span class="pill">${titleCase(s.kind)}</span>
          <span class="pill">${s.segment}</span>
          ${raw(s.is_default ? '<span class="pill new">default</span>' : '')}
        </div>
      </div>
      <div class="right dim nowrap" style="font-size:12px">
        ${s.uses} uses${raw(winRate != null ? h` · <b style="color:var(--ok)">${winRate}% booked</b>` : '')}
      </div>
    </div>
    ${raw(s.subject ? h`<div class="mono dim" style="margin-bottom:6px">Subject: ${s.subject}</div>` : '')}
    <pre class="out" style="max-height:200px">${s.body}</pre>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <button class="btn sm" data-edit>Edit</button>
      <button class="btn sm" data-copy>Copy</button>
      <button class="btn sm danger" data-del>Delete</button>
    </div>
  </div>`;
}

function wire(root, ctx, data) {
  root.querySelectorAll('[data-kind]').forEach((btn) => {
    btn.onclick = () => { kindFilter = btn.dataset.kind; reload(root, ctx); };
  });
  root.querySelectorAll('[data-script]').forEach((card) => {
    const id = Number(card.dataset.script);
    const script = data.scripts.find((s) => s.id === id);
    card.querySelector('[data-edit]').onclick = () => editModal(script, () => reload(root, ctx));
    card.querySelector('[data-copy]').onclick = async () => {
      try {
        await navigator.clipboard.writeText(script.body);
        ok('Copied');
      } catch { err('Clipboard blocked by the browser'); }
    };
    card.querySelector('[data-del]').onclick = () =>
      confirmDialog(`Delete "${script.name}"?`, async () => {
        await api.del(`/api/scripts/${id}`);
        ok('Deleted');
        reload(root, ctx);
      });
  });
}

function editModal(script, onDone) {
  const kinds = ['call', 'email', 'sms', 'voicemail', 'objection'];
  modal((card, close) => {
    card.className = 'modal-card wide';
    card.innerHTML = h`
      <div class="modal-head"><h2>${script ? 'Edit script' : 'New script'}</h2><button class="icon-btn" data-close>×</button></div>
      <form id="scriptForm">
        <div class="inline">
          <label class="field"><span>Name</span><input name="name" value="${script?.name || ''}" required></label>
          <label class="field"><span>Kind</span><select name="kind">
            ${raw(kinds.map((k) => h`<option value="${k}" ${raw(script?.kind === k ? 'selected' : '')}>${titleCase(k)}</option>`).join(''))}
          </select></label>
          <label class="field"><span>Segment</span><input name="segment" value="${script?.segment || 'general'}"></label>
        </div>
        <label class="field"><span>Subject (email only)</span><input name="subject" value="${script?.subject || ''}"></label>
        <label class="field"><span>Body</span>
          <textarea name="body" class="tall">${script?.body || ''}</textarea></label>
        <div class="hint">Tokens get filled from the lead: {{name}}, {{city}}, {{category}}, {{phone}}, {{rating}}, {{review_count}}, {{website}}</div>
        <label class="field" style="margin-top:10px">
          <input type="checkbox" name="is_default" ${raw(script?.is_default ? 'checked' : '')}> Make this the default for its kind
        </label>
        <div class="modal-foot">
          <button type="button" class="btn" data-cancel>Cancel</button>
          <button type="submit" class="btn primary">Save</button>
        </div>
      </form>`;
    card.querySelector('[data-close]').onclick = close;
    card.querySelector('[data-cancel]').onclick = close;
    card.querySelector('#scriptForm').onsubmit = guard(async (e) => {
      e.preventDefault();
      const v = formData(e.target);
      if (script) await api.patch(`/api/scripts/${script.id}`, v);
      else await api.post('/api/scripts', v);
      ok('Saved');
      close();
      onDone();
    });
  });
}

function generateModal(onDone) {
  modal((card, close) => {
    card.innerHTML = h`
      <div class="modal-head"><h2>Have an agent write it</h2></div>
      <p class="muted" style="margin-top:0">Outreach Writer handles email and SMS. Call Closer handles call scripts and objections. Give it the segment and your offer, it does the rest.</p>
      <form id="genForm">
        <div class="inline">
          <label class="field"><span>Kind</span><select name="kind">
            <option value="email">Email</option><option value="sms">SMS</option>
            <option value="call">Call</option><option value="objection">Objection handling</option>
          </select></label>
          <label class="field"><span>Segment</span><input name="segment" placeholder="Roofers with no website" required></label>
        </div>
        <label class="field"><span>Your offer</span>
          <textarea name="offer" placeholder="A 5-page site live in 72 hours for $1,500 plus $99/mo hosting" required></textarea></label>
        <label class="field"><span>Tone</span><input name="tone" placeholder="Direct, no fluff, one clear ask"></label>
        <div class="modal-foot">
          <button type="button" class="btn" data-cancel>Cancel</button>
          <button type="submit" class="btn primary">Send to the agent</button>
        </div>
      </form>`;
    card.querySelector('[data-cancel]').onclick = close;
    card.querySelector('#genForm').onsubmit = guard(async (e) => {
      e.preventDefault();
      await api.post('/api/scripts/generate', formData(e.target));
      ok('Queued. Check the Agents tab.');
      close();
      onDone();
    });
  });
}
