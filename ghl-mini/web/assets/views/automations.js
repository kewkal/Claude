import {
  api, h, raw, stat, pill, guard, ok, err, modal, confirmDialog,
  formData, fmtDateTime, ago, emptyState, titleCase,
} from '../ui.js';

let tab = 'automations';

export default {
  async render(root, ctx) {
    ctx.setActions(h`<button class="btn" id="tickBtn">Run a pass now</button>`);
    document.getElementById('tickBtn').onclick = guard(async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'Running…';
      const r = await api.post('/api/automations/tick', {});
      ok(`Pass done. ${r.jobsRun} jobs run, ${r.pending} still queued.`);
      await reload(root, ctx);
    });
    await reload(root, ctx);
  },
};

async function reload(root, ctx) {
  const [data, seqs, enr, jobs, msgs] = await Promise.all([
    api.get('/api/automations'),
    api.get('/api/sequences'),
    api.get('/api/enrollments'),
    api.get('/api/jobs'),
    api.get('/api/messages'),
  ]);
  root.innerHTML = layout(data, seqs, enr, jobs, msgs);
  wire(root, ctx, data, seqs, jobs);
}

function layout(d, seqs, enr, jobs, msgs) {
  const s = d.scheduler;
  const active = enr.enrollments.filter((e) => e.status === 'active').length;

  return h`
    <div class="grid cols-4" style="margin-bottom:14px">
      ${raw(stat('Scheduler', s.enabled && s.running ? 'On' : 'Off',
        s.lastTick ? `last pass ${ago(s.lastTick)}` : 'has not run yet',
        s.enabled && s.running ? 'ok' : 'warn'))}
      ${raw(stat('Queued up', s.pending, 'messages waiting to go', s.pending ? 'accent' : ''))}
      ${raw(stat('In a sequence', active, `${enr.enrollments.length} total`))}
      ${raw(stat('Texts sent', msgs.counts.outbound || 0, `${msgs.counts.inbound || 0} replies in`))}
    </div>

    ${raw(s.sending_now ? '' : h`<div class="card" style="border-color:var(--warn);margin-bottom:14px">
      <b style="color:var(--warn)">Quiet hours are on right now (${s.quiet_hours}).</b>
      <div class="muted" style="margin-top:4px">Anything due will hold until the window opens. Nothing gets dropped.</div>
    </div>`)}

    <div class="chips" style="margin-bottom:16px">
      ${raw([['automations', 'The four automations'], ['sequences', 'Drip sequences'],
             ['queue', `Queue (${s.pending})`], ['messages', 'Texts']]
        .map(([k, label]) => h`<button class="chip ${raw(tab === k ? 'active' : '')}" data-tab="${k}">${label}</button>`).join(''))}
    </div>

    ${raw(tab === 'automations' ? automationsTab(d)
      : tab === 'sequences' ? sequencesTab(seqs, enr)
      : tab === 'queue' ? queueTab(jobs)
      : messagesTab(msgs))}
  `;
}

function automationsTab(d) {
  return h`
    <div class="grid cols-2">
      ${raw(d.automations.map((a) => {
        const missing = Object.entries(a.needs).filter(([, v]) => !v).map(([k]) => k);
        return h`<div class="card" data-automation="${a.id}">
          <div class="bar" style="margin-bottom:6px">
            <h2 style="margin:0">${a.name}</h2>
            <label style="display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;cursor:pointer">
              <input type="checkbox" data-toggle ${raw(a.enabled ? 'checked' : '')}> ${raw(a.enabled ? 'On' : 'Off')}
            </label>
          </div>
          <p class="sub">${a.blurb}</p>
          ${raw(a.body ? h`<pre class="out" style="max-height:120px">${a.body}</pre>` : '')}
          ${raw(missing.length ? h`<div class="hint" style="color:var(--warn);margin-top:8px">
            Needs: ${missing.map((m) => m.replace(/_/g, ' ')).join(', ')}
          </div>` : '<div class="hint" style="color:var(--ok);margin-top:8px">Ready to go</div>')}
          <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
            ${raw(a.body ? h`<button class="btn sm" data-edit>Edit the message</button>` : '')}
            ${raw(a.body ? h`<button class="btn sm" data-test>Send me a test</button>` : '')}
          </div>
          ${raw(a.webhook ? h`<div class="hint" style="margin-top:10px">
            Twilio voice webhook:<br><span class="mono">${a.webhook}</span>
            ${raw(d.webhooks.reachable ? '' : '<br><b style="color:var(--warn)">Twilio cannot reach localhost. This one needs a public address.</b>')}
          </div>` : '')}
        </div>`;
      }).join(''))}
    </div>

    <div class="card" style="margin-top:14px">
      <h2>Twilio webhooks</h2>
      <p class="sub">Paste these into your Twilio number's settings so calls and replies reach the app.</p>
      <div class="list">
        <div class="list-item"><div class="grow"><div class="s">A call comes in</div><div class="t mono" style="font-size:12.5px">${d.webhooks.voice}</div></div>
          <button class="btn sm" data-copy="${d.webhooks.voice}">Copy</button></div>
        <div class="list-item"><div class="grow"><div class="s">A message comes in</div><div class="t mono" style="font-size:12.5px">${d.webhooks.sms}</div></div>
          <button class="btn sm" data-copy="${d.webhooks.sms}">Copy</button></div>
      </div>
    </div>`;
}

