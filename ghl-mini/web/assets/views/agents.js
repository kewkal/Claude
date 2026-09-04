import {
  api, h, raw, pill, guard, ok, err, modal, confirmDialog,
  formData, ago, fmtDateTime, emptyState, titleCase,
} from '../ui.js';

let pollTimer = null;

export default {
  async render(root, ctx) {
    ctx.setActions(h`<button class="btn" id="refreshBtn">Refresh</button>`);
    document.getElementById('refreshBtn').onclick = () => reload(root, ctx);
    await reload(root, ctx);

    // Keep the run list live while anything is running.
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      if (!document.body.contains(root)) return clearInterval(pollTimer);
      if (!location.hash.startsWith('#/agents')) return;
      const { runs } = await api.get('/api/agents/runs', { limit: 25 });
      if (runs.some((r) => r.status === 'running' || r.status === 'queued')) reload(root, ctx);
    }, 8000);
  },
};

async function reload(root, ctx) {
  const [{ agents }, { runs }] = await Promise.all([
    api.get('/api/agents'),
    api.get('/api/agents/runs', { limit: 30 }),
  ]);
  root.innerHTML = layout(agents, runs);
  wire(root, ctx, agents, runs);
}

function layout(agents, runs) {
  const active = runs.filter((r) => r.status === 'running' || r.status === 'queued').length;

  return h`
    <div class="card" style="margin-bottom:14px">
      <h2>Your six agents</h2>
      <p class="sub">These are the staff. Each one does a slice of the work you'd otherwise pay a person or a platform for.
      ${raw(active ? h`<b style="color:var(--accent)"> ${active} running now.</b>` : '')}</p>
    </div>

    <div class="grid cols-3" style="margin-bottom:20px">
      ${raw(agents.map(agentCard).join(''))}
    </div>

    <div class="card">
      <div class="bar">
        <h2 style="margin:0">Recent runs</h2>
        <span class="muted">${runs.length} shown</span>
      </div>
      ${raw(runs.length ? runTable(runs) : emptyState('🤖', 'No runs yet', 'Fire one of the agents above and it shows up here.'))}
    </div>
  `;
}

function agentCard(a) {
  return h`<div class="card agent-card" data-agent="${a.id}">
    <div class="head">
      <div class="emoji">${a.emoji}</div>
      <div>
        <div class="name">${a.name}</div>
        <div class="tag">${a.tagline}</div>
      </div>
    </div>
    <div class="desc">${a.description}</div>
    <div class="runs">
      <span>${a.stats.total} run${a.stats.total === 1 ? '' : 's'}</span>
      ${raw(a.stats.done ? h`<span style="color:var(--ok)">${a.stats.done} done</span>` : '')}
      ${raw(a.stats.running ? h`<span style="color:var(--accent)">${a.stats.running} running</span>` : '')}
      ${raw(a.stats.failed ? h`<span style="color:var(--err)">${a.stats.failed} failed</span>` : '')}
    </div>
    <button class="btn primary" data-run>Put it to work</button>
  </div>`;
}

function runTable(runs) {
  return h`<div class="table-wrap"><table>
    <thead><tr><th>#</th><th>Agent</th><th>Task</th><th>Status</th><th>Started</th><th></th></tr></thead>
    <tbody>${raw(runs.map((r) => h`<tr class="row-click" data-run-id="${r.id}">
      <td class="dim mono">${r.id}</td>
      <td class="nowrap">${titleCase(r.agent.replace(/-/g, ' '))}</td>
      <td class="truncate">${r.task}</td>
      <td>${raw(pill(r.status))}</td>
      <td class="nowrap dim">${ago(r.created_at)}</td>
      <td class="right"><button class="btn sm" data-view>View</button></td>
    </tr>`).join(''))}</tbody>
  </table></div>`;
}

function wire(root, ctx, agents, runs) {
  root.querySelectorAll('[data-agent]').forEach((card) => {
    const agent = agents.find((a) => a.id === card.dataset.agent);
    card.querySelector('[data-run]').onclick = () => runModal(agent, () => reload(root, ctx));
  });
  root.querySelectorAll('[data-run-id]').forEach((tr) => {
    const open = () => runDetail(tr.dataset.runId, () => reload(root, ctx));
    tr.querySelector('[data-view]').onclick = (e) => { e.stopPropagation(); open(); };
    tr.onclick = (e) => { if (!e.target.closest('button')) open(); };
  });
}

