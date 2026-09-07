import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { all, get, run } from './db.js';
import { allSettings } from './settings.js';
import { ROOT } from './db.js';

export const AGENTS = [
  {
    id: 'lead-scout',
    name: 'Lead Scout',
    emoji: '🔍',
    tagline: 'Finds and qualifies leads',
    description:
      'Pulls businesses from Google Maps, strips out the ones already well served, scores the rest on how badly they need what you sell, and writes them into the Leads table.',
    inputs: [
      { key: 'query', label: 'Search', placeholder: 'roofers in Tampa FL', required: true },
      { key: 'pages', label: 'Pages (20 each)', type: 'number', default: 3 },
      { key: 'focus', label: 'What makes a good lead here?', type: 'textarea',
        placeholder: 'No website or a dead Facebook page, 20+ reviews, 4 stars or better' },
    ],
  },
  {
    id: 'outreach-writer',
    name: 'Outreach Writer',
    emoji: '✍️',
    tagline: 'Writes the cold email and SMS',
    description:
      'Takes a lead segment and writes the first-touch email, the two follow-ups and the SMS. Saves each one as a reusable script, personalized per lead at send time.',
    inputs: [
      { key: 'segment', label: 'Segment', placeholder: 'Roofers with no website', required: true },
      { key: 'offer', label: 'Your offer', type: 'textarea',
        placeholder: 'A 5-page site live in 72 hours for $1,500 plus $99/mo hosting', required: true },
      { key: 'tone', label: 'Tone', placeholder: 'Direct, no fluff, one clear ask' },
    ],
  },
  {
    id: 'call-closer',
    name: 'Call Closer',
    emoji: '📞',
    tagline: 'Preps and scripts your calls',
    description:
      'Builds the call script, the objection table and a one-page prep sheet for each lead you are about to dial. Reads the lead history so you never open cold.',
    inputs: [
      { key: 'lead_id', label: 'Lead ID (optional)', placeholder: '142' },
      { key: 'segment', label: 'Segment', placeholder: 'Home services, owner-operator' },
      { key: 'goal', label: 'Call goal', placeholder: 'Book a 20 minute demo', default: 'Book a discovery call' },
    ],
  },
  {
    id: 'booking-agent',
    name: 'Booking Agent',
    emoji: '📅',
    tagline: 'Chases the calendar',
    description:
      'Watches bookings and callbacks. Drafts confirmations, day-before reminders and no-show recovery, and flags every lead whose next action is overdue.',
    inputs: [
      { key: 'window', label: 'Look ahead (days)', type: 'number', default: 7 },
      { key: 'action', label: 'What to do', placeholder: 'Draft reminders and list overdue follow-ups' },
    ],
  },
  {
    id: 'onboarding-agent',
    name: 'Onboarding Agent',
    emoji: '📋',
    tagline: 'Turns form answers into a build brief',
    description:
      'Reads a submitted onboarding form, fills the gaps, and writes a complete build brief to briefs/ that the Site Builder can work from without asking you anything.',
    inputs: [
      { key: 'response_id', label: 'Response ID', placeholder: '7', required: true },
      { key: 'notes', label: 'Anything else it should know', type: 'textarea' },
    ],
  },
  {
    id: 'site-builder',
    name: 'Site Builder',
    emoji: '🏗️',
    tagline: 'Builds the client site',
    description:
      'Takes a build brief and produces the actual site: copy, pages, styling and a deploy-ready folder. This is the part you used to pay an agency for.',
    inputs: [
      { key: 'brief', label: 'Brief file', placeholder: 'briefs/007-northside-roofing.md', required: true },
      { key: 'stack', label: 'Stack', placeholder: 'Static HTML + CSS', default: 'Static HTML + CSS' },
      { key: 'pages', label: 'Pages', placeholder: 'Home, Services, About, Reviews, Contact' },
    ],
  },
];

export const agentById = (id) => AGENTS.find((a) => a.id === id) || null;

const QUEUE_DIR = join(ROOT, 'agent-queue');
const BRIEF_DIR = join(ROOT, 'briefs');
mkdirSync(QUEUE_DIR, { recursive: true });
mkdirSync(BRIEF_DIR, { recursive: true });

/**
 * Queues a run and, when the Claude Code CLI is available, executes it
 * headlessly. Either way a task file lands in agent-queue/ so the run can
 * be picked up by hand inside Claude Code.
 */
