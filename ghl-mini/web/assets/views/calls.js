import { api, h, raw, stat, pill, guard, ok, confirmDialog, fmtDateTime, fmtDuration, emptyState, titleCase, debounce } from '../ui.js';

const filters = { outcome: 'all', q: '', page: 1, limit: 100 };

export default {
  async render(root, ctx) {
    ctx.setActions(h`<a class="btn" href="#/dialer">Open the dialer</a>`);
    await reload(root, ctx);
  },
};

async function reload(root, ctx) {
  const [data, stats] = await Promise.all([
    api.get('/api/calls', filters),
    api.get('/api/calls/stats'),
  ]);
  root.innerHTML = layout(data, stats);
  wire(root, ctx, data);
}

function layout(data, stats) {
  const connectRate = stats.today.calls ? Math.round((stats.today.connected / stats.today.calls) * 100) : 0;
  const bookRate = stats.week.calls ? Math.round((stats.week.booked / stats.week.calls) * 100) : 0;

  return h`
    <div class="grid cols-4" style="margin-bottom:14px">
      ${raw(stat('Calls today', stats.today.calls, `${connectRate}% connected`))}
      ${raw(stat('Booked today', stats.today.booked, 'appointments set', stats.today.booked ? 'ok' : ''))}
      ${raw(stat('This week', stats.week.calls, `${stats.week.booked} booked · ${bookRate}% rate`, 'accent'))}
      ${raw(stat('Talk time today', fmtDuration(stats.today.talk_time)))}
    </div>

    <div class="grid cols-2" style="margin-bottom:14px">
      <div class="card">
        <h3>Last 14 days</h3>
        ${raw(stats.daily.length ? sparkline(stats.daily) : '<div class="dim">Nothing logged yet.</div>')}
      </div>
      <div class="card">
        <h3>Outcomes, last 30 days</h3>
        ${raw(stats.byOutcome.length ? outcomeBars(stats.byOutcome) : '<div class="dim">Nothing logged yet.</div>')}
      </div>
    </div>

    <div class="filters">
      <input class="grow" id="qInput" placeholder="Search a name, number or note…" value="${filters.q}">
      <select id="outcomeSel">
        <option value="all">All outcomes</option>
        ${raw(data.outcomes.map((o) => h`<option value="${o}" ${raw(filters.outcome === o ? 'selected' : '')}>${titleCase(o)}</option>`).join(''))}
      </select>
    </div>

    ${raw(data.calls.length ? table(data.calls) : emptyState('📊', 'No calls logged', 'Make some calls from the dialer and they show up here.'))}

    ${raw(data.pages > 1 ? h`<div class="bar" style="margin-top:14px">
      <div class="muted">Page ${data.page} of ${data.pages} · ${data.total.toLocaleString()} calls</div>
      <div style="display:flex;gap:8px">
        <button class="btn sm" id="prevPage" ${raw(data.page <= 1 ? 'disabled' : '')}>Previous</button>
        <button class="btn sm" id="nextPage" ${raw(data.page >= data.pages ? 'disabled' : '')}>Next</button>
      </div></div>` : '')}
  `;
}

function table(calls) {
  return h`<div class="table-wrap"><table>
    <thead><tr><th>When</th><th>Who</th><th>Number</th><th>Outcome</th><th class="num">Length</th><th>Notes</th><th></th></tr></thead>
    <tbody>${raw(calls.map((c) => h`<tr data-call="${c.id}">
      <td class="nowrap dim">${fmtDateTime(c.started_at)}</td>
      <td><div class="name">${c.lead_name || '—'}</div><div class="sub">${c.lead_city || ''}</div></td>
      <td class="mono nowrap">${c.phone || '—'}</td>
      <td>${raw(pill(c.outcome))}</td>
      <td class="num nowrap">${fmtDuration(c.duration_sec)}</td>
      <td class="truncate dim" title="${c.notes || ''}">${c.notes || '—'}</td>
      <td class="right"><button class="icon-btn" data-del title="Delete">×</button></td>
    </tr>`).join(''))}</tbody>
  </table></div>`;
}

function sparkline(daily) {
  const max = Math.max(...daily.map((d) => d.calls), 1);
  return h`<div style="display:flex;align-items:flex-end;gap:4px;height:110px;margin-top:8px">
    ${raw(daily.map((d) => h`<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%" title="${d.day}: ${d.calls} calls, ${d.booked} booked">
      <div style="background:var(--ok);border-radius:3px 3px 0 0;height:${(d.booked / max) * 100}%"></div>
      <div style="background:var(--accent);border-radius:${d.booked ? '0' : '3px 3px 0 0'};height:${((d.calls - d.booked) / max) * 100}%"></div>
    </div>`).join(''))}
  </div>
  <div class="hint" style="margin-top:8px">Blue is calls, green is booked. Peak day: ${max}.</div>`;
}

function outcomeBars(rows) {
  const max = Math.max(...rows.map((r) => r.n), 1);
  return h`<div class="list" style="gap:6px;margin-top:8px">
    ${raw(rows.map((r) => h`<div>
      <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:3px">
        <span>${titleCase(r.outcome)}</span><span class="dim">${r.n}</span>
      </div>
      <div class="progress"><i style="width:${(r.n / max) * 100}%"></i></div>
    </div>`).join(''))}
  </div>`;
}

function wire(root, ctx, data) {
  const q = root.querySelector('#qInput');
  q.oninput = debounce(() => { filters.q = q.value; filters.page = 1; reload(root, ctx); });
  root.querySelector('#outcomeSel').onchange = (e) => { filters.outcome = e.target.value; filters.page = 1; reload(root, ctx); };
  root.querySelector('#prevPage')?.addEventListener('click', () => { filters.page--; reload(root, ctx); });
  root.querySelector('#nextPage')?.addEventListener('click', () => { filters.page++; reload(root, ctx); });

  root.querySelectorAll('[data-call]').forEach((tr) => {
    tr.querySelector('[data-del]').onclick = (e) => {
      e.stopPropagation();
      confirmDialog('Delete this call from the log?', async () => {
        await api.del(`/api/calls/${tr.dataset.call}`);
        ok('Deleted');
        reload(root, ctx);
      });
    };
  });
}
