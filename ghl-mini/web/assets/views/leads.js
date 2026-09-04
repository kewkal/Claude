import {
  api, h, raw, esc, stat, pill, scorePill, guard, ok, err, modal, confirmDialog,
  fmtDate, ago, formData, emptyState, debounce, titleCase,
} from '../ui.js';

const filters = { q: '', status: 'all', city: '', has_website: '', min_score: '', sort: 'score', page: 1, limit: 50 };
let selected = new Set();

export default {
  async render(root, ctx) {
    ctx.setActions(h`
      <button class="btn" id="importBtn">Import CSV</button>
      <a class="btn" href="/api/leads/export.csv" download>Export</a>
      <button class="btn primary" id="scrapeBtn">Scrape leads</button>
    `);
    document.getElementById('scrapeBtn').onclick = () => scrapeModal(() => reload(root, ctx));
    document.getElementById('importBtn').onclick = () => importModal(() => reload(root, ctx));
    await reload(root, ctx);
  },
};

async function reload(root, ctx) {
  const [data, stats] = await Promise.all([
    api.get('/api/leads', filters),
    api.get('/api/leads/stats'),
  ]);
  selected = new Set([...selected].filter((id) => data.leads.some((l) => l.id === id)));
  root.innerHTML = layout(data, stats);
  wire(root, ctx, data, stats);
}

function layout(data, stats) {
  return h`
    <div class="grid cols-5" style="margin-bottom:14px">
      ${raw(stat('Total leads', stats.total.toLocaleString(), `${stats.added_today} added today`))}
      ${raw(stat('No website', stats.no_website.toLocaleString(), 'easiest sale', 'accent'))}
      ${raw(stat('Callable', stats.callable.toLocaleString(), 'have a phone number'))}
      ${raw(stat('Booked', (stats.byStatus.booked || 0).toLocaleString(), `${stats.byStatus.won || 0} won`, 'ok'))}
      ${raw(stat('Follow-ups due', stats.due.toLocaleString(), 'overdue right now', stats.due ? 'warn' : ''))}
    </div>

    <div class="filters">
      <input class="grow" id="qInput" placeholder="Search name, phone, address…" value="${filters.q}">
      <select id="statusSel">
        <option value="all">All statuses</option>
        ${raw(stats.statuses.map((s) => h`<option value="${s}" ${raw(filters.status === s ? 'selected' : '')}>${titleCase(s)} (${stats.byStatus[s] || 0})</option>`).join(''))}
      </select>
      <select id="citySel">
        <option value="">All cities</option>
        ${raw(stats.topCities.map((c) => h`<option value="${c.city}" ${raw(filters.city === c.city ? 'selected' : '')}>${c.city} (${c.n})</option>`).join(''))}
      </select>
      <select id="webSel">
        <option value="">Website: any</option>
        <option value="0" ${raw(filters.has_website === '0' ? 'selected' : '')}>No website</option>
        <option value="1" ${raw(filters.has_website === '1' ? 'selected' : '')}>Has website</option>
      </select>
      <select id="sortSel">
        <option value="score" ${raw(filters.sort === 'score' ? 'selected' : '')}>Best first</option>
        <option value="newest" ${raw(filters.sort === 'newest' ? 'selected' : '')}>Newest</option>
        <option value="reviews" ${raw(filters.sort === 'reviews' ? 'selected' : '')}>Most reviews</option>
        <option value="name" ${raw(filters.sort === 'name' ? 'selected' : '')}>A-Z</option>
        <option value="next" ${raw(filters.sort === 'next' ? 'selected' : '')}>Next action</option>
      </select>
      <button class="btn ghost" id="clearBtn">Clear</button>
    </div>

    <div class="bar" id="bulkBar" ${raw(selected.size ? '' : 'hidden')}>
      <div><b id="selCount">${selected.size}</b> selected</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn sm" data-bulk="queue">Queue for calling</button>
        <select id="bulkStatus" style="width:auto"><option value="">Set status…</option>
          ${raw(stats.statuses.map((s) => h`<option value="${s}">${titleCase(s)}</option>`).join(''))}
        </select>
        <button class="btn sm" data-bulk="tag">Tag</button>
        <button class="btn sm" data-bulk="sequence">Start a sequence</button>
        <button class="btn sm danger" data-bulk="delete">Delete</button>
      </div>
    </div>

    ${raw(data.leads.length ? table(data) : emptyState('📇', 'No leads match', 'Change the filters, or scrape a new city.'))}

    ${raw(data.pages > 1 ? h`<div class="bar" style="margin-top:14px">
      <div class="muted">Page ${data.page} of ${data.pages} · ${data.total.toLocaleString()} leads</div>
      <div style="display:flex;gap:8px">
        <button class="btn sm" id="prevPage" ${raw(data.page <= 1 ? 'disabled' : '')}>Previous</button>
        <button class="btn sm" id="nextPage" ${raw(data.page >= data.pages ? 'disabled' : '')}>Next</button>
      </div>
    </div>` : '')}
  `;
}