export function queueRun({ agent, task, input = {} }) {
  const def = agentById(agent);
  if (!def) throw new Error(`Unknown agent: ${agent}`);

  const res = run('INSERT INTO agent_runs (agent, task, input_json, status) VALUES (?, ?, ?, ?)', [
    agent, task, JSON.stringify(input), 'queued',
  ]);
  const id = Number(res.lastInsertRowid);

  const prompt = buildPrompt(def, task, input);
  const filename = `${String(id).padStart(4, '0')}-${agent}.md`;
  const path = join(QUEUE_DIR, filename);
  writeFileSync(path, prompt, 'utf8');
  run('UPDATE agent_runs SET queue_path = ? WHERE id = ?', [`agent-queue/${filename}`, id]);

  const settings = allSettings();
  if (settings.agents_enabled === '1') {
    execute(id, settings.claude_bin || 'claude', prompt, `agent-queue/${filename}`).catch((err) => {
      run("UPDATE agent_runs SET status = 'failed', output = ?, finished_at = datetime('now') WHERE id = ?", [
        String(err.message), id,
      ]);
    });
  }

  return getRun(id);
}

function buildPrompt(def, task, input) {
  const lines = [
    `# Agent task: ${def.name}`,
    '',
    `Use the \`${def.id}\` subagent for this. Its full instructions live in \`.claude/agents/${def.id}.md\`.`,
    '',
    '## What to do',
    '',
    task || def.tagline,
    '',
    '## Inputs',
    '',
  ];
  const entries = Object.entries(input).filter(([, v]) => v !== '' && v != null);
  if (entries.length === 0) lines.push('_none supplied_');
  for (const [k, v] of entries) lines.push(`- **${k}**: ${v}`);
  lines.push(
    '',
    '## Where things live',
    '',
    '- Database: `data/ghl.db` (SQLite). Read it with `sqlite3` or the helpers in `server/lib/db.js`.',
    '- Local API: `http://localhost:' + (process.env.PORT || 4000) + '/api` (see `README.md` for endpoints).',
    '- Build briefs: `briefs/`',
    '',
    'Write your result back into the database where it belongs (leads, scripts, briefs)',
    'and finish with a short plain-text summary of what changed.'
  );
  return lines.join('\n');
}

/**
 * Finds the real path of a command. On Windows the Claude Code CLI is a
 * .cmd shim, and `claude` alone is not a file Node can spawn — hence
 * ENOENT even when it works perfectly in a terminal.
 */
function resolveBin(bin) {
  if (bin.includes('/') || bin.includes('\\')) return bin;
  const finder = process.platform === 'win32' ? 'where' : 'which';
  try {
    const out = execFileSync(finder, [bin], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const first = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0];
    return first || bin;
  } catch {
    return bin;
  }
}

function execute(id, bin, prompt, queueRelPath) {
  return new Promise((resolve, reject) => {
    run("UPDATE agent_runs SET status = 'running', started_at = datetime('now') WHERE id = ?", [id]);

    const resolved = resolveBin(bin);
    // A .cmd or .bat can only be launched through a shell, and Node 22
    // refuses to do it any other way. Everything on that command line is
    // therefore generated here — the task text lives in the queue file,
    // never in an argument — so there is nothing to quote wrongly.
    const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved);
    const instruction = queueRelPath
      ? `Read ${queueRelPath} and carry out the task described in it.`
      : prompt;

    let child;
    try {
      child = spawn(
        needsShell ? `"${resolved}"` : resolved,
        ['-p', needsShell ? `"${instruction}"` : instruction, '--permission-mode', 'acceptEdits'],
        {
          cwd: ROOT,
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: needsShell,
        }
      );
    } catch (err) {
      run("UPDATE agent_runs SET status = 'needs_manual_run', output = ?, finished_at = datetime('now') WHERE id = ?", [
        `Could not launch "${bin}". The task file is queued in agent-queue/ — open it in Claude Code to run it.`, id,
      ]);
      return resolve();
    }

    let out = '';
    let err = '';
    let settled = false;
    const cap = 200_000;
    child.stdout.on('data', (d) => { if (out.length < cap) out += d.toString(); });
    child.stderr.on('data', (d) => { if (err.length < cap) err += d.toString(); });

    const finish = (status, output) => {
      if (settled) return;
      settled = true;
      clearTimeout(killer);
      run("UPDATE agent_runs SET status = ?, output = ?, finished_at = datetime('now') WHERE id = ?", [
        status, String(output).slice(0, cap), id,
      ]);
      resolve();
    };

    // A missing binary fires 'error' and then 'close', so 'error' has to win.
    child.on('error', (e) => {
      finish(
        'needs_manual_run',
        `Could not run "${bin}" (${e.code || e.message}).\n\n` +
        (process.platform === 'win32'
          ? 'On Windows, open a terminal and run `where claude`. Paste the full path it prints ' +
            '(something ending in claude.cmd) into Settings > Agents > Claude Code binary.\n\n'
          : 'Run `which claude` in a terminal and paste the full path into ' +
            'Settings > Agents > Claude Code binary.\n\n') +
        `Either way the task is saved in ${queueRelPath || 'agent-queue/'} — ` +
        'open that file in Claude Code and it will run.'
      );
    });

    child.on('close', (code) => {
      if (code === 0) return finish('done', out || 'Finished with no output.');
      finish('failed', (out + (err ? `\n\n[stderr]\n${err}` : '')) || `Exited with code ${code}.`);
    });

    // Don't let a stuck agent hold a slot forever.
    const killer = setTimeout(() => {
      child.kill('SIGTERM');
      finish('failed', 'Timed out after 15 minutes.');
    }, 15 * 60 * 1000);
    killer.unref?.();
  });
}