function sequencesTab(seqs, enr) {
  return h`
    <div class="bar">
      <div class="muted">A sequence stops on its own the moment someone replies, books, or texts STOP.</div>
      <button class="btn primary" id="newSeq">New sequence</button>
    </div>
    ${raw(seqs.sequences.length ? seqs.sequences.map((s) => h`<div class="card" data-seq="${s.id}">
      <div class="bar" style="margin-bottom:8px">
        <div>
          <h2 style="margin:0">${s.name}</h2>
          <div class="sub" style="margin:3px 0 0">
            ${raw(pill(s.active ? 'active' : 'off', s.active ? 'won' : ''))}
            <span class="pill">${(seqs.triggers.find((t) => t.id === s.trigger) || {}).label || s.trigger}</span>
            <span class="pill">${s.active_enrollments} running</span>
            <span class="pill">${s.total_enrollments} total</span>
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <label style="display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;cursor:pointer">
            <input type="checkbox" data-seq-active ${raw(s.active ? 'checked' : '')}> On
          </label>
          <button class="btn sm" data-seq-edit>Edit</button>
          <button class="btn sm danger" data-seq-del>Delete</button>
        </div>
      </div>
      <p class="sub">${s.description}</p>
      <div class="list">
        ${raw(s.steps.map((st, i) => h`<div class="list-item">
          <span class="pill">${i + 1}</span>
          <div class="grow">
            <div class="t">${st.subject || String(st.body).slice(0, 78)}</div>
            <div class="s">${st.channel.toUpperCase()} · ${delayLabel(st.delay_minutes, i)}</div>
          </div>
        </div>`).join('') || '<div class="dim" style="padding:8px 2px">No steps yet.</div>')}
      </div>
    </div>`).join('') : emptyState('🔁', 'No sequences yet', 'Build one, or switch on the starter drip that came with the app.'))}

    <div class="card">
      <h2>Who is in a sequence right now</h2>
      ${raw(enr.enrollments.length ? h`<div class="table-wrap"><table>
        <thead><tr><th>Lead</th><th>Sequence</th><th>Step</th><th>Status</th><th>Next touch</th><th></th></tr></thead>
        <tbody>${raw(enr.enrollments.slice(0, 60).map((e) => h`<tr>
          <td><div class="name">${e.lead_name}</div><div class="sub mono">${e.phone || ''}</div></td>
          <td>${e.sequence_name}</td>
          <td class="num">${e.step_index}</td>
          <td>${raw(pill(e.status))}${raw(e.stop_reason ? h`<div class="s dim">${e.stop_reason}</div>` : '')}</td>
          <td class="nowrap dim">${e.next_run_at ? fmtDateTime(e.next_run_at) : '—'}</td>
          <td class="right">${raw(e.status === 'active' ? h`<button class="btn sm" data-stop="${e.id}">Stop</button>` : '')}</td>
        </tr>`).join(''))}</tbody></table></div>`
        : '<div class="dim" style="padding:8px 2px">Nobody yet. Add leads from the Leads screen.</div>')}
    </div>`;
}

