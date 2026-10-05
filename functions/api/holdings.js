import { json, dbCheck, getUser } from './_lib.js';

function cleanTicker(t) {
  const s = String(t || '').trim().toUpperCase();
  return /^[A-Z0-9]{2,12}$/.test(s) ? s : null;
}

export async function onRequestGet({ request, env }) {
  const noDb = dbCheck(env);
  if (noDb) return noDb;
  const user = await getUser(env, request);
  if (!user) return json({ error: 'Sign in to view your portfolio.' }, 401);
  const { results } = await env.DB.prepare(
    'SELECT ticker, shares, avg_cost, updated_at FROM holdings WHERE user_id = ? ORDER BY ticker'
  )
    .bind(user.id)
    .all();
  return json({ holdings: results || [] });
}

export async function onRequestPost({ request, env }) {
  const noDb = dbCheck(env);
  if (noDb) return noDb;
  const user = await getUser(env, request);
  if (!user) return json({ error: 'Sign in to update your portfolio.' }, 401);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  const ticker = cleanTicker(body.ticker);
  const shares = Number(body.shares);
  const avgCost = Number(body.avg_cost);
  if (!ticker) return json({ error: 'Enter a valid NGX ticker (e.g. GTCO).' }, 400);
  if (!Number.isFinite(shares) || shares <= 0) return json({ error: 'Shares must be a positive number.' }, 400);
  if (!Number.isFinite(avgCost) || avgCost < 0) return json({ error: 'Average cost must be zero or more.' }, 400);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO holdings (id, user_id, ticker, shares, avg_cost, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, ticker) DO UPDATE SET shares = excluded.shares, avg_cost = excluded.avg_cost, updated_at = excluded.updated_at`
  )
    .bind(id, user.id, ticker, shares, avgCost, Date.now())
    .run();
  return json({ ok: true, ticker, shares, avg_cost: avgCost });
}

export async function onRequestDelete({ request, env }) {
  const noDb = dbCheck(env);
  if (noDb) return noDb;
  const user = await getUser(env, request);
  if (!user) return json({ error: 'Sign in to update your portfolio.' }, 401);
  const url = new URL(request.url);
  const ticker = cleanTicker(url.searchParams.get('ticker'));
  if (!ticker) return json({ error: 'Missing ticker.' }, 400);
  await env.DB.prepare('DELETE FROM holdings WHERE user_id = ? AND ticker = ?').bind(user.id, ticker).run();
  return json({ ok: true, ticker });
}
