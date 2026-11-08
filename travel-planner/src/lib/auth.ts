// Session cookie = "<expiresAtMs>.<hex HMAC-SHA256(expiresAtMs)>".
// Uses Web Crypto so it runs identically in proxy.ts and route handlers.

export const SESSION_COOKIE = "tp_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const enc = new TextEncoder();

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionToken(secret: string, now = Date.now()): Promise<string> {
  const exp = String(now + SESSION_TTL_MS);
  return `${exp}.${await hmacHex(secret, exp)}`;
}

export async function verifySessionToken(
  token: string | undefined,
  secret: string | undefined,
  now = Date.now(),
): Promise<boolean> {
  if (!token || !secret) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) < now) return false;
  return timingSafeEqual(sig, await hmacHex(secret, exp));
}

// Compare passwords via HMAC so the comparison is constant-time regardless of length.
export async function passwordMatches(input: string, expected: string, secret: string): Promise<boolean> {
  const [a, b] = await Promise.all([hmacHex(secret, `pw:${input}`), hmacHex(secret, `pw:${expected}`)]);
  return timingSafeEqual(a, b);
}
