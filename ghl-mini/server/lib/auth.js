import { get, run } from './db.js';
import { hashPassword, verifyPassword, token } from './crypto.js';
import { parseCookies, setCookie, unauthorized } from './http.js';

const COOKIE = 'ghl_session';
const TTL_DAYS = 30;

export const authDisabled = () => String(process.env.AUTH_DISABLED || '').toLowerCase() === 'true';

/**
 * Creates the owner account on first boot only. It is never updated
 * afterwards, so editing OWNER_* in .env later changes nothing — which is
 * why the caller needs to know whether an account was just created, and
 * with which password, in order to show the right thing on screen.
 */
export function ensureOwner() {
  const existing = get('SELECT id, email FROM users LIMIT 1');
  if (existing) return { ...existing, created: false };

  const email = (process.env.OWNER_EMAIL || 'owner@localhost').toLowerCase();
  const password = process.env.OWNER_PASSWORD || 'changeme';
  const { hash, salt } = hashPassword(password);
  const res = run('INSERT INTO users (email, pw_hash, pw_salt, name) VALUES (?, ?, ?, ?)', [
    email, hash, salt, 'Owner',
  ]);
  return { id: Number(res.lastInsertRowid), email, password, created: true };
}

export function login(email, password) {
  const user = get('SELECT * FROM users WHERE email = ?', [String(email || '').toLowerCase()]);
  if (!user) return null;
  if (!verifyPassword(String(password || ''), user.pw_hash, user.pw_salt)) return null;
  const t = token();
  const expires = new Date(Date.now() + TTL_DAYS * 864e5).toISOString();
  run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', [t, user.id, expires]);
  run("DELETE FROM sessions WHERE expires_at < datetime('now')");
  return { token: t, user: { id: user.id, email: user.email, name: user.name } };
}

export function logout(req, res) {
  const t = parseCookies(req)[COOKIE];
  if (t) run('DELETE FROM sessions WHERE token = ?', [t]);
  setCookie(res, COOKIE, '', { maxAge: 0 });
}

export function attachSession(res, sessionToken) {
  setCookie(res, COOKIE, sessionToken, { maxAge: TTL_DAYS * 86400 });
}

export function currentUser(req) {
  if (authDisabled()) return { id: 0, email: 'local@localhost', name: 'Local' };
  const t = parseCookies(req)[COOKIE];
  if (!t) return null;
  const row = get(
    `SELECT u.id, u.email, u.name FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > datetime('now')`,
    [t]
  );
  return row || null;
}

export function requireUser(req) {
  const user = currentUser(req);
  if (!user) throw unauthorized();
  return user;
}

export function changePassword(userId, newPassword) {
  const { hash, salt } = hashPassword(newPassword);
  run('UPDATE users SET pw_hash = ?, pw_salt = ? WHERE id = ?', [hash, salt, userId]);
  run('DELETE FROM sessions WHERE user_id = ?', [userId]);
}
