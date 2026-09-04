import {
  api, h, raw, esc, pill, scorePill, guard, ok, err, formData,
  fmtDuration, ago, emptyState, titleCase,
} from '../ui.js';

const OUTCOMES = [
  { key: 'connected', label: 'Connected' },
  { key: 'booked', label: '✅ Booked' },
  { key: 'callback', label: 'Call back' },
  { key: 'voicemail', label: 'Voicemail' },
  { key: 'no_answer', label: 'No answer' },
  { key: 'gatekeeper', label: 'Gatekeeper' },
  { key: 'not_interested', label: 'Not interested' },
  { key: 'wrong_number', label: 'Wrong number' },
  { key: 'dnc', label: '🚫 Do not call' },
];

let current = null;
let timer = null;
let elapsed = 0;

export default {
  async render(root, ctx) {
    const [queueData, scriptData, stats] = await Promise.all([
      api.get('/api/calls/queue', { limit: 60 }),
      api.get('/api/scripts', { kind: 'call' }),
      api.get('/api/calls/stats'),
    ]);

    const queue = queueData.queue;
    if (ctx.arg) {
      const wanted = queue.find((l) => String(l.id) === String(ctx.arg));
      current = wanted || current;
    }
    if (!current || !queue.some((l) => l.id === current.id)) current = queue[0] || null;

    ctx.setActions(h`
      <span class="pill">${stats.today.calls} today</span>
      <span class="pill booked">${stats.today.booked} booked</span>
      <span class="pill">${fmtDuration(stats.today.talk_time)} talk time</span>
    `);

    root.innerHTML = layout(queue, scriptData.scripts, stats);
    wire(root, ctx, queue, scriptData.scripts);
  },
};

function layout(queue, scripts, stats) {
  if (!queue.length) {
    return h`<div class="card">${raw(emptyState('☎️', 'Nobody left to call',
      'Every callable lead is either done, snoozed or marked do-not-call. Scrape more, or clear a follow-up date.'))}
      <div style="text-align:center"><a class="btn primary" href="#/leads">Go get more leads</a></div></div>`;
  }

  return h`<div class="dialer">
    <div class="card dial-queue">
      <h3>Queue · ${queue.length}</h3>
      <div class="list" id="queueList">
        ${raw(queue.map((l) => h`<div class="list-item ${raw(current && current.id === l.id ? 'active' : '')}" data-lead="${l.id}">
          <div class="grow">
            <div class="t">${l.name}</div>
            <div class="s">${l.city || ''}${l.attempts ? ` · ${l.attempts} attempt${l.attempts === 1 ? '' : 's'}` : ''}</div>
          </div>
          ${raw(scorePill(l.score))}
        </div>`).join(''))}
      </div>
    </div>

    <div class="card dial-card" id="dialCard">
      ${raw(current ? cardBody(current) : '<div class="empty">Pick someone from the queue.</div>')}
    </div>

    <div class="card script-pane">
      <div class="bar" style="margin-bottom:10px">
        <h3 style="margin:0">Script</h3>
        <select id="scriptSel" style="width:auto;max-width:170px">
          ${raw(scripts.map((s) => h`<option value="${s.id}" ${raw(s.is_default ? 'selected' : '')}>${s.name}</option>`).join(''))}
        </select>
      </div>
      <pre id="scriptBody">Pick a script.</pre>
    </div>
  </div>`;
}

function cardBody(lead) {
  return h`
    <div class="biz">${lead.name}</div>
    <div class="muted">${lead.category || ''}${lead.rating ? ` · ${lead.rating}★ (${lead.review_count})` : ''}</div>
    <div class="phone">${lead.phone || 'no number'}</div>
    <div class="muted" style="margin-bottom:6px">${lead.address || ''}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
      ${raw(pill(lead.status))}
      ${raw(lead.website
        ? h`<a class="pill" href="${lead.website}" target="_blank" rel="noopener">website</a>`
        : '<span class="pill" style="color:var(--accent);border-color:var(--accent)">no website</span>')}
      ${raw(lead.attempts ? h`<span class="pill">${lead.attempts} attempts</span>` : '')}
      ${raw(lead.last_contacted_at ? h`<span class="pill">last ${ago(lead.last_contacted_at)}</span>` : '')}
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
      ${raw(lead.phone ? h`<a class="btn primary" href="tel:${lead.phone}" id="tapCall">📱 Call from this device</a>` : '')}
      <button class="btn" id="twilioBtn">☎️ Dial via Twilio</button>
      <span class="pill mono" id="timer" style="align-self:center">00:00</span>
      <button class="btn sm ghost" id="timerBtn">Start timer</button>
    </div>

    <h3>How did it go?</h3>
    <div class="outcome-grid" style="margin-bottom:14px">
      ${raw(OUTCOMES.map((o) => h`<button class="btn" data-outcome="${o.key}">${o.label}</button>`).join(''))}
    </div>

    <label class="field"><span>Notes</span>
      <textarea id="callNotes" placeholder="What they said, who to ask for, when to call back"></textarea></label>

    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn" id="skipBtn">Skip for now</button>
      <button class="btn" id="bookBtn">📅 Book them in</button>
    </div>`;
}

