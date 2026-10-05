import { json, hashPassword, validEmail, dbCheck, createSession, sessionCookie } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  const noDb = dbCheck(env);
  if (noDb) return noDb;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  if (!validEmail(email) || typeof password !== 'string' || !password)
    return json({ error: 'Enter your email and password.' }, 400);

  const user = await env.DB.prepare('SELECT id, pw_hash, salt FROM users WHERE email = ?').bind(email).first();
  if (!user) return json({ error: 'No account found with this email.' }, 401);
  const attempt = await hashPassword(password, user.salt);
  // Constant-time-ish compare on equal-length hex strings.
  let match = attempt.length === user.pw_hash.length;
  for (let i = 0; i < attempt.length && i < user.pw_hash.length; i++) {
    if (attempt[i] !== user.pw_hash[i]) match = false;
  }
  if (!match) return json({ error: 'Incorrect password.' }, 401);

  const { token } = await createSession(env, user.id);
  return json(
    { ok: true, email },
    200,
    { 'Set-Cookie': sessionCookie(token, 30 * 24 * 3600) }
  );
}
