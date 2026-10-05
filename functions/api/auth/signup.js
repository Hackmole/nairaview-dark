import { json, newSalt, hashPassword, validEmail, dbCheck, createSession, sessionCookie } from '../_lib.js';

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
  if (!validEmail(email)) return json({ error: 'Enter a valid email address.' }, 400);
  if (typeof password !== 'string' || password.length < 8)
    return json({ error: 'Password must be at least 8 characters.' }, 400);

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return json({ error: 'An account with this email already exists. Try logging in.' }, 409);

  const id = crypto.randomUUID();
  const salt = newSalt();
  const pwHash = await hashPassword(password, salt);
  await env.DB.prepare('INSERT INTO users (id, email, pw_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, email, pwHash, salt, Date.now())
    .run();

  const { token } = await createSession(env, id);
  return json(
    { ok: true, email },
    200,
    { 'Set-Cookie': sessionCookie(token, 30 * 24 * 3600) }
  );
}
