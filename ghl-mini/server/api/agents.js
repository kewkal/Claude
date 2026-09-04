import { Router, json, bad, notFound } from '../lib/http.js';
import { AGENTS, agentById, queueRun, getRun, listRuns, agentStats } from '../lib/agents.js';
import { run as dbRun } from '../lib/db.js';

const router = new Router();

/** GET /api/agents — the six agents plus their run counts. */
router.get('/api/agents', ({ res }) => {
  const stats = agentStats();
  json(res, {
    agents: AGENTS.map((a) => ({ ...a, stats: stats[a.id] || { total: 0, done: 0, running: 0, failed: 0, queued: 0 } })),
  });
});

router.get('/api/agents/runs', ({ res, query }) => {
  json(res, { runs: listRuns({ agent: query.agent || null, limit: Number(query.limit) || 50 }) });
});

router.get('/api/agents/runs/:id', ({ res, params }) => {
  const found = getRun(Number(params.id));
  if (!found) throw notFound('Run not found');
  json(res, { run: found });
});

router.delete('/api/agents/runs/:id', ({ res, params }) => {
  const info = dbRun('DELETE FROM agent_runs WHERE id = ?', [params.id]);
  if (!info.changes) throw notFound('Run not found');
  json(res, { deleted: true });
});

/** POST /api/agents/:id/run */
router.post('/api/agents/:id/run', ({ res, params, body }) => {
  const def = agentById(params.id);
  if (!def) throw notFound(`No agent called "${params.id}"`);
  for (const field of def.inputs.filter((f) => f.required)) {
    if (!body[field.key] && !body.input?.[field.key]) {
      throw bad(`"${field.label}" is required for ${def.name}`);
    }
  }
  const input = body.input || Object.fromEntries(def.inputs.map((f) => [f.key, body[f.key] ?? f.default ?? '']));
  const queued = queueRun({ agent: def.id, task: body.task || def.tagline, input });
  json(res, { run: queued }, 202);
});

export default router;
