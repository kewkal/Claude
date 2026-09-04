import crypto from 'node:crypto';

const SECRET = process.env.GHL_SECRET || 'ghl-mini-insecure-default-change-me';

function key() {
  return crypto.createHash('sha256').update(SECRET).digest();
}

/** AES-256-GCM encrypt. Returns "iv.tag.ciphertext" base64url. */
export function encrypt(plain) {
  if (plain == null || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString('base64url')).join('.');
}

export function decrypt(payload) {
  if (!payload) return '';
  try {
    const [ivB, tagB, dataB] = String(payload).split('.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return '';
  }
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, hash, salt) {
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

export function token(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Mask a secret for display: keeps last 4 chars. */
export function mask(value) {
  if (!value) return '';
  const s = String(value);
  if (s.length <= 4) return '****';
  return '••••••••' + s.slice(-4);
}