function queueTab(jobs) {
  return h`<div class="card">
    <div class="bar">
      <h2 style="margin:0">What is scheduled</h2>
      <div class="chips">${raw(Object.entries(jobs.counts).map(([k, v]) =>
        h`<span class="pill ${raw(k)}">${titleCase(k)} ${v}</span>`).join(''))}</div>
    </div>
    ${raw(jobs.jobs.length ? h`<div class="table-wrap"><table>
      <thead><tr><th>What</th><th>Due</th><th>Status</th><th>Result</th><th></th></tr></thead>
      <tbody>${raw(jobs.jobs.map((j) => h`<tr>
        <td><div class="name">${titleCase(j.kind)}</div><div class="sub mono">${j.dedupe_key || ''}</div></td>
        <td class="nowrap dim">${fmtDateTime(j.run_at)}</td>
        <td>${raw(pill(j.status))}${raw(j.attempts > 1 ? h`<div class="s dim">${j.attempts} tries</div>` : '')}</td>
        <td class="truncate dim" title="${j.result || j.last_error || ''}">${j.result || j.last_error || '—'}</td>
        <td class="right nowrap">
          ${raw(j.status === 'pending' ? h`<button class="btn sm" data-job-run="${j.id}">Run now</button>
            <button class="icon-btn" data-job-cancel="${j.id}" title="Cancel">×</button>` : '')}
        </td>
      </tr>`).join(''))}</tbody></table></div>`
      : emptyState('⏱️', 'Nothing queued', 'Book a call or start a sequence and jobs show up here.'))}
  </div>`;
}

function messagesTab(msgs) {
  return h`<div class="card">
    <h2>Text messages</h2>
    <p class="sub">Everything in and out, including what the automations sent.</p>
    ${raw(msgs.messages.length ? h`<div class="table-wrap"><table>
      <thead><tr><th>When</th><th>Who</th><th>Way</th><th>Message</th><th>Why</th><th>Status</th></tr></thead>
      <tbody>${raw(msgs.messages.map((m) => h`<tr>
        <td class="nowrap dim">${fmtDateTime(m.created_at)}</td>
        <td><div class="name">${m.lead_name || m.from_addr || m.to_addr || '—'}</div>
          <div class="sub mono">${m.direction === 'inbound' ? m.from_addr : m.to_addr}</div></td>
        <td>${raw(pill(m.direction === 'inbound' ? 'received' : 'sent', m.direction === 'inbound' ? 'new' : ''))}</td>
        <td class="truncate" title="${m.body}">${m.body}</td>
        <td class="dim nowrap">${titleCase(m.source)}</td>
        <td>${raw(pill(m.status))}${raw(m.error ? h`<div class="s dim truncate" title="${m.error}">${m.error}</div>` : '')}</td>
      </tr>`).join(''))}</tbody></table></div>`
      : emptyState('💬', 'No texts yet', 'Connect Twilio in Settings and the automations start sending.'))}
  </div>`;
}

function delayLabel(minutes, index) {
  if (index === 0 && !minutes) return 'sent straight away';
  const d = Math.floor(minutes / 1440);
  const hrs = Math.floor((minutes % 1440) / 60);
  const parts = [];
  if (d) parts.push(`${d} day${d === 1 ? '' : 's'}`);
  if (hrs) parts.push(`${hrs} hr${hrs === 1 ? '' : 's'}`);
  if (!parts.length) parts.push(`${minutes} min`);
  return `${parts.join(' ')} after the last one`;
}