function wire(root, ctx, queue, scripts) {
  root.querySelectorAll('[data-lead]').forEach((el) => {
    el.onclick = () => {
      current = queue.find((l) => l.id === Number(el.dataset.lead));
      stopTimer();
      root.querySelectorAll('[data-lead]').forEach((x) => x.classList.remove('active'));
      el.classList.add('active');
      root.querySelector('#dialCard').innerHTML = cardBody(current);
      wireCard(root, ctx);
    };
  });

  const sel = root.querySelector('#scriptSel');
  const body = root.querySelector('#scriptBody');
  const showScript = async () => {
    const id = sel.value;
    if (!id) return;
    if (!current) {
      const s = scripts.find((x) => String(x.id) === String(id));
      body.textContent = s ? s.body : '';
      return;
    }
    const r = await api.post(`/api/scripts/${id}/render`, { lead_id: current.id });
    body.textContent = r.body;
  };
  if (sel) { sel.onchange = guard(showScript); guard(showScript)(); }

  wireCard(root, ctx);
}

function wireCard(root, ctx) {
  if (!current) return;

  const notes = root.querySelector('#callNotes');
  const scriptSel = root.querySelector('#scriptSel');
  const timerEl = root.querySelector('#timer');
  const timerBtn = root.querySelector('#timerBtn');

  const tick = () => {
    elapsed++;
    if (timerEl) timerEl.textContent =
      `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  };

  const startTimer = () => {
    if (timer) return;
    timer = setInterval(tick, 1000);
    if (timerBtn) timerBtn.textContent = 'Stop timer';
  };

  if (timerBtn) timerBtn.onclick = () => (timer ? stopTimer(true) : startTimer());
  root.querySelector('#tapCall')?.addEventListener('click', startTimer);

  root.querySelector('#twilioBtn')?.addEventListener('click', guard(async () => {
    const r = await api.post('/api/calls/dial', { lead_id: current.id });
    if (r.provider === 'manual') err('Twilio is not connected. Logged as a manual call.');
    else ok(`Dialing… (${r.status})`);
    startTimer();
  }));

  root.querySelectorAll('[data-outcome]').forEach((btn) => {
    btn.onclick = guard(async () => {
      await api.post('/api/calls', {
        lead_id: current.id,
        outcome: btn.dataset.outcome,
        notes: notes ? notes.value : '',
        duration_sec: elapsed,
        script_id: scriptSel ? Number(scriptSel.value) || null : null,
      });
      ok(`Logged: ${titleCase(btn.dataset.outcome)}`);
      stopTimer(true);
      if (btn.dataset.outcome === 'booked') return openBooking(root, ctx);
      current = null;
      ctx.setBadge('dialer', 0);
      await reload(root, ctx);
    });
  });

  root.querySelector('#skipBtn')?.addEventListener('click', guard(async () => {
    await api.patch(`/api/leads/${current.id}`, {
      next_action_at: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 19).replace('T', ' '),
    });
    ok('Snoozed 2 days');
    current = null;
    await reload(root, ctx);
  }));

  root.querySelector('#bookBtn')?.addEventListener('click', () => openBooking(root, ctx));
}

function stopTimer(reset = false) {
  clearInterval(timer);
  timer = null;
  if (reset) elapsed = 0;
}

async function openBooking(root, ctx) {
  const lead = current;
  if (!lead) return;
  const { modal } = await import('../ui.js');
  modal((card, close) => {
    const start = new Date(Date.now() + 864e5);
    start.setMinutes(0, 0, 0);
    card.innerHTML = h`
      <div class="modal-head"><h2>Book ${lead.name}</h2></div>
      <form id="bookForm">
        <div class="inline">
          <label class="field"><span>Their name</span><input name="name" value="${lead.name}" required></label>
          <label class="field"><span>Email</span><input type="email" name="email" value="${lead.email || ''}"></label>
        </div>
        <div class="inline">
          <label class="field"><span>When</span>
            <input type="datetime-local" name="starts_at" value="${start.toISOString().slice(0, 16)}" required></label>
          <label class="field"><span>Minutes</span><input type="number" name="duration_min" value="30"></label>
        </div>
        <label class="field"><span>Notes</span><textarea name="notes"></textarea></label>
        <div class="modal-foot">
          <button type="button" class="btn" data-cancel>Cancel</button>
          <button type="submit" class="btn primary">Book it</button>
        </div>
      </form>`;
    card.querySelector('[data-cancel]').onclick = close;
    card.querySelector('#bookForm').onsubmit = guard(async (e) => {
      e.preventDefault();
      const v = formData(e.target);
      await api.post('/api/bookings', {
        lead_id: lead.id, name: v.name, email: v.email, phone: lead.phone,
        starts_at: new Date(v.starts_at).toISOString(),
        duration_min: v.duration_min, notes: v.notes,
      });
      ok('Booked');
      close();
      current = null;
      await reload(root, ctx);
    });
  });
}

async function reload(root, ctx) {
  const [queueData, scriptData, stats] = await Promise.all([
    api.get('/api/calls/queue', { limit: 60 }),
    api.get('/api/scripts', { kind: 'call' }),
    api.get('/api/calls/stats'),
  ]);
  if (!current || !queueData.queue.some((l) => l.id === current.id)) current = queueData.queue[0] || null;
  ctx.setActions(h`
    <span class="pill">${stats.today.calls} today</span>
    <span class="pill booked">${stats.today.booked} booked</span>
    <span class="pill">${fmtDuration(stats.today.talk_time)} talk time</span>`);
  root.innerHTML = layout(queueData.queue, scriptData.scripts, stats);
  wire(root, ctx, queueData.queue, scriptData.scripts);
}
