// Shared helpers for Nairaview API functions (not routed: underscore prefix).
const enc = new TextEncoder();

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, extraHeaders),
  });
}

export function newSalt() {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashPassword(password, saltHex) {
  const salt = Uint8Array.from(saltHex.match(/../g).map((b) => parseInt(b, 16)));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key,
    256
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function sessionCookie(token, maxAge) {
  const parts = [`nv_sess=${token}`, 'HttpOnly', 'Secure', 'SameSite=None', 'Path=/'];
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  else parts.push('Max-Age=0');
  return parts.join('; ');
}

export function getSessionToken(req) {
  const cookie = req.headers.get('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)nv_sess=([^;]+)/);
  return m ? m[1] : null;
}

export function validEmail(e) {
  return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim()) && e.length <= 120;
}

export function dbCheck(env) {
  if (!env.DB) return json({ error: 'Database not connected yet.' }, 503);
  return null;
}

// Returns the logged-in user row {id, email} or null.
export async function getUser(env, req) {
  const token = getSessionToken(req);
  if (!token) return null;
  const row = await env.DB.prepare(
    'SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?'
  )
    .bind(token, Date.now())
    .first();
  return row || null;
}

export async function createSession(env, userId) {
  const token = crypto.randomUUID() + '.' + crypto.randomUUID().replace(/-/g, '');
  const expiresAt = Date.now() + 30 * 24 * 3600 * 1000;
  await env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, userId, expiresAt)
    .run();
  return { token, expiresAt };
}