/**
 * Works out whether the Claude Code CLI can actually be launched from
 * here, and says why not in terms of what to do about it. Guessing at a
 * PATH problem from an ENOENT is not much help on its own.
 */
export async function diagnoseBin(bin) {
  const resolved = resolveBin(bin);
  const found = resolved !== bin || bin.includes('/') || bin.includes('\\');
  const win = process.platform === 'win32';

  if (!found) {
    return {
      ok: false,
      resolved: null,
      message:
        `Cannot find "${bin}" from where the app is running.\n\n` +
        `1. Open a terminal and run: ${win ? 'where claude' : 'which claude'}\n` +
        '2. If it prints a path, paste that whole path into the box above and save.\n' +
        '3. If it prints nothing, Claude Code is not installed on this machine. ' +
        'Install it with:  npm install -g @anthropic-ai/claude-code\n\n' +
        'The agents need the CLI on the same machine as this app. Everything else ' +
        'in ghl-mini works without it.',
    };
  }

  const needsShell = win && /\.(cmd|bat)$/i.test(resolved);
  return new Promise((resolve) => {
    let out = '';
    const child = spawn(needsShell ? `"${resolved}"` : resolved, ['--version'], {
      cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], shell: needsShell,
    });
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('error', (e) => resolve({
      ok: false, resolved,
      message: `Found it at ${resolved} but could not start it (${e.code || e.message}).`,
    }));
    child.on('close', (code) => resolve(
      code === 0
        ? { ok: true, resolved, version: out.trim().split('\n')[0], message: `Claude Code is ready: ${out.trim().split('\n')[0]}` }
        : { ok: false, resolved, message: `Found it at ${resolved} but it exited with code ${code}. ${out.trim().slice(0, 200)}` }
    ));
    setTimeout(() => { child.kill(); }, 15000).unref?.();
  });
}

export function getRun(id) {
  const row = get('SELECT * FROM agent_runs WHERE id = ?', [id]);
  if (!row) return null;
  return { ...row, input: JSON.parse(row.input_json || '{}') };
}

export function listRuns({ agent = null, limit = 50 } = {}) {
  const sql = agent
    ? 'SELECT * FROM agent_runs WHERE agent = ? ORDER BY id DESC LIMIT ?'
    : 'SELECT * FROM agent_runs ORDER BY id DESC LIMIT ?';
  const params = agent ? [agent, limit] : [limit];
  return all(sql, params).map((r) => ({ ...r, input: JSON.parse(r.input_json || '{}') }));
}

export function agentStats() {
  const rows = all(
    `SELECT agent, status, COUNT(*) AS n FROM agent_runs GROUP BY agent, status`
  );
  const byAgent = {};
  for (const r of rows) {
    byAgent[r.agent] ??= { total: 0, done: 0, running: 0, failed: 0, queued: 0 };
    byAgent[r.agent].total += r.n;
    if (r.status === 'done') byAgent[r.agent].done += r.n;
    else if (r.status === 'running') byAgent[r.agent].running += r.n;
    else if (r.status === 'failed') byAgent[r.agent].failed += r.n;
    else byAgent[r.agent].queued += r.n;
  }
  return byAgent;
}
