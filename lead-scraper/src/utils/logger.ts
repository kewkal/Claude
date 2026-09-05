/**
 * Small structured console logger. Debug output is opt-in so a normal run
 * stays readable: one line per lead, not a wall of HTML.
 */

let debugEnabled = false;

export function setDebug(enabled: boolean): void {
  debugEnabled = enabled;
}

export function isDebug(): boolean {
  return debugEnabled;
}

function write(stream: NodeJS.WriteStream, message: string): void {
  stream.write(`${message}\n`);
}

export const log = {
  /** Section marker, e.g. `[DISCOVERY] Found 84 candidate businesses`. */
  stage(stage: string, message: string): void {
    write(process.stdout, `[${stage.toUpperCase()}] ${message}`);
  },

  /** Per-lead progress, e.g. `[12/84] Acme Roofing — enriching`. */
  lead(index: number, total: number, name: string, message: string): void {
    write(process.stdout, `[${index}/${total}] ${name} — ${message}`);
  },

  info(message: string): void {
    write(process.stdout, message);
  },

  warn(message: string): void {
    write(process.stderr, `[WARN] ${message}`);
  },

  error(message: string): void {
    write(process.stderr, `[ERROR] ${message}`);
  },

  debug(message: string): void {
    if (debugEnabled) write(process.stderr, `[DEBUG] ${message}`);
  },
};

/** Normalise any thrown value into a short message suitable for a log line. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause;
    if (cause instanceof Error && cause.message !== error.message) {
      return `${error.message} (${cause.message})`;
    }
    return error.message;
  }
  if (typeof error === 'string') return error;
  return JSON.stringify(error);
}
