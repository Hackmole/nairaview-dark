/* Shared /api/fx fetch with a module-level cache so the converter and the
   three currency sections on the FX page make exactly one request. */
import { getJSON } from './api.js';
import type { FxDoc } from './types.js';

let cached: Promise<FxDoc> | null = null;

export function getFx(): Promise<FxDoc> {
  if (!cached) {
    cached = getJSON<FxDoc>('/api/fx').then((doc) => doc || {}).catch(() => {
      cached = null; /* allow a retry on the next mount */
      return {} as FxDoc;
    });
  }
  return cached;
}

export function fmtFx(n: number | null | undefined): string {
  return '₦' + Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtFxDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.length <= 10 ? iso + 'T12:00:00Z' : iso);
  if (isNaN(d.getTime())) return '—';
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return d.getUTCDate() + ' ' + M[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}
