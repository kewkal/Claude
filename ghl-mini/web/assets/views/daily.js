import { api, h, raw, esc, stat, pill, guard, ok, err, fmtTime, fmtDuration, formData, emptyState, debounce } from '../ui.js';

const todayKey = () => new Date().toISOString().slice(0, 10);
let day = todayKey();

export default {
  async render(root, ctx) {
    const data = await api.get('/api/daily', { day });
    const history = await api.get('/api/daily/history', { days: 14 });

    ctx.setActions(h`
      <input type="date" id="dayPicker" value="${day}" style="width:auto">
      <button class="btn" id="todayBtn">Today</button>
    `);

    root.innerHTML = layout(data, history);
    wire(root, ctx, data);
  },
};

function layout(d, history) {
  const worked = Number(d.log.worked_hours) || 0;
  const target = Number(d.log.target_hours) || d.targets.hours;
  const hourPct = target ? Math.min(100, Math.round((worked / target) * 100)) : 0;
  const callPct = d.targets.calls ? Math.min(100, Math.round((d.calls.made / d.targets.calls) * 100)) : 0;

  return h`
    <div class="grid cols-4" style="margin-bottom:14px">
      ${raw(stat('Hours worked', `${worked}`, `of ${target} target`, hourPct >= 100 ? 'ok' : ''))}
      ${raw(stat('Calls made', d.calls.made, `of ${d.targets.calls} target`, callPct >= 100 ? 'ok' : 'accent'))}
      ${raw(stat('Booked today', d.calls.booked, `${d.calls.connected} connected`, d.calls.booked ? 'ok' : ''))}
      ${raw(stat('Talk time', fmtDuration(d.calls.talk_time), `${d.leads.added} leads added`))}
    </div>

    <div class="grid cols-2" style="margin-bottom:14px">
      <div class="card">
        <h3>Hours</h3>
        <div class="progress ${raw(hourPct >= 100 ? 'ok' : '')}"><i style="width:${hourPct}%"></i></div>
        <div class="hint">${worked} of ${target} hours · ${hourPct}%</div>
      </div>
      <div class="card">
        <h3>Call target</h3>
        <div class="progress ${raw(callPct >= 100 ? 'ok' : '')}"><i style="width:${callPct}%"></i></div>
        <div class="hint">${d.calls.made} of ${d.targets.calls} calls · ${callPct}%</div>
      </div>
    </div>

    <div class="grid sidebar-split">
      <div>
        <div class="card">
          <h2>The day</h2>
          <p class="sub">Write it down. What you track is what moves.</p>
          <form id="logForm">
            <div class="inline" style="margin-bottom:12px">
              <label class="field"><span>Hours worked</span>
                <input type="number" step="0.25" min="0" name="worked_hours" value="${d.log.worked_hours}"></label>
              <label class="field"><span>Target hours</span>
                <input type="number" step="0.25" min="0" name="target_hours" value="${d.log.target_hours}"></label>
              <label class="field"><span>Revenue collected ($)</span>
                <input type="number" step="1" min="0" name="revenue_dollars" value="${(d.log.revenue_cents / 100) || ''}"></label>
            </div>
            <label class="field"><span>Today's one thing</span>
              <input name="focus" value="${d.log.focus}" placeholder="Book 3 discovery calls"></label>
            <label class="field"><span>Wins</span>
              <textarea name="wins" placeholder="What actually got done">${d.log.wins}</textarea></label>
            <label class="field"><span>Blockers</span>
              <textarea name="blockers" placeholder="What stopped you">${d.log.blockers}</textarea></label>
            <label class="field"><span>Notes</span>
              <textarea name="notes" placeholder="Anything else">${d.log.notes}</textarea></label>
            <button type="submit" class="btn primary">Save the day</button>
            <span class="hint" id="saveHint" style="margin-left:10px"></span>
          </form>
        </div>

        <div class="card">
          <h2>Last 14 days</h2>
          <p class="sub">Total: ${history.totals.hours.toFixed(1)} hours · ${history.totals.calls} calls · ${history.totals.booked} booked</p>
          ${raw(history.history.length ? historyTable(history.history) : emptyState('📈', 'Nothing logged yet', 'Fill in today and it starts building.'))}
        </div>
      </div>

      <div>
        <div class="card">
          <h2>Today's list</h2>
          <form id="taskForm" class="inline" style="margin:10px 0 12px">
            <input name="title" placeholder="Add a task" style="flex:1">
            <button class="btn" type="submit">Add</button>
          </form>
          <div class="list" id="taskList">
            ${raw(d.tasks.length ? d.tasks.map(taskRow).join('') : '<div class="dim" style="padding:8px 2px">Nothing on the list.</div>')}
          </div>
        </div>

        <div class="card">
          <h2>Follow-ups due</h2>
          <p class="sub">${d.due.length} lead${d.due.length === 1 ? '' : 's'} waiting on you</p>
          <div class="list">
            ${raw(d.due.length
              ? d.due.slice(0, 8).map((l) => h`<div class="list-item">
                  <div class="grow"><div class="t">${l.name}</div><div class="s">${l.phone || 'no phone'}</div></div>
                  ${raw(pill(l.status))}
                </div>`).join('')
              : '<div class="dim" style="padding:8px 2px">All clear.</div>')}
          </div>
          ${raw(d.due.length ? '<a class="btn sm" href="#/dialer" style="margin-top:10px">Open the dialer</a>' : '')}
        </div>

        <div class="card">
          <h2>On the calendar</h2>
          <div class="list">
            ${raw(d.bookings.length
              ? d.bookings.map((b) => h`<div class="list-item">
                  <div class="grow"><div class="t">${b.name}</div><div class="s">${fmtTime(b.starts_at)} · ${b.title}</div></div>
                  ${raw(pill(b.status))}
                </div>`).join('')
              : '<div class="dim" style="padding:8px 2px">Nothing booked today.</div>')}
          </div>
        </div>

        ${raw(d.onboarding.length ? h`<div class="card">
          <h2>Clients waiting on a build</h2>
          <div class="list">
            ${raw(d.onboarding.map((o) => h`<div class="list-item">
              <div class="grow"><div class="t">${o.business || o.client_name}</div><div class="s">${o.status}</div></div>
              <a class="btn sm" href="#/onboarding/${o.id}">Open</a>
            </div>`).join(''))}
          </div>
        </div>` : '')}
      </div>
    </div>
  `;
}

