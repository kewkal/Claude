import {
  api, h, raw, esc, stat, pill, scorePill, guard, ok, err, modal, confirmDialog,
  fmtDate, ago, formData, emptyState, debounce, titleCase,
} from '../ui.js';

const filters = {
  q: '', status: 'all', city: '', has_website: '', min_score: '', sort: 'score',
  runs_ads: '', no_tracking: '', site_broken: '', not_mobile: '', unscanned: '', platform: '',
  is_chain: '', has_owner: '', has_owner_email: '',
  no_chat: '', no_email_tool: '', no_booking: '', busy: '', leaking: '',
  page: 1, limit: 50,
};
let selected = new Set();

export default {
  async render(root, ctx) {
    ctx.setActions(h`
      <button class="btn" id="scanBtn">Check websites</button>
      <button class="btn" id="importBtn">Import CSV</button>
      <button class="btn" id="exportBtn">Export</button>
      <button class="btn" id="bulkBtn">Bulk search</button>
      <button class="btn primary" id="scrapeBtn">Scrape leads</button>
    `);
    document.getElementById('scrapeBtn').onclick = () => scrapeModal(() => reload(root, ctx));
    document.getElementById('importBtn').onclick = () => importModal(() => reload(root, ctx));
    document.getElementById('scanBtn').onclick = () => scanModal(() => reload(root, ctx));
    document.getElementById('bulkBtn').onclick = () => bulkScrapeModal(() => reload(root, ctx));
    document.getElementById('exportBtn').onclick = () => exportModal();
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

    ${raw(!stats.tech.scanned && stats.tech.unscanned ? h`<div class="card" style="border-color:var(--accent);margin-bottom:14px">
      <div class="bar" style="margin:0">
        <div>
          <h2 style="margin:0">See who is already spending money</h2>
          <p class="sub" style="margin:4px 0 0">${stats.tech.unscanned.toLocaleString()} of your leads have a website
          and nobody has looked at it yet. Checking them shows who runs Meta or Google ads (proven budget),
          who tracks nothing, whose site is broken, and whose does not work on a phone.
          It is free — ordinary page visits, not API calls.</p>
        </div>
        <button class="btn primary" id="scanPrompt">Check their websites</button>
      </div>
    </div>` : '')}

    ${raw(stats.tech.scanned ? h`<div class="grid cols-5" style="margin-bottom:14px">
      ${raw(stat('Running ads', stats.tech.runs_ads.toLocaleString(), 'proven budget', stats.tech.runs_ads ? 'ok' : ''))}
      ${raw(stat('Meta Pixel', stats.tech.meta_pixel.toLocaleString(), 'on their site'))}
      ${raw(stat('Google tag', stats.tech.google_tag.toLocaleString(), 'GTM or GA4'))}
      ${raw(stat('Tracking nothing', stats.tech.no_tracking.toLocaleString(), 'live site, zero tags', 'accent'))}
      ${raw(stat('Site broken', stats.tech.broken.toLocaleString(), 'down or missing', stats.tech.broken ? 'warn' : ''))}
    </div>` : '')}

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

    <div class="chips" style="margin-bottom:14px">
      <span class="dim" style="align-self:center;font-size:12.5px;margin-right:4px">Leaking money:</span>
      <button class="chip ${raw(filters.leaking === '1' ? 'active' : '')}" data-tech="leaking">Worst leaks (${stats.tech.leaking})</button>
      <button class="chip ${raw(filters.busy === '1' ? 'active' : '')}" data-tech="busy">Busy enough to matter (${stats.tech.busy})</button>
      <button class="chip ${raw(filters.no_chat === '1' ? 'active' : '')}" data-tech="no_chat">Nothing catches a missed call (${stats.tech.no_chat})</button>
      <button class="chip ${raw(filters.no_email_tool === '1' ? 'active' : '')}" data-tech="no_email_tool">Dead database (${stats.tech.no_email_tool})</button>
      <button class="chip ${raw(filters.no_booking === '1' ? 'active' : '')}" data-tech="no_booking">No online booking (${stats.tech.no_booking})</button>
    </div>

    ${raw(stats.tech.scanned ? h`<div class="chips" style="margin-bottom:14px">
      <span class="dim" style="align-self:center;font-size:12.5px;margin-right:4px">Tech:</span>
      <button class="chip ${raw(filters.runs_ads === '1' ? 'active' : '')}" data-tech="runs_ads">Running ads (${stats.tech.runs_ads})</button>
      <button class="chip ${raw(filters.no_tracking === '1' ? 'active' : '')}" data-tech="no_tracking">Tracking nothing (${stats.tech.no_tracking})</button>
      <button class="chip ${raw(filters.site_broken === '1' ? 'active' : '')}" data-tech="site_broken">Site broken (${stats.tech.broken})</button>
      <button class="chip ${raw(filters.not_mobile === '1' ? 'active' : '')}" data-tech="not_mobile">Not mobile (${stats.tech.not_mobile})</button>
      ${raw(stats.tech.unscanned ? h`<button class="chip ${raw(filters.unscanned === '1' ? 'active' : '')}" data-tech="unscanned">Not checked yet (${stats.tech.unscanned})</button>` : '')}
      ${raw(stats.platforms.map((p) => h`<button class="chip ${raw(filters.platform === p.platform ? 'active' : '')}" data-platform="${p.platform}">${titleCase(p.platform)} (${p.n})</button>`).join(''))}
    </div>` : '')}

    <div class="chips" style="margin-bottom:14px">
      <span class="dim" style="align-self:center;font-size:12.5px;margin-right:4px">Website:</span>
      <button class="chip ${raw(filters.has_website === '0' ? 'active' : '')}" data-web="0">No website (${stats.no_website})</button>
      <button class="chip ${raw(filters.has_website === '1' ? 'active' : '')}" data-web="1">Has a website (${stats.total - stats.no_website})</button>
      <span class="dim" style="align-self:center;font-size:12.5px;margin:0 4px 0 10px">Chains:</span>
      <button class="chip ${raw(filters.is_chain === '1' ? 'active' : '')}" data-tech="is_chain">Show only chains (${stats.tech.chains})</button>
      <button class="chip" id="sweepChains">Find chains in my list</button>
      ${raw(stats.tech.chains ? h`<button class="chip" id="removeChains" style="color:var(--err);border-color:var(--err)">Remove them</button>` : '')}
      <span class="dim" style="align-self:center;font-size:12.5px;margin:0 4px 0 10px">Owners:</span>
      <button class="chip ${raw(filters.has_owner === '1' ? 'active' : '')}" data-tech="has_owner">Have a name (${stats.tech.owners})</button>
      <button class="chip ${raw(filters.has_owner_email === '1' ? 'active' : '')}" data-tech="has_owner_email">Have their email (${stats.tech.owner_emails})</button>
      <button class="chip" id="findOwners">Find owner names</button>
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
        <button class="btn sm" data-bulk="scan">Check their websites</button>
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
      <th>Ask for</th><th class="num">Reviews</th><th>Tech</th><th class="num">Score</th><th>Status</th><th></th>
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
    <td class="nowrap">${raw(l.owner_name || l.owner_email
      ? h`<span style="font-weight:620">${l.owner_name ? l.owner_name.split(' ')[0] : '—'}</span>
          ${raw(l.owner_email
            ? h`<div class="sub" style="color:var(--ok)" title="${l.owner_email_kind} · ${l.owner_email_confidence}% confident">${l.owner_email}</div>`
            : h`<div class="sub" title="${l.owner_source || ''}">${l.owner_role || ''}</div>`)}`
      : '<span class="dim">—</span>')}</td>
    <td class="num">${l.review_count ?? '—'}</td>
    <td class="nowrap">${raw(techBadges(l))}</td>
    <td class="num">${raw(scorePill(l.score))}</td>
    <td>${raw(pill(l.status))}</td>
    <td class="right nowrap"><button class="btn sm" data-open>Open</button></td>
  </tr>`;
}

/** Catch-alls, listed but clearly marked as not the owner. */
function otherEmails(lead) {
  let all = [];
  try { all = JSON.parse(lead.emails_json || '[]'); } catch { return ''; }
  const rest = all.filter((e) => e.email !== lead.owner_email);
  if (!rest.length) return '';
  return h`<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line)">
    <div class="s dim" style="margin-bottom:5px">Also on the site — shared inboxes, not a person:</div>
    ${raw(rest.slice(0, 6).map((e) => h`<div class="s" style="font-family:ui-monospace,monospace">
      ${e.email} <span class="dim">· ${e.kind}</span></div>`).join(''))}
  </div>`;
}

/** What is leaking, in the order the scorer ranked it. */
function recoveryPanel(lead) {
  let reasons = [];
  try { reasons = JSON.parse(lead.recovery_reasons || '[]'); } catch { return ''; }
  if (!reasons.length) return '';
  return h`<div class="card" style="border-color:var(--warn);margin-bottom:14px">
    <div class="bar" style="margin:0 0 8px">
      <div class="s" style="color:var(--warn);font-weight:650">WHAT THEY ARE LEAKING</div>
      <span class="pill score ${raw((lead.recovery_score || 0) >= 70 ? 'hot' : 'warm')}">${lead.recovery_score || 0}</span>
    </div>
    ${raw(reasons.map((r) => h`<div style="font-size:13px;margin-bottom:5px">· ${r}</div>`).join(''))}
    ${raw(lead.recovery_chat || lead.recovery_booking || lead.recovery_email_tool ? h`
      <div class="s dim" style="margin-top:9px;padding-top:9px;border-top:1px solid var(--line)">
        Already using: ${[lead.recovery_chat, lead.recovery_booking, lead.recovery_email_tool,
                          lead.recovery_review_tool].filter(Boolean).join(', ')}
      </div>` : '')}
  </div>`;
}

function techBadges(l) {
  const out = [];
  if (l.is_chain) out.push(`<span class="pill lost" title="${esc(l.chain_reason || 'chain')}">chain</span>`);
  if (!l.site_status) return out.length ? out.join(' ') : '<span class="dim" style="font-size:11.5px">—</span>';
  if (['unreachable', 'timeout', 'server_error', 'not_found'].includes(l.site_status)) {
    out.push('<span class="pill lost" title="Their website is down">site down</span>');
    return out.join(' ');
  }
  if (l.runs_ads) out.push('<span class="pill won" title="Running paid ads — budget exists">ads</span>');
  if (l.has_meta_pixel) out.push('<span class="pill" style="color:#4267B2;border-color:#4267B2" title="Meta Pixel installed">meta</span>');
  if (l.has_google_tag || l.has_analytics) out.push('<span class="pill" style="color:#EA4335;border-color:#EA4335" title="Google Tag Manager or GA4">google</span>');
  if (!l.has_meta_pixel && !l.has_google_tag && !l.has_analytics && !l.has_google_ads) {
    out.push('<span class="pill new" title="Live site with no tracking at all">no tags</span>');
  }
  if (!l.recovery_chat && (l.site_status === 'ok' || !l.website)) {
    out.push('<span class="pill new" title="Nothing catches a missed call">no call catch</span>');
  }
  if (!l.recovery_email_tool && l.site_status === 'ok') {
    out.push('<span class="pill callback" title="No email marketing — the customer list is dead">dead list</span>');
  }
  if (l.recovery_chat) {
    out.push(`<span class="pill" title="Already running ${esc(l.recovery_chat)}">${esc(l.recovery_chat)}</span>`);
  }
  if (l.mobile_ready === 0) {
    out.push('<span class="pill callback" title="Their site does not fit a phone screen">not mobile</span>');
  }
  if (l.has_ssl === 0 && l.site_status === 'ok') {
    out.push('<span class="pill lost" title="No security certificate — Chrome shows &quot;Not secure&quot;">not secure</span>');
  }
  if (l.site_platform) out.push(`<span class="pill" title="Built on ${l.site_platform}">${l.site_platform}</span>`);
  return out.join(' ');
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
    Object.assign(filters, {
      q: '', status: 'all', city: '', has_website: '', min_score: '', sort: 'score',
      runs_ads: '', no_tracking: '', site_broken: '', not_mobile: '', unscanned: '', platform: '', page: 1,
    });
    reload(root, ctx);
  };

  root.querySelectorAll('[data-tech]').forEach((b) => {
    b.onclick = () => {
      const key = b.dataset.tech;
      filters[key] = filters[key] === '1' ? '' : '1';
      apply();
    };
  });
  root.querySelector('#scanPrompt')?.addEventListener('click', () => scanModal(() => reload(root, ctx)));

  root.querySelectorAll('[data-web]').forEach((b) => {
    b.onclick = () => {
      filters.has_website = filters.has_website === b.dataset.web ? '' : b.dataset.web;
      apply();
    };
  });

  root.querySelector('#findOwners')?.addEventListener('click', guard(async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Looking…';
    const r = await api.post('/api/leads/find-owners', {});
    ok(`Found ${r.found} names from business names and emails. ${r.total_with_owner} leads now have one. ` +
       `Check websites finds many more.`);
    reload(root, ctx);
  }));

  root.querySelector('#removeChains')?.addEventListener('click', guard(async () => {
    const p = await api.get('/api/leads/chains/preview');
    if (!p.removable) {
      return err(p.keeping
        ? `All ${p.keeping} chains have call history or a booking, so none can be removed safely.`
        : 'No chains to remove.');
    }
    modal((card, close) => {
      card.className = 'modal-card wide';
      card.innerHTML = h`
        <div class="modal-head"><h2>Remove ${p.removable} chains?</h2></div>
        <p class="muted" style="margin-top:0">These are franchises and multi-location chains. Corporate owns the
        website and whoever answers cannot buy anything, so they are dead calls.</p>
        <div class="table-wrap" style="max-height:210px;overflow-y:auto;margin-bottom:12px"><table>
          <thead><tr><th>Business</th><th>Why</th></tr></thead>
          <tbody>${raw(p.sample.map((l) => h`<tr><td>${l.name}</td><td class="dim">${l.reason}</td></tr>`).join(''))}
          ${raw(p.removable > p.sample.length
            ? h`<tr><td colspan="2" class="dim">…and ${p.removable - p.sample.length} more</td></tr>` : '')}</tbody>
        </table></div>
        ${raw(p.keeping ? h`<div class="card" style="border-color:var(--ok);margin-bottom:12px">
          <div class="s" style="color:var(--ok);font-weight:650;margin-bottom:4px">KEEPING ${p.keeping}</div>
          <div class="muted" style="font-size:13px">You have already called, booked or written notes on these,
          so they stay whatever the detector thinks: ${p.kept_sample.map((l) => l.name).join(', ')}</div>
        </div>` : '')}
        <div class="hint">This cannot be undone. Scraping them again is one search if you change your mind.</div>
        <div class="modal-foot">
          <button class="btn" data-cancel>Cancel</button>
          <button class="btn danger" data-go>Remove ${p.removable}</button>
        </div>`;
      card.querySelector('[data-cancel]').onclick = close;
      card.querySelector('[data-go]').onclick = guard(async (e) => {
        e.target.disabled = true;
        e.target.textContent = 'Removing…';
        const r = await api.post('/api/leads/sweep-chains', { remove: true });
        ok(`Removed ${r.removed} chains${r.kept_because_worked ? `, kept ${r.kept_because_worked} you had worked` : ''}.`);
        close();
        reload(root, ctx);
      });
    });
  }));

  root.querySelector('#sweepChains')?.addEventListener('click', guard(async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Checking…';
    const r = await api.post('/api/leads/sweep-chains', { remove: false });
    ok(`Found ${r.total_chains} chains — ${r.known_brands} known brands, ${r.multi_location} in several places.`);
    reload(root, ctx);
  }));

  root.querySelectorAll('[data-platform]').forEach((b) => {
    b.onclick = () => {
      filters.platform = filters.platform === b.dataset.platform ? '' : b.dataset.platform;
      apply();
    };
  });

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
      if (action === 'scan') {
        ok(`Checking ${ids.length} websites…`);
        const r = await api.post('/api/leads/scan', { ids });
        ok(`Checked ${r.scanned}: ${r.runs_ads} running ads, ${r.no_tracking} tracking nothing, ${r.broken} broken.`);
        selected.clear();
        return reload(root, ctx);
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
  modal(async (card, close) => {
    // Failing after someone has typed a search is a waste of their time.
    const { settings } = await api.get('/api/settings');
    if (!settings._configured.google_maps) {
      card.innerHTML = h`
        <div class="modal-head"><h2>Connect Google Maps first</h2></div>
        <p class="muted" style="margin-top:0">Scraping leads needs a Google Maps API key. It is free for
        thousands of lookups a month, and it is the only thing this needs to start working.</p>
        <div class="list" style="margin-bottom:16px">
          <div class="list-item"><span class="pill">1</span><div class="grow"><div class="t">Get a key</div>
            <div class="s">Google Cloud Console, enable "Places API (New)", create an API key.</div></div></div>
          <div class="list-item"><span class="pill">2</span><div class="grow"><div class="t">Paste it into Settings</div>
            <div class="s">Under "Google Maps API", then press Save settings.</div></div></div>
          <div class="list-item"><span class="pill">3</span><div class="grow"><div class="t">Press Test</div>
            <div class="s">You want "Search and details both working".</div></div></div>
        </div>
        <div class="modal-foot">
          <button class="btn" data-cancel>Not now</button>
          <a class="btn primary" href="#/settings" id="toSettings">Open Settings</a>
        </div>`;
      card.querySelector('[data-cancel]').onclick = close;
      card.querySelector('#toSettings').onclick = close;
      return;
    }

    card.innerHTML = h`
      <div class="modal-head"><h2>Scrape leads from Google Maps</h2></div>
      <p class="muted" style="margin-top:0">Search the way you'd search Maps.
      <b>Google caps every search at 60 results</b>, so one query is worth 60 and no more.
      For real volume use <a href="#" id="switchBulk">bulk search</a> — it runs a trade across many places at once.</p>
      <form id="scrapeForm">
        <label class="field"><span>Search</span>
          <input name="query" placeholder="roofers in Tampa FL" required autofocus></label>
        <div class="inline">
          <label class="field"><span>Depth</span>
            <select name="pages">
              <option value="1">20 leads</option>
              <option value="2">40 leads</option>
              <option value="3" selected>60 — everything Google gives</option>
            </select></label>
          <label class="field"><span>Minimum rating</span>
            <input type="number" name="min_rating" step="0.1" min="0" max="5" placeholder="4.0"></label>
          <label class="field"><span>Max reviews</span>
            <input type="number" name="max_reviews" min="0" placeholder="no limit"></label>
        </div>
        <label class="field" style="margin-top:4px">
          <input type="checkbox" name="exclude_chains" checked> Leave out franchises and chains
        </label>
        <div class="hint">Chains are dead calls — corporate owns the website and whoever answers cannot buy anything.
        Catches known brands, the same name across cities, and several listings behind one domain.</div>
        <div class="hint" style="margin-top:6px">Duplicates are skipped automatically. One API call per page of 20, so a 3-page scrape costs 3 calls.</div>
        <div class="modal-foot">
          <button type="button" class="btn" data-cancel>Cancel</button>
          <button type="button" class="btn" id="agentBtn">Hand to Lead Scout</button>
          <button type="submit" class="btn primary" id="goBtn">Scrape now</button>
        </div>
      </form>`;

    card.querySelector('[data-cancel]').onclick = close;
    card.querySelector('#switchBulk').onclick = (e) => { e.preventDefault(); close(); bulkScrapeModal(onDone); };

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
        const bits = [`Added ${r.inserted} new leads`];
        if (r.duplicates) bits.push(`${r.duplicates} already had`);
        if (r.chains_skipped) bits.push(`${r.chains_skipped} chains left out`);
        ok(bits.join(', '));
        close();
        onDone();
      } finally {
        btn.disabled = false;
        btn.textContent = 'Scrape now';
      }
    });
  });
}

/** Query string for whatever is currently filtered on screen. */
function currentFilterQuery() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (k === 'page' || k === 'limit') continue;
    if (v === '' || v == null || v === 'all') continue;
    p.set(k, v);
  }
  return p;
}

function exportModal() {
  modal(async (card, close) => {
    const params = currentFilterQuery();
    const info = await api.get('/api/leads/export/shapes', Object.fromEntries(params));
    const filtered = info.matching !== info.total;

    card.innerHTML = h`
      <div class="modal-head"><h2>Export leads</h2><button class="icon-btn" data-close>×</button></div>
      <p class="muted" style="margin-top:0">
        ${raw(filtered
          ? h`Exports the <b>${info.matching.toLocaleString()}</b> leads matching your current filters,
             not all ${info.total.toLocaleString()}.`
          : h`Exports all <b>${info.total.toLocaleString()}</b> leads. Filter the list first if you want a subset.`)}
      </p>
      ${raw(filtered ? h`<div class="hint" style="margin:-8px 0 14px">
        Filtered by: ${[...params.entries()].map(([k, v]) => `${k.replace(/_/g, ' ')}=${v}`).join(', ')}
      </div>` : '')}
      <div class="list">
        ${raw(info.shapes.map((s) => h`<div class="list-item" data-shape="${s.id}" style="cursor:pointer">
          <div class="grow">
            <div class="t">${s.label}</div>
            <div class="s">${s.hint} · ${s.columns} columns</div>
          </div>
          <span class="btn sm">Download</span>
        </div>`).join(''))}
      </div>
      <div class="hint" style="margin-top:12px">Opens in Excel, Google Sheets and Numbers.</div>
      <div class="modal-foot"><button class="btn" data-cancel>Close</button></div>`;

    card.querySelector('[data-close]').onclick = close;
    card.querySelector('[data-cancel]').onclick = close;
    card.querySelectorAll('[data-shape]').forEach((row) => {
      row.onclick = () => {
        const q = currentFilterQuery();
        q.set('shape', row.dataset.shape);
        // A plain link download, so the browser handles the file itself.
        const a = document.createElement('a');
        a.href = `/api/leads/export.csv?${q}`;
        a.download = '';
        document.body.appendChild(a);
        a.click();
        a.remove();
        ok(`Downloading ${info.matching.toLocaleString()} leads`);
        close();
      };
    });
  });
}

function bulkScrapeModal(onDone) {
  modal(async (card, close) => {
    const { settings } = await api.get('/api/settings');
    if (!settings._configured.google_maps) {
      card.innerHTML = h`
        <div class="modal-head"><h2>Connect Google Maps first</h2></div>
        <p class="muted" style="margin-top:0">Bulk search needs a Google Maps API key. Paste one into
        Settings under "Google Maps API", press Save settings, then Test.</p>
        <div class="modal-foot">
          <button class="btn" data-cancel>Not now</button>
          <a class="btn primary" href="#/settings" id="toSettings">Open Settings</a>
        </div>`;
      card.querySelector('[data-cancel]').onclick = close;
      card.querySelector('#toSettings').onclick = close;
      return;
    }
    card.className = 'modal-card wide';
    card.innerHTML = h`
      <div class="modal-head"><h2>Bulk search</h2><button class="icon-btn" data-close>×</button></div>
      <p class="muted" style="margin-top:0">Google gives 60 results per search and no more, however many pages you ask for.
      So volume comes from <b>more searches</b>, not deeper ones. This runs every trade against every place —
      each combination is its own search worth up to 60.</p>
      <div class="grid cols-2">
        <label class="field"><span>Trades — one per line</span>
          <textarea id="bulkTrades" style="min-height:150px" placeholder="roofers
plumbers
HVAC contractors
electricians
landscapers"></textarea></label>
        <label class="field"><span>Places — one per line</span>
          <textarea id="bulkPlaces" style="min-height:150px" placeholder="Tampa FL
Brandon FL
Clearwater FL
St Petersburg FL
Lakeland FL"></textarea></label>
      </div>
      <div class="inline">
        <label class="field"><span>Depth per search</span>
          <select id="bulkPages"><option value="1">20</option><option value="2">40</option><option value="3" selected>60</option></select></label>
        <label class="field"><span>Minimum rating</span><input type="number" id="bulkRating" step="0.1" min="0" max="5" placeholder="4.0"></label>
        <label class="field" style="flex:0 0 auto;align-self:center">
          <input type="checkbox" id="bulkChains" checked> Leave out chains</label>
      </div>
      <div class="card" style="background:var(--panel-2);margin:6px 0 0">
        <div id="bulkMath" class="muted">Add some trades and places and it will tell you what that costs.</div>
      </div>
      <div id="bulkResult" hidden style="margin-top:12px"></div>
      <div class="modal-foot">
        <button type="button" class="btn" data-cancel>Cancel</button>
        <button type="button" class="btn primary" id="bulkGo">Run the searches</button>
      </div>`;

    const trades = card.querySelector('#bulkTrades');
    const places = card.querySelector('#bulkPlaces');
    const math = card.querySelector('#bulkMath');
    const lines = (el) => el.value.split(/[\n,;]+/).map((t) => t.trim()).filter(Boolean);

    const recount = () => {
      const t = lines(trades).length;
      const p = lines(places).length;
      const n = t * p;
      if (!n) { math.textContent = 'Add some trades and places and it will tell you what that costs.'; return; }
      const pages = Number(card.querySelector('#bulkPages').value);
      math.innerHTML = `<b>${t} trades × ${p} places = ${n} searches</b><br>` +
        `Up to ${(n * pages * 20).toLocaleString()} businesses, costing ${n * pages} API calls. ` +
        `Roughly ${Math.ceil(n * pages * 1.2)} seconds.` +
        (n > 60 ? '<br><b style="color:var(--err)">Over the 60-search limit. Trim the list.</b>' : '');
    };
    [trades, places].forEach((el) => el.addEventListener('input', recount));
    card.querySelector('#bulkPages').addEventListener('change', recount);

    card.querySelector('[data-close]').onclick = close;
    card.querySelector('[data-cancel]').onclick = close;

    card.querySelector('#bulkGo').onclick = guard(async (e) => {
      const t = lines(trades);
      const p = lines(places);
      if (!t.length) return err('Add at least one trade');
      if (!p.length) return err('Add at least one place');
      if (t.length * p.length > 60) return err('Over 60 searches — trim the list');

      e.target.disabled = true;
      e.target.textContent = `Running ${t.length * p.length} searches…`;
      const box = card.querySelector('#bulkResult');
      box.hidden = false;
      box.innerHTML = '<div class="loading">Working through them. This does not stop if you close the window.</div>';
      try {
        const r = await api.post('/api/leads/bulk-scrape', {
          trades: trades.value, locations: places.value,
          pages: Number(card.querySelector('#bulkPages').value),
          min_rating: card.querySelector('#bulkRating').value || undefined,
          exclude_chains: card.querySelector('#bulkChains').checked,
        });
        box.innerHTML = h`
          <div class="grid cols-4" style="margin-bottom:10px">
            ${raw(stat('Added', r.inserted.toLocaleString(), 'new leads', 'ok'))}
            ${raw(stat('Found', r.found.toLocaleString(), `across ${r.queries} searches`))}
            ${raw(stat('Already had', r.duplicates.toLocaleString(), 'skipped'))}
            ${raw(stat('Chains', r.chains_skipped.toLocaleString(), 'left out'))}
          </div>
          <div class="table-wrap" style="max-height:220px;overflow-y:auto"><table>
            <thead><tr><th>Search</th><th class="num">Found</th><th class="num">Added</th></tr></thead>
            <tbody>${raw(r.per_query.map((q) => h`<tr><td>${q.query}</td>
              <td class="num">${q.found}</td><td class="num">${q.inserted}</td></tr>`).join(''))}</tbody>
          </table></div>
          ${raw(r.errors.length ? h`<div class="hint" style="color:var(--err);margin-top:8px">
            ${r.errors.length} search(es) failed: ${r.errors[0].error}</div>` : '')}`;
        ok(`Added ${r.inserted} new leads from ${r.queries} searches`);
        onDone();
      } finally {
        e.target.disabled = false;
        e.target.textContent = 'Run the searches';
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

function scanModal(onDone) {
  modal((card, close) => {
    card.innerHTML = h`
      <div class="modal-head"><h2>Check their websites</h2></div>
      <p class="muted" style="margin-top:0">Opens each lead's site and looks at what is running on it: Meta Pixel,
      Google Tag Manager, GA4, Google Ads, what it was built with, and whether it works on a phone.</p>
      <p class="muted">A business already paying for ads has a proven budget. One with a live site and no tracking
      at all cannot tell you what it earns. Both are far easier calls than a cold open.</p>
      <label class="field"><span>How many to check</span>
        <select name="limit">
          <option value="25" selected>25 (about 30 seconds)</option>
          <option value="50">50</option>
          <option value="100">100</option>
          <option value="200">200 (a few minutes)</option>
        </select></label>
      <div class="hint">Works through the highest-scoring leads that have a website and have not been checked yet.
      Five at a time, so nobody's host sees it as an attack. Costs nothing — these are ordinary page visits, not API calls.</div>
      <div class="modal-foot">
        <button type="button" class="btn" data-cancel>Cancel</button>
        <button type="button" class="btn primary" id="scanGo">Start checking</button>
      </div>`;
    card.querySelector('[data-cancel]').onclick = close;
    card.querySelector('#scanGo').onclick = guard(async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'Checking…';
      const limit = Number(card.querySelector('[name=limit]').value);
      try {
        const r = await api.post('/api/leads/scan', { limit });
        if (!r.scanned) { err(r.message || 'Nothing left to check'); return close(); }
        ok(`Checked ${r.scanned}: ${r.runs_ads} running ads, ${r.no_tracking} tracking nothing, ${r.broken} broken, ${r.not_mobile} not mobile.`);
        close();
        onDone();
      } finally {
        e.target.disabled = false;
        e.target.textContent = 'Start checking';
      }
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
              ${raw(lead.website ? '<button type="button" class="btn" id="scanOneBtn">Check their site</button>' : '')}
              <button type="button" class="btn danger" id="delBtn">Delete</button>
            </div>
          </form>
        </div>
        <div>
          ${raw(lead.is_chain ? h`<div class="card" style="border-color:var(--err);margin-bottom:14px">
            <div class="s" style="color:var(--err);font-weight:650;margin-bottom:4px">LOOKS LIKE A CHAIN</div>
            <div style="font-size:13.5px;margin-bottom:8px">${lead.chain_reason || 'Matched a known brand.'}</div>
            <button type="button" class="btn sm" id="notChainBtn">This one is independent</button>
          </div>` : '')}
          ${raw(lead.owner_name ? h`<div class="card" style="border-color:var(--ok);margin-bottom:14px">
            <div class="s" style="color:var(--ok);font-weight:650;margin-bottom:4px">WHO TO ASK FOR</div>
            <div style="font-size:16px;font-weight:700">${lead.owner_name}</div>
            <div class="dim" style="font-size:12.5px;margin-top:2px">
              ${lead.owner_role || 'contact'} · found via ${lead.owner_source} · ${lead.owner_confidence}% confident
            </div>
          </div>` : '')}
          ${raw(lead.owner_email ? h`<div class="card" style="border-color:var(--ok);margin-bottom:14px">
            <div class="s" style="color:var(--ok);font-weight:650;margin-bottom:4px">THEIR DIRECT EMAIL</div>
            <div style="font-size:15px;font-weight:700"><a href="mailto:${lead.owner_email}">${lead.owner_email}</a></div>
            <div class="dim" style="font-size:12.5px;margin-top:2px">
              ${lead.owner_email_kind === 'owner' ? 'confirmed against their name' : 'looks like a person'}
              · ${lead.owner_email_confidence}% confident
            </div>
            ${raw(otherEmails(lead))}
          </div>` : '')}
          ${raw(lead.pitch_angle ? h`<div class="card" style="background:var(--accent-soft);border-color:var(--accent);margin-bottom:14px">
            <div class="s" style="color:var(--accent);font-weight:650;margin-bottom:4px">HOW TO OPEN THE CALL</div>
            <div style="font-size:13.5px">${lead.pitch_angle}</div>
          </div>` : '')}
          ${raw(recoveryPanel(lead))}
          ${raw(lead.site_status ? h`<h3>What is on their site</h3>
          <div class="list" style="margin-bottom:16px">
            <div class="list-item"><div class="grow"><div class="s">Site</div><div class="t" style="font-size:13px">
              ${titleCase(lead.site_status)}${lead.site_platform ? ` · built on ${titleCase(lead.site_platform)}` : ''}
            </div></div></div>
            <div class="list-item"><div class="grow"><div class="s">Tracking</div><div class="t" style="font-size:13px">
              ${[lead.has_meta_pixel && 'Meta Pixel', (lead.has_google_tag || lead.has_analytics) && 'Google tag',
                 lead.has_google_ads && 'Google Ads'].filter(Boolean).join(', ') || 'nothing at all'}
            </div></div></div>
            <div class="list-item"><div class="grow"><div class="s">On a phone</div><div class="t" style="font-size:13px">
              ${raw(lead.mobile_ready
                ? 'Works on phones'
                : '<b style="color:var(--warn)">Does not fit a phone screen</b> — visitors have to pinch and zoom')}
            </div></div></div>
            <div class="list-item"><div class="grow"><div class="s">Security certificate</div><div class="t" style="font-size:13px">
              ${raw(lead.has_ssl
                ? 'Secure (https)'
                : '<b style="color:var(--err)">No certificate</b> — Chrome shows "Not secure" next to their address')}
            </div></div></div>
            ${raw(lead.site_title ? h`<div class="list-item"><div class="grow"><div class="s">Their page title</div>
              <div class="t" style="font-size:13px">${lead.site_title}</div></div></div>` : '')}
          </div>` : '')}
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
    card.querySelector('#notChainBtn')?.addEventListener('click', guard(async () => {
      await api.post(`/api/leads/${lead.id}/not-a-chain`, {});
      ok('Marked independent and rescored');
      close();
      onDone();
    }));
    card.querySelector('#scanOneBtn')?.addEventListener('click', guard(async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'Checking…';
      const r = await api.post(`/api/leads/${lead.id}/scan`, {});
      ok(r.scan.site_status === 'ok' ? 'Checked their site' : `Their site is ${r.scan.site_status}`);
      close();
      onDone();
      leadModal(lead.id, onDone);
    }));
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
