/* Shared API + formatting helpers for Nairaview React islands. */
import type { ApiStock, DirectoryRow } from './types.js';

const API = 'https://nairaview-api.meetomidiora.workers.dev';

export function getJSON<T>(path: string, timeoutMs = 12000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(API + path, { signal: ctrl.signal })
    .then((r) => {
      clearTimeout(t);
      if (!r.ok) throw new Error('bad status ' + r.status);
      return r.json() as Promise<T>;
    })
    .catch((e: unknown) => {
      clearTimeout(t);
      throw e;
    });
}

export function fmt2(n: number | null | undefined): string {
  return Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtN(n: number | null | undefined | ''): string {
  return n === null || n === undefined || n === '' ? '—' : '₦' + fmt2(n as number);
}

export function signedPct(chg: number | null | undefined): string {
  const v = Math.round(Number(chg) * 100) / 100;
  return (v > 0 ? '+' : v < 0 ? '−' : '') + fmt2(Math.abs(v)) + '%';
}

export function dirArrow(chg: number | null | undefined): string {
  const v = Number(chg);
  return v > 0 ? '▲ ' : v < 0 ? '▼ ' : '■ ';
}

/* Normalize an /api/prices stock into the directory row shape. */
export function toRow(s: ApiStock): DirectoryRow {
  const px = Number(s.current_price);
  const rawChg = s.official_change_percent != null ? s.official_change_percent : s.change_percent;
  const chg = Number(rawChg) || 0;
  return {
    s: s.symbol,
    c: s.name,
    g: s.sector || '',
    p: '₦' + fmt2(px),
    m: signedPct(chg),
    d: chg < 0 ? 'down' : 'up',
    pv: px,
    cv: Math.round(chg * 100) / 100,
    volNum: Number(s.volume) || 0,
    noSnap: false,
  };
}

export function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return map[c];
  });
}
