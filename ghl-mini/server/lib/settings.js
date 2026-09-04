import { all, get, run } from './db.js';
import { encrypt, decrypt, mask } from './crypto.js';

/**
 * Keys marked secret are encrypted at rest and never returned in full
 * to the browser.
 */
export const SECRET_KEYS = new Set([
  'google_maps_api_key',
  'twilio_auth_token',
  'email_api_key',
]);

export const DEFAULTS = {
  business_name: 'My Agency',
  owner_name: '',
  owner_email: '',
  timezone: 'America/New_York',
  currency: 'USD',
  public_url: process.env.PUBLIC_URL || 'http://localhost:4000',

  google_maps_api_key: process.env.GOOGLE_MAPS_API_KEY || '',
  default_search_radius_m: '25000',

  twilio_account_sid: process.env.TWILIO_ACCOUNT_SID || '',
  twilio_auth_token: process.env.TWILIO_AUTH_TOKEN || '',
  twilio_from_number: process.env.TWILIO_FROM_NUMBER || '',

  email_provider: process.env.EMAIL_PROVIDER || 'none',
  email_api_key: process.env.EMAIL_API_KEY || '',
  email_from: process.env.EMAIL_FROM || '',
  mailgun_domain: process.env.MAILGUN_DOMAIN || '',

  claude_bin: process.env.CLAUDE_BIN || 'claude',
  agents_enabled: '1',

  // --- Automations ---
  scheduler_enabled: '1',
  // Where missed calls get forwarded before the text-back fires.
  owner_phone: '',
  // US TCPA puts texting between 8am and 9pm local. Jobs due outside the
  // window are deferred to the next opening, never dropped.
  quiet_start: '08:00',
  quiet_end: '21:00',

  automation_missed_call: '0',
  automation_missed_call_body:
    "Hi, this is {{business_name}} — sorry I missed your call. I'm on a job right now. What do you need a hand with? Text me here and I'll come straight back to you.",

  automation_reminder: '1',
  automation_reminder_hours: '24',
  automation_reminder_sms: '1',
  automation_reminder_email: '1',
  automation_reminder_body:
    "Hi {{name}}, {{owner_name}} from {{business_name}} here. Confirming our call {{when}}. I'll ring you on this number. Reply here if you need to move it.",

  automation_no_show: '1',
  automation_no_show_minutes: '15',
  automation_no_show_body:
    "Hi {{name}}, tried you just now for our call and couldn't get through — no problem at all. Does tomorrow morning or Thursday afternoon suit you better?",

  automation_sequences: '1',

  booking_title: 'Discovery call',
  booking_duration_min: '30',
  daily_target_hours: '6',
  daily_call_target: '40',
};

export function getSetting(key, fallback = '') {
  const row = get('SELECT value, encrypted FROM settings WHERE key = ?', [key]);
  if (!row) return DEFAULTS[key] ?? fallback;
  const value = row.encrypted ? decrypt(row.value) : row.value;
  if (value === '' || value == null) return DEFAULTS[key] ?? fallback;
  return value;
}

export function setSetting(key, value) {
  const isSecret = SECRET_KEYS.has(key);
  const stored = isSecret ? encrypt(value) : String(value ?? '');
  run(
    `INSERT INTO settings (key, value, encrypted, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value,
       encrypted = excluded.encrypted, updated_at = datetime('now')`,
    [key, stored, isSecret ? 1 : 0]
  );
  return value;
}

/** Every setting, with secrets masked. Safe to send to the browser. */
export function publicSettings() {
  const stored = Object.fromEntries(
    all('SELECT key, value, encrypted FROM settings').map((r) => [
      r.key,
      r.encrypted ? decrypt(r.value) : r.value,
    ])
  );
  const merged = { ...DEFAULTS, ...Object.fromEntries(Object.entries(stored).filter(([, v]) => v !== '')) };
  const out = {};
  for (const [k, v] of Object.entries(merged)) {
    out[k] = SECRET_KEYS.has(k) ? mask(v) : v;
  }
  out._configured = {
    google_maps: Boolean(merged.google_maps_api_key),
    twilio: Boolean(merged.twilio_account_sid && merged.twilio_auth_token && merged.twilio_from_number),
    email: merged.email_provider !== 'none' && Boolean(merged.email_api_key && merged.email_from),
    agents: merged.agents_enabled === '1',
  };
  return out;
}

/** Raw values including secrets. Server side only. */
export function allSettings() {
  const stored = Object.fromEntries(
    all('SELECT key, value, encrypted FROM settings').map((r) => [
      r.key,
      r.encrypted ? decrypt(r.value) : r.value,
    ])
  );
  return { ...DEFAULTS, ...Object.fromEntries(Object.entries(stored).filter(([, v]) => v !== '')) };
}
