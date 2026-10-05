import { json, dbCheck, getSessionToken, sessionCookie } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  const noDb = dbCheck(env);
  if (noDb) return noDb;
  const token = getSessionToken(request);
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  }
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('deleted') });
}
