import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';

/**
 * First run used to stop and tell you to go edit a hidden file. That is a
 * dead end: the file does not exist yet, the OS hides it, and nothing is
 * running to tell you otherwise. Now it writes a working .env with a
 * random secret and a random password, and carries on booting.
 */
export function ensureEnvFile(root) {
  const envPath = join(root, '.env');
  if (existsSync(envPath)) return { created: false, path: envPath };

  const examplePath = join(root, '.env.example');
  const secret = crypto.randomBytes(32).toString('hex');
  const password = generatePassword();

  let body = existsSync(examplePath) ? readFileSync(examplePath, 'utf8') : '';
  if (!body) {
    body = [
      'PORT=4000', 'PUBLIC_URL=http://localhost:4000', 'GHL_SECRET=', 'OWNER_EMAIL=',
      'OWNER_PASSWORD=', 'AUTH_DISABLED=false', 'GOOGLE_MAPS_API_KEY=',
      'TWILIO_ACCOUNT_SID=', 'TWILIO_AUTH_TOKEN=', 'TWILIO_FROM_NUMBER=',
      'EMAIL_PROVIDER=none', 'EMAIL_API_KEY=', 'EMAIL_FROM=', 'MAILGUN_DOMAIN=',
      'CLAUDE_BIN=claude', '',
    ].join('\n');
  }

  body = setKey(body, 'GHL_SECRET', secret);
  body = setKey(body, 'OWNER_EMAIL', 'owner@localhost');
  body = setKey(body, 'OWNER_PASSWORD', password);

  writeFileSync(envPath, body, 'utf8');
  return { created: true, path: envPath, email: 'owner@localhost', password };
}

function setKey(body, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  return re.test(body) ? body.replace(re, line) : `${body.trimEnd()}\n${line}\n`;
}

/** Readable but not guessable: three words plus digits. */
function generatePassword() {
  const words = [
    'anchor', 'basin', 'cedar', 'delta', 'ember', 'fjord', 'gravel', 'harbor',
    'ivory', 'jetty', 'kettle', 'lantern', 'marble', 'nickel', 'onyx', 'pebble',
    'quarry', 'ridge', 'summit', 'timber', 'umber', 'valley', 'willow', 'zinc',
  ];
  const pick = () => words[crypto.randomInt(words.length)];
  return `${pick()}-${pick()}-${pick()}-${crypto.randomInt(100, 999)}`;
}

export function firstRunBanner({ email, password, port }) {
  const W = 58;
  const rule = '─'.repeat(W);
  // Pad by character count, not by hand — an em dash in the text throws
  // off any hardcoded spacing.
  const row = (text) => `  │ ${text.padEnd(W - 1)}│`;
  return [
    '',
    `  ┌${rule}┐`,
    row('FIRST RUN — write these down.'),
    `  ├${rule}┤`,
    row(`Open      http://localhost:${port}`),
    row(`Email     ${email}`),
    row(`Password  ${password}`),
    `  ├${rule}┤`,
    row('Change the password in Settings once you are in.'),
    row('They are also saved in the .env file beside start.sh.'),
    `  └${rule}┘`,
    '',
  ].join('\n');
}
