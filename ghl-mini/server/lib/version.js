import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Node loads server modules once, at boot. Pulling new code updates the
 * files on disk and the browser picks up the new frontend immediately —
 * but the API keeps running whatever was loaded at startup. The result is
 * a new button calling a route the running process has never heard of.
 *
 * So: fingerprint the server source at boot, compare against disk on
 * request, and say plainly when they have diverged.
 */
function newestMtime(dir) {
  let newest = 0;
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      if (!entry.name.endsWith('.js')) continue;
      try {
        const t = statSync(path).mtimeMs;
        if (t > newest) newest = t;
      } catch { /* vanished mid-walk */ }
    }
  };
  walk(dir);
  return Math.round(newest);
}

let serverDir = null;
let bootFingerprint = 0;

export function recordBoot(dir) {
  serverDir = dir;
  bootFingerprint = newestMtime(dir);
  return bootFingerprint;
}

/** Has the code on disk changed since this process started? */
export function versionState() {
  const onDisk = serverDir ? newestMtime(serverDir) : 0;
  const stale = onDisk > bootFingerprint;
  return {
    booted_at: bootFingerprint,
    on_disk: onDisk,
    stale,
    message: stale
      ? 'The app has been updated on disk but this process is still running the old code. Stop it and start it again.'
      : null,
  };
}