function runModal(agent, onDone) {
  modal((card, close) => {
    card.innerHTML = h`
      <div class="modal-head">
        <span style="font-size:22px">${agent.emoji}</span>
        <h2>${agent.name}</h2>
        <button class="icon-btn" data-close>×</button>
      </div>
      <p class="muted" style="margin-top:0">${agent.description}</p>
      <form id="runForm">
        ${raw(agent.inputs.map((f) => {
          const req = f.required ? ' required' : '';
          const ph = f.placeholder ? ` placeholder="${f.placeholder}"` : '';
          const val = f.default != null ? ` value="${f.default}"` : '';
          const input = f.type === 'textarea'
            ? `<textarea name="${f.key}"${req}${ph}></textarea>`
            : `<input type="${f.type || 'text'}" name="${f.key}"${req}${ph}${val}>`;
          return h`<label class="field"><span>${f.label}${raw(f.required ? ' *' : '')}</span>${raw(input)}</label>`;
        }).join(''))}
        <label class="field"><span>Extra instructions (optional)</span>
          <textarea name="task" placeholder="Anything specific you want it to do differently"></textarea></label>
        <div class="hint">The task is written to <span class="mono">agent-queue/</span> either way, so you can also run it by hand inside Claude Code.</div>
        <div class="modal-foot">
          <button type="button" class="btn" data-cancel>Cancel</button>
          <button type="submit" class="btn primary">Run it</button>
        </div>
      </form>`;

    card.querySelector('[data-close]').onclick = close;
    card.querySelector('[data-cancel]').onclick = close;
    card.querySelector('#runForm').onsubmit = guard(async (e) => {
      e.preventDefault();
      const v = formData(e.target);
      const task = v.task;
      delete v.task;
      const { run } = await api.post(`/api/agents/${agent.id}/run`, { ...v, task: task || undefined });
      ok(`${agent.name} queued as run #${run.id}`);
      close();
      onDone();
    });
  });
}

function runDetail(id, onDone) {
  modal(async (card, close) => {
    card.className = 'modal-card wide';
    card.innerHTML = '<div class="loading">Loading…</div>';
    const { run } = await api.get(`/api/agents/runs/${id}`);

    card.innerHTML = h`
      <div class="modal-head">
        <h2>Run #${run.id} — ${titleCase(run.agent.replace(/-/g, ' '))}</h2>
        ${raw(pill(run.status))}
        <button class="icon-btn" data-close>×</button>
      </div>
      <div class="muted" style="margin-bottom:12px">
        Queued ${fmtDateTime(run.created_at)}${raw(run.finished_at ? h` · finished ${fmtDateTime(run.finished_at)}` : '')}
      </div>
      <h3>Task</h3>
      <p style="margin-top:0">${run.task}</p>
      ${raw(Object.keys(run.input).length ? h`<h3>Inputs</h3>
        <div class="list" style="margin-bottom:14px">
          ${raw(Object.entries(run.input).filter(([, v]) => v !== '' && v != null).map(([k, v]) =>
            h`<div class="list-item"><div class="grow"><div class="s">${k}</div><div class="t" style="font-size:13px">${v}</div></div></div>`).join(''))}
        </div>` : '')}
      ${raw(run.queue_path ? h`<h3>Task file</h3><p class="mono dim" style="margin-top:0">${run.queue_path}</p>` : '')}
      <h3>Output</h3>
      <pre class="out">${run.output || (run.status === 'running' ? 'Still working…' : 'No output yet.')}</pre>
      <div class="modal-foot">
        <button class="btn danger" data-del>Delete run</button>
        <button class="btn" data-close2>Close</button>
      </div>`;

    card.querySelector('[data-close]').onclick = close;
    card.querySelector('[data-close2]').onclick = close;
    card.querySelector('[data-del]').onclick = () =>
      confirmDialog('Delete this run from the log?', async () => {
        await api.del(`/api/agents/runs/${run.id}`);
        ok('Deleted');
        close();
        onDone();
      });
  });
}
