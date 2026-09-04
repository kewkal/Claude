import { get, run } from './db.js';
import { allSettings } from './settings.js';
import { dueJobs, runJob, sweepBookings, sweepTriggers } from './automations.js';

const TICK_MS = Number(process.env.SCHEDULER_TICK_MS) || 60_000;

let timer = null;
let ticking = false;
export const stats = { ticks: 0, jobsRun: 0, lastTick: null, lastError: null, running: false };

/**
 * One pass: queue anything newly due, then run what is due now.
 * Everything it does is idempotent, so a missed tick or a restart
 * mid-tick costs nothing.
 */
export async function tick() {
  if (ticking) return stats;
  ticking = true;
  try {
    if (allSettings().scheduler_enabled !== '1') {
      stats.lastTick = new Date().toISOString();
      return stats;
    }
    sweepBookings();
    sweepTriggers();

    const jobs = dueJobs(25);
    for (const job of jobs) {
      await runJob(job);
      stats.jobsRun++;
    }

    // Housekeeping: drop job history older than 30 days.
    run("DELETE FROM scheduled_jobs WHERE status IN ('done','cancelled','failed') AND ran_at < datetime('now','-30 days')");

    stats.ticks++;
    stats.lastTick = new Date().toISOString();
    stats.lastError = null;
  } catch (err) {
    stats.lastError = String(err.message);
    console.error('[scheduler] tick failed:', err.message);
  } finally {
    ticking = false;
  }
  return stats;
}

export function start() {
  if (timer) return;
  stats.running = true;
  // Give the server a moment to finish booting before the first pass.
  setTimeout(() => { tick(); }, 3000).unref?.();
  timer = setInterval(tick, TICK_MS);
  timer.unref?.();
  console.log(`[scheduler] running every ${Math.round(TICK_MS / 1000)}s`);
}

export function stop() {
  clearInterval(timer);
  timer = null;
  stats.running = false;
}

export function pending() {
  return get("SELECT COUNT(*) AS n FROM scheduled_jobs WHERE status = 'pending'").n;
}