function taskRow(t) {
  return h`<div class="list-item" data-task="${t.id}">
    <input type="checkbox" data-done ${raw(t.done ? 'checked' : '')}>
    <div class="grow"><div class="t" style="${raw(t.done ? 'text-decoration:line-through;opacity:.55' : '')}">${t.title}</div></div>
    <button class="icon-btn" data-del title="Delete">×</button>
  </div>`;
}

function historyTable(rows) {
  return h`<div class="table-wrap"><table>
    <thead><tr><th>Day</th><th class="num">Hours</th><th class="num">Calls</th><th class="num">Booked</th><th>Focus</th></tr></thead>
    <tbody>${raw(rows.map((r) => h`<tr>
      <td class="nowrap">${r.day}</td>
      <td class="num">${r.worked_hours || 0}</td>
      <td class="num">${r.calls}</td>
      <td class="num">${r.booked}</td>
      <td class="truncate dim">${r.focus || '—'}</td>
    </tr>`).join(''))}</tbody>
  </table></div>`;
}

function wire(root, ctx, data) {
  const picker = document.getElementById('dayPicker');
  if (picker) picker.onchange = () => { day = picker.value || todayKey(); ctx.navigate('daily'); reload(root, ctx); };
  const todayBtn = document.getElementById('todayBtn');
  if (todayBtn) todayBtn.onclick = () => { day = todayKey(); reload(root, ctx); };

  const form = root.querySelector('#logForm');
  const hint = root.querySelector('#saveHint');

  const save = guard(async () => {
    const values = formData(form);
    const payload = {
      day,
      worked_hours: Number(values.worked_hours) || 0,
      target_hours: Number(values.target_hours) || 0,
      revenue_cents: Math.round((Number(values.revenue_dollars) || 0) * 100),
      focus: values.focus, wins: values.wins, blockers: values.blockers, notes: values.notes,
    };
    await api.put('/api/daily', payload);
    hint.textContent = 'Saved';
    setTimeout(() => { hint.textContent = ''; }, 1800);
  });

  form.onsubmit = (e) => { e.preventDefault(); save(); };
  const autosave = debounce(save, 1200);
  form.querySelectorAll('input, textarea').forEach((el) => el.addEventListener('input', autosave));

  root.querySelector('#taskForm').onsubmit = guard(async (e) => {
    e.preventDefault();
    const input = e.target.querySelector('[name=title]');
    if (!input.value.trim()) return;
    await api.post('/api/tasks', { title: input.value.trim(), day });
    input.value = '';
    reload(root, ctx);
  });

  root.querySelectorAll('[data-task]').forEach((el) => {
    const id = el.dataset.task;
    el.querySelector('[data-done]').onchange = guard(async (e) => {
      await api.patch(`/api/tasks/${id}`, { done: e.target.checked });
      reload(root, ctx);
    });
    el.querySelector('[data-del]').onclick = guard(async () => {
      await api.del(`/api/tasks/${id}`);
      reload(root, ctx);
    });
  });
}

async function reload(root, ctx) {
  const data = await api.get('/api/daily', { day });
  const history = await api.get('/api/daily/history', { days: 14 });
  root.innerHTML = layout(data, history);
  wire(root, ctx, data);
}