function wire(root, ctx, d, seqs, jobs) {
  root.querySelectorAll('[data-tab]').forEach((b) => {
    b.onclick = () => { tab = b.dataset.tab; reload(root, ctx); };
  });

  root.querySelectorAll('[data-copy]').forEach((b) => {
    b.onclick = async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); ok('Copied'); }
      catch { err(b.dataset.copy); }
    };
  });

  root.querySelectorAll('[data-automation]').forEach((card) => {
    const a = d.automations.find((x) => x.id === card.dataset.automation);
    card.querySelector('[data-toggle]').onchange = guard(async (e) => {
      await api.put('/api/settings', { settings: { [a.setting]: e.target.checked ? '1' : '0' } });
      ok(`${a.name} ${e.target.checked ? 'on' : 'off'}`);
      reload(root, ctx);
    });
    card.querySelector('[data-edit]')?.addEventListener('click', () => messageModal(a, () => reload(root, ctx)));
    card.querySelector('[data-test]')?.addEventListener('click', () => testModal(a));
  });

  root.querySelector('#newSeq')?.addEventListener('click', () => sequenceModal(null, () => reload(root, ctx)));

  root.querySelectorAll('[data-seq]').forEach((card) => {
    const seq = seqs.sequences.find((s) => s.id === Number(card.dataset.seq));
    card.querySelector('[data-seq-active]').onchange = guard(async (e) => {
      await api.patch(`/api/sequences/${seq.id}`, { active: e.target.checked });
      ok(`${seq.name} ${e.target.checked ? 'switched on' : 'switched off'}`);
      reload(root, ctx);
    });
    card.querySelector('[data-seq-edit]').onclick = () => sequenceModal(seq, () => reload(root, ctx));
    card.querySelector('[data-seq-del]').onclick = () =>
      confirmDialog(`Delete "${seq.name}"? Anyone part way through stops immediately.`, async () => {
        await api.del(`/api/sequences/${seq.id}`);
        ok('Deleted');
        reload(root, ctx);
      });
  });

  root.querySelectorAll('[data-stop]').forEach((b) => {
    b.onclick = guard(async () => {
      await api.post(`/api/enrollments/${b.dataset.stop}/stop`, {});
      ok('Stopped');
      reload(root, ctx);
    });
  });

  root.querySelectorAll('[data-job-run]').forEach((b) => {
    b.onclick = guard(async () => {
      const r = await api.post(`/api/jobs/${b.dataset.jobRun}/run`, {});
      ok(r.job.result || r.job.last_error || 'Ran');
      reload(root, ctx);
    });
  });
  root.querySelectorAll('[data-job-cancel]').forEach((b) => {
    b.onclick = guard(async () => {
      await api.del(`/api/jobs/${b.dataset.jobCancel}`);
      ok('Cancelled');
      reload(root, ctx);
    });
  });
}

function messageModal(a, onDone) {
  modal((card, close) => {
    card.className = 'modal-card wide';
    card.innerHTML = h`
      <div class="modal-head"><h2>${a.name}</h2><button class="icon-btn" data-close>×</button></div>
      <p class="muted" style="margin-top:0">Keep it under 160 characters and it goes as one text. Longer still sends, it just costs more.</p>
      <textarea id="bodyBox" class="tall" style="min-height:150px">${a.body}</textarea>
      <div class="hint">Fills in automatically: {{name}}, {{first_name}}, {{business_name}}, {{owner_name}}, {{when}}, {{city}}</div>
      <div class="modal-foot">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn primary" data-save>Save</button>
      </div>`;
    card.querySelector('[data-close]').onclick = close;
    card.querySelector('[data-cancel]').onclick = close;
    card.querySelector('[data-save]').onclick = guard(async () => {
      await api.put('/api/settings', { settings: { [a.body_setting]: card.querySelector('#bodyBox').value } });
      ok('Saved');
      close();
      onDone();
    });
  });
}

function testModal(a) {
  modal((card, close) => {
    card.innerHTML = h`
      <div class="modal-head"><h2>Test: ${a.name}</h2></div>
      <p class="muted" style="margin-top:0">Sends the real message to a number you choose, so you can see exactly what a client gets.</p>
      <label class="field"><span>Send to</span><input name="to" id="testTo" placeholder="+15125550100"></label>
      <div class="modal-foot">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn primary" data-send>Send it</button>
      </div>`;
    card.querySelector('[data-cancel]').onclick = close;
    card.querySelector('[data-send]').onclick = guard(async (e) => {
      e.target.disabled = true;
      const r = await api.post(`/api/automations/${a.id}/test`, { to: card.querySelector('#testTo').value });
      if (r.sent) ok('Sent — check your phone');
      else err(r.error || 'Could not send');
      close();
    });
  });
}

