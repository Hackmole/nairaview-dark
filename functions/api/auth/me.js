import { json, dbCheck, getUser } from '../_lib.js';

export async function onRequestGet({ request, env }) {
  const noDb = dbCheck(env);
  if (noDb) return noDb;
  const user = await getUser(env, request);
  if (!user) return json({ error: 'Not signed in.' }, 401);
  return json({ email: user.email });
}
