#!/usr/bin/env node
/**
 * Account recovery. The owner account is created once, on first boot, from
 * whatever .env said at that moment — editing .env later does not change it,
 * which is an easy way to lock yourself out of your own app.
 *
 *   node server/account.js                       list accounts
 *   node server/account.js <email>               set a random password
 *   node server/account.js <email> <password>    set that password
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// .env holds GHL_SECRET, which the settings table is encrypted with.
const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    if (process.env[k] === undefined) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
}

const { all, get, run } = await import('./lib/db.js');
const { hashPassword } = await import('./lib/crypto.js');

const [emailArg, passwordArg] = process.argv.slice(2);

if (!emailArg) {
  const users = all('SELECT id, email, created_at FROM users ORDER BY id');
  if (!users.length) {
    console.log('\n  No accounts yet. Start the app once and it creates one.\n');
  } else {
    console.log('\n  Accounts on this install:\n');
    for (const u of users) console.log(`    ${u.email}   (created ${u.created_at})`);
    console.log('\n  Forgotten the password? Set a new one:');
    console.log(`    node server/account.js ${users[0].email}\n`);
  }
  process.exit(0);
}

const email = String(emailArg).toLowerCase().trim();
const password = passwordArg || randomPassword();
const { hash, salt } = hashPassword(password);
const existing = get('SELECT id FROM users WHERE email = ?', [email]);

if (existing) {
  run('UPDATE users SET pw_hash = ?, pw_salt = ? WHERE id = ?', [hash, salt, existing.id]);
  run('DELETE FROM sessions WHERE user_id = ?', [existing.id]);
} else {
  run('INSERT INTO users (email, pw_hash, pw_salt, name) VALUES (?, ?, ?, ?)', [email, hash, salt, 'Owner']);
}

const W = 58;
const rule = '─'.repeat(W);
const row = (text) => `  │ ${text.padEnd(W - 1)}│`;
console.log([
  '',
  `  ┌${rule}┐`,
  row(existing ? 'Updated the sign-in for this account.' : 'Created a new account.'),
  `  ├${rule}┤`,
  row(`Email     ${email}`),
  row(`Password  ${password}`),
  `  └${rule}┘`,
  '',
].join('\n'));

function randomPassword() {
  const words = ['anchor','basin','cedar','delta','ember','fjord','gravel','harbor',
    'ivory','jetty','kettle','lantern','marble','nickel','onyx','pebble',
    'quarry','ridge','summit','timber','umber','valley','willow','zinc'];
  const pick = () => words[crypto.randomInt(words.length)];
  return `${pick()}-${pick()}-${pick()}-${crypto.randomInt(100, 999)}`;
}