function table(data) {
  return h`<div class="table-wrap"><table>
    <thead><tr>
      <th style="width:32px"><input type="checkbox" id="selAll"></th>
      <th>Business</th><th>Phone</th><th>Website</th><th>City</th>
      <th class="num">Reviews</th><th class="num">Score</th><th>Status</th><th>Next</th><th></th>
    </tr></thead>
    <tbody>${raw(data.leads.map(row).join(''))}</tbody>
  </table></div>`;
}

function row(l) {
  return h`<tr data-id="${l.id}" class="row-click">
    <td><input type="checkbox" data-sel ${raw(selected.has(l.id) ? 'checked' : '')}></td>
    <td>
      <div class="name">${l.name}</div>
      <div class="sub">${l.category || '—'}${l.rating ? ` · ${l.rating}★` : ''}</div>
    </td>
    <td class="nowrap mono">${l.phone || '—'}</td>
    <td>${raw(l.website
      ? h`<a href="${l.website}" target="_blank" rel="noopener" class="truncate" style="display:inline-block">${l.website.replace(/^https?:\/\//, '').slice(0, 30)}</a>`
      : '<span class="pill" style="color:var(--accent);border-color:var(--accent)">none</span>')}</td>
    <td class="nowrap">${l.city || '—'}</td>
    <td class="num">${l.review_count ?? '—'}</td>
    <td class="num">${raw(scorePill(l.score))}</td>
    <td>${raw(pill(l.status))}</td>
    <td class="nowrap dim">${l.next_action_at ? ago(l.next_action_at) : '—'}</td>
    <td class="right nowrap"><button class="btn sm" data-open>Open</button></td>
  </tr>`;
}

function wire(root, ctx, data, stats) {
  const apply = () => { filters.page = 1; reload(root, ctx); };

  const q = root.querySelector('#qInput');
  q.oninput = debounce(() => { filters.q = q.value; apply(); });
  root.querySelector('#statusSel').onchange = (e) => { filters.status = e.target.value; apply(); };
  root.querySelector('#citySel').onchange = (e) => { filters.city = e.target.value; apply(); };
  root.querySelector('#webSel').onchange = (e) => { filters.has_website = e.target.value; apply(); };
  root.querySelector('#sortSel').onchange = (e) => { filters.sort = e.target.value; apply(); };
  root.querySelector('#clearBtn').onclick = () => {
    Object.assign(filters, { q: '', status: 'all', city: '', has_website: '', min_score: '', sort: 'score', page: 1 });
    reload(root, ctx);
  };

  root.querySelector('#prevPage')?.addEventListener('click', () => { filters.page--; reload(root, ctx); });
  root.querySelector('#nextPage')?.addEventListener('click', () => { filters.page++; reload(root, ctx); });

  const bar = root.querySelector('#bulkBar');
  const count = root.querySelector('#selCount');
  const sync = () => {
    count.textContent = selected.size;
    bar.hidden = selected.size === 0;
  };

  root.querySelector('#selAll')?.addEventListener('change', (e) => {
    if (e.target.checked) data.leads.forEach((l) => selected.add(l.id));
    else selected.clear();
    root.querySelectorAll('[data-sel]').forEach((cb) => { cb.checked = e.target.checked; });
    sync();
  });

  root.querySelectorAll('tr[data-id]').forEach((tr) => {
    const id = Number(tr.dataset.id);
    tr.querySelector('[data-sel]').onchange = (e) => {
      e.stopPropagation();
      if (e.target.checked) selected.add(id); else selected.delete(id);
      sync();
    };
    const open = () => leadModal(id, () => reload(root, ctx));
    tr.querySelector('[data-open]').onclick = (e) => { e.stopPropagation(); open(); };
    tr.onclick = (e) => { if (!e.target.closest('input, a, button')) open(); };
  });

  root.querySelectorAll('[data-bulk]').forEach((btn) => {
    btn.onclick = guard(async () => {
      const ids = [...selected];
      const action = btn.dataset.bulk;
      if (action === 'delete') {
        return confirmDialog(`Delete ${ids.length} lead${ids.length === 1 ? '' : 's'}? This cannot be undone.`, async () => {
          const r = await api.post('/api/leads/bulk', { action: 'delete', ids });
          ok(`Deleted ${r.deleted}`);
          selected.clear();
          reload(root, ctx);
        });
      }
      if (action === 'sequence') {
        const { sequences } = await api.get('/api/sequences');
        if (!sequences.length) return err('Build a sequence first, over on Automations.');
        return modal((card, close) => {
          card.innerHTML = h`
            <div class="modal-head"><h2>Start a sequence</h2></div>
            <p class="muted" style="margin-top:0">${ids.length} lead${ids.length === 1 ? '' : 's'}.
            Anyone marked do-not-call is skipped, and each sequence stops itself the moment they reply.</p>
            <label class="field"><span>Which one</span><select id="seqPick">
              ${raw(sequences.map((s) => h`<option value="${s.id}">${s.name} (${s.steps.length} steps)</option>`).join(''))}
            </select></label>
            <div class="modal-foot">
              <button class="btn" data-cancel>Cancel</button>
              <button class="btn primary" data-go>Start it</button>
            </div>`;
          card.querySelector('[data-cancel]').onclick = close;
          card.querySelector('[data-go]').onclick = guard(async () => {
            const seqId = card.querySelector('#seqPick').value;
            const r = await api.post(`/api/sequences/${seqId}/enroll`, { lead_ids: ids });
            ok(`${r.enrolled} started${r.skipped ? `, ${r.skipped} skipped` : ''}`);
            close();
            selected.clear();
            reload(root, ctx);
          });
        });
      }
      if (action === 'tag') {
        const tag = prompt('Tag to add:');
        if (!tag) return;
        const r = await api.post('/api/leads/bulk', { action: 'tag', ids, tag });
        ok(`Tagged ${r.updated}`);
        return reload(root, ctx);
      }
      const r = await api.post('/api/leads/bulk', { action, ids });
      ok(`Updated ${r.updated}`);
      selected.clear();
      reload(root, ctx);
    });
  });

  root.querySelector('#bulkStatus')?.addEventListener('change', guard(async (e) => {
    if (!e.target.value) return;
    const r = await api.post('/api/leads/bulk', { action: 'status', ids: [...selected], status: e.target.value });
    ok(`Moved ${r.updated} to ${titleCase(e.target.value)}`);
    selected.clear();
    reload(root, ctx);
  }));
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

function scrapeModal(onDone) {
  modal((card, close) => {
    card.innerHTML = h`
      <div class="modal-head"><h2>Scrape leads from Google Maps</h2></div>
      <p class="muted" style="margin-top:0">Search the way you'd search Maps. Each page is 20 businesses, with the phone number and website included. Run the same trade across a few cities to build real volume.</p>
      <form id="scrapeForm">
        <label class="field"><span>Search</span>
          <input name="query" placeholder="roofers in Tampa FL" required autofocus></label>
        <div class="inline">
          <label class="field"><span>Pages</span>
            <select name="pages">
              <option value="1">1 (20 leads)</option>
              <option value="2">2 (40)</option>
              <option value="3" selected>3 (60)</option>
              <option value="5">5 (100)</option>
              <option value="10">10 (200)</option>
            </select></label>
          <label class="field"><span>Minimum rating</span>
            <input type="number" name="min_rating" step="0.1" min="0" max="5" placeholder="4.0"></label>
          <label class="field"><span>Max reviews</span>
            <input type="number" name="max_reviews" min="0" placeholder="no limit"></label>
        </div>
        <div class="hint">Duplicates are skipped automatically. One API call per page of 20, so a 3-page scrape costs 3 calls.</div>
        <div class="modal-foot">
          <button type="button" class="btn" data-cancel>Cancel</button>
          <button type="button" class="btn" id="agentBtn">Hand to Lead Scout</button>
          <button type="submit" class="btn primary" id="goBtn">Scrape now</button>
        </div>
      </form>`;

    card.querySelector('[data-cancel]').onclick = close;

    card.querySelector('#agentBtn').onclick = guard(async () => {
      const v = formData(card.querySelector('#scrapeForm'));
      if (!v.query) return err('Give it a search first');
      await api.post('/api/leads/scout', { query: v.query, pages: v.pages });
      ok('Lead Scout is on it. Watch the Agents tab.');
      close();
    });

    card.querySelector('#scrapeForm').onsubmit = guard(async (e) => {
      e.preventDefault();
      const btn = card.querySelector('#goBtn');
      btn.disabled = true;
      btn.textContent = 'Scraping…';
      try {
        const v = formData(card.querySelector('#scrapeForm'));
        const r = await api.post('/api/leads/scrape', v);
        ok(`Added ${r.inserted} new leads (${r.duplicates} already had)`);
        close();
        onDone();
      } finally {
        btn.disabled = false;
        btn.textContent = 'Scrape now';
      }
    });
  });
}

function importModal(onDone) {
  modal((card, close) => {
    card.innerHTML = h`
      <div class="modal-head"><h2>Import leads from CSV</h2></div>
      <p class="muted" style="margin-top:0">Paste it in. First row is the header. Recognized columns: name, phone, email, website, address, city, state, category, rating, review_count.</p>
      <textarea id="csvBox" class="tall" placeholder="name,phone,city,website
Northside Roofing,512-555-0142,Austin,
Cedar Park Plumbing,512-555-0198,Cedar Park,"></textarea>
      <div class="modal-foot">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn primary" id="importGo">Import</button>
      </div>`;
    card.querySelector('[data-cancel]').onclick = close;
    card.querySelector('#importGo').onclick = guard(async () => {
      const csv = card.querySelector('#csvBox').value;
      if (!csv.trim()) return err('Nothing to import');
      const r = await api.post('/api/leads/import', { csv });
      ok(`Imported ${r.inserted} of ${r.rows} rows`);
      close();
      onDone();
    });
  });
}

export function leadModal(id, onDone) {
  modal(async (card, close) => {
    card.className = 'modal-card wide';
    card.innerHTML = '<div class="loading">Loading…</div>';
    const { lead, calls, bookings, emails, activity } = await api.get(`/api/leads/${id}`);
    const statuses = ['new', 'queued', 'contacted', 'callback', 'booked', 'won', 'lost', 'dnc'];

    card.innerHTML = h`
      <div class="modal-head">
        <h2>${lead.name}</h2>
        ${raw(scorePill(lead.score))}
        <button class="icon-btn" data-close>×</button>
      </div>
      <div class="grid cols-2">
        <div>
          <form id="leadForm">
            <div class="inline"><label class="field"><span>Status</span>
              <select name="status">${raw(statuses.map((s) => h`<option value="${s}" ${raw(lead.status === s ? 'selected' : '')}>${titleCase(s)}</option>`).join(''))}</select></label>
              <label class="field"><span>Next action</span>
                <input type="datetime-local" name="next_action_at" value="${(lead.next_action_at || '').replace(' ', 'T').slice(0, 16)}"></label>
            </div>
            <div class="inline"><label class="field"><span>Phone</span><input name="phone" value="${lead.phone || ''}"></label>
              <label class="field"><span>Email</span><input name="email" value="${lead.email || ''}"></label></div>
            <label class="field"><span>Website</span><input name="website" value="${lead.website || ''}"></label>
            <div class="inline"><label class="field"><span>City</span><input name="city" value="${lead.city || ''}"></label>
              <label class="field"><span>Deal value ($)</span><input type="number" name="pipeline_dollars" value="${(lead.pipeline_value / 100) || ''}"></label></div>
            <label class="field"><span>Tags</span><input name="tags" value="${lead.tags || ''}" placeholder="hot, roofing, austin"></label>
            <label class="field"><span>Notes</span><textarea name="notes" style="min-height:110px">${lead.notes || ''}</textarea></label>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button type="submit" class="btn primary">Save</button>
              ${raw(lead.phone ? h`<a class="btn" href="tel:${lead.phone}">Call</a>` : '')}
              <button type="button" class="btn" id="dialerBtn">Open in dialer</button>
              <button type="button" class="btn danger" id="delBtn">Delete</button>
            </div>
          </form>
        </div>
        <div>
          <h3>Details</h3>
          <div class="list" style="margin-bottom:16px">
            <div class="list-item"><div class="grow"><div class="s">Address</div><div class="t" style="font-size:13px">${lead.address || '—'}</div></div></div>
            <div class="list-item"><div class="grow"><div class="s">Rating</div><div class="t" style="font-size:13px">${lead.rating ? `${lead.rating}★ from ${lead.review_count} reviews` : '—'}</div></div></div>
            <div class="list-item"><div class="grow"><div class="s">Source</div><div class="t" style="font-size:13px">${titleCase(lead.source)}${lead.search_query ? ` · ${lead.search_query}` : ''}</div></div></div>
            <div class="list-item"><div class="grow"><div class="s">Attempts</div><div class="t" style="font-size:13px">${lead.attempts} · last ${lead.last_contacted_at ? ago(lead.last_contacted_at) : 'never'}</div></div></div>
          </div>
          <h3>History</h3>
          <div class="list" style="max-height:280px;overflow-y:auto">
            ${raw(historyList(calls, bookings, emails, activity))}
          </div>
        </div>
      </div>`;

    card.querySelector('[data-close]').onclick = close;
    card.querySelector('#dialerBtn').onclick = () => { close(); location.hash = `#/dialer/${lead.id}`; };
    card.querySelector('#delBtn').onclick = () =>
      confirmDialog(`Delete ${lead.name}?`, async () => { await api.del(`/api/leads/${lead.id}`); ok('Deleted'); close(); onDone(); });

    card.querySelector('#leadForm').onsubmit = guard(async (e) => {
      e.preventDefault();
      const v = formData(e.target);
      await api.patch(`/api/leads/${lead.id}`, {
        status: v.status, phone: v.phone, email: v.email, website: v.website,
        city: v.city, tags: v.tags, notes: v.notes,
        next_action_at: v.next_action_at ? v.next_action_at.replace('T', ' ') + ':00' : null,
        pipeline_value: Math.round((Number(v.pipeline_dollars) || 0) * 100),
      });
      ok('Saved');
      close();
      onDone();
    });
  });
}

function historyList(calls, bookings, emails, activity) {
  const items = [
    ...calls.map((c) => ({ at: c.started_at, t: `Call — ${titleCase(c.outcome)}`, s: c.notes || '' })),
    ...bookings.map((b) => ({ at: b.created_at, t: `Booked ${b.title}`, s: fmtDate(b.starts_at) })),
    ...emails.map((e) => ({ at: e.created_at, t: `Email — ${e.subject}`, s: e.status })),
    ...activity.map((a) => ({ at: a.created_at, t: titleCase(a.kind), s: a.summary })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 40);

  if (!items.length) return '<div class="dim" style="padding:8px 2px">Nothing yet.</div>';
  return items.map((i) => h`<div class="list-item">
    <div class="grow"><div class="t" style="font-size:13px">${i.t}</div><div class="s">${i.s}</div></div>
    <div class="s nowrap">${ago(i.at)}</div>
  </div>`).join('');
}