function sequenceModal(seq, onDone) {
  const triggers = [
    ['manual', 'Only when I add someone'],
    ['lead_status:queued', 'Automatically when a lead is queued'],
    ['lead_status:new', 'Automatically when a lead is added'],
    ['lead_status:callback', 'Automatically when a lead asks for a callback'],
  ];
  const steps = seq?.steps?.length ? seq.steps : [{ delay_minutes: 0, channel: 'email', subject: '', body: '' }];

  modal((card, close) => {
    card.className = 'modal-card wide';
    card.innerHTML = h`
      <div class="modal-head"><h2>${seq ? 'Edit sequence' : 'New sequence'}</h2><button class="icon-btn" data-close>×</button></div>
      <div class="inline">
        <label class="field"><span>Name</span><input id="seqName" value="${seq?.name || ''}" placeholder="Cold outreach — no website"></label>
        <label class="field"><span>Starts</span><select id="seqTrigger">
          ${raw(triggers.map(([v, l]) => h`<option value="${v}" ${raw(seq?.trigger === v ? 'selected' : '')}>${l}</option>`).join(''))}
        </select></label>
      </div>
      <label class="field"><span>Description</span><input id="seqDesc" value="${seq?.description || ''}"></label>
      <h3 style="margin-top:18px">Steps</h3>
      <div id="stepList"></div>
      <button class="btn sm" id="addStep" type="button">Add a step</button>
      <div class="modal-foot">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn primary" data-save>Save sequence</button>
      </div>`;

    const list = card.querySelector('#stepList');
    const draw = () => {
      list.innerHTML = steps.map((st, i) => h`<div class="card" style="margin-bottom:10px" data-step="${i}">
        <div class="inline" style="margin-bottom:8px">
          <label class="field" style="flex:0 0 110px"><span>Wait (days)</span>
            <input type="number" min="0" step="0.5" data-days value="${(st.delay_minutes / 1440) || 0}"></label>
          <label class="field" style="flex:0 0 120px"><span>Send as</span>
            <select data-channel>
              ${raw(['email', 'sms', 'task'].map((c) => h`<option value="${c}" ${raw(st.channel === c ? 'selected' : '')}>${titleCase(c)}</option>`).join(''))}
            </select></label>
          <div style="flex:1"></div>
          <button class="btn sm danger" type="button" data-rm>Remove</button>
        </div>
        <label class="field"><span>Subject (email only)</span><input data-subject value="${st.subject || ''}"></label>
        <label class="field"><span>Message</span><textarea data-body style="min-height:96px">${st.body || ''}</textarea></label>
      </div>`).join('');

      list.querySelectorAll('[data-step]').forEach((el) => {
        const i = Number(el.dataset.step);
        el.querySelector('[data-days]').oninput = (e) => { steps[i].delay_minutes = Math.round(Number(e.target.value) * 1440); };
        el.querySelector('[data-channel]').onchange = (e) => { steps[i].channel = e.target.value; };
        el.querySelector('[data-subject]').oninput = (e) => { steps[i].subject = e.target.value; };
        el.querySelector('[data-body]').oninput = (e) => { steps[i].body = e.target.value; };
        el.querySelector('[data-rm]').onclick = () => {
          if (steps.length === 1) return err('A sequence needs at least one step');
          steps.splice(i, 1);
          draw();
        };
      });
    };
    draw();

    card.querySelector('#addStep').onclick = () => {
      steps.push({ delay_minutes: 3 * 1440, channel: 'email', subject: '', body: '' });
      draw();
    };
    card.querySelector('[data-close]').onclick = close;
    card.querySelector('[data-cancel]').onclick = close;
    card.querySelector('[data-save]').onclick = guard(async () => {
      const name = card.querySelector('#seqName').value.trim();
      if (!name) return err('Give the sequence a name');
      const payload = {
        name,
        description: card.querySelector('#seqDesc').value,
        trigger: card.querySelector('#seqTrigger').value,
        steps,
      };
      if (seq) await api.patch(`/api/sequences/${seq.id}`, payload);
      else {
        const created = await api.post('/api/sequences', payload);
        await api.patch(`/api/sequences/${created.sequence.id}`, { steps });
      }
      ok('Saved');
      close();
      onDone();
    });
  });
}
