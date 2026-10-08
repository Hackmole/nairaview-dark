/* Indicator math ported from the Chart Lab vanilla implementation.
   All functions are length-adaptive: they return null for sessions that
   don't have enough history yet. */
import type { HistoryPoint } from './types.js';

export interface SanitizedPoint {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function sma(values: number[], n: number): Array<number | null> {
  const out: Array<number | null> = [];
  for (let i = 0; i < values.length; i++) {
    if (i < n - 1) { out.push(null); continue; }
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += values[j];
    out.push(s / n);
  }
  return out;
}

export function rsiWilder(closes: number[], period: number): Array<number | null> {
  const out: Array<number | null> = [];
  for (let i = 0; i < closes.length; i++) out.push(null);
  if (closes.length < period + 1) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) g += d; else l -= d;
  }
  g /= period; l /= period;
  out[period] = (l === 0) ? 100 : 100 - (100 / (1 + g / l));
  for (let k = period + 1; k < closes.length; k++) {
    const dd = closes[k] - closes[k - 1];
    const gg = dd > 0 ? dd : 0, ll = dd < 0 ? -dd : 0;
    g = (g * (period - 1) + gg) / period;
    l = (l * (period - 1) + ll) / period;
    out[k] = (l === 0) ? 100 : 100 - (100 / (1 + g / l));
  }
  return out;
}

export function ema(values: number[], n: number): Array<number | null> {
  const out: Array<number | null> = [];
  for (let i = 0; i < values.length; i++) out.push(null);
  if (values.length < n) return out;
  const k = 2 / (n + 1);
  let e = 0;
  for (let j = 0; j < n; j++) e += values[j];
  e /= n; out[n - 1] = e;
  for (let j = n; j < values.length; j++) { e = values[j] * k + e * (1 - k); out[j] = e; }
  return out;
}

export function macdCalc(closes: number[]): { line: Array<number | null>; signal: Array<number | null> } {
  const e12 = ema(closes, 12), e26 = ema(closes, 26);
  const line: Array<number | null> = [], signal: Array<number | null> = [];
  for (let i = 0; i < closes.length; i++) {
    line.push((e12[i] === null || e26[i] === null) ? null : (e12[i] as number) - (e26[i] as number));
    signal.push(null);
  }
  const vals: number[] = [], idx: number[] = [];
  for (let i = 0; i < line.length; i++) { if (line[i] !== null) { vals.push(line[i] as number); idx.push(i); } }
  const sigE = ema(vals, 9);
  for (let s = 0; s < vals.length; s++) { if (sigE[s] !== null) signal[idx[s]] = sigE[s]; }
  return { line, signal };
}

/* Normalize a raw history point: null highs/lows fall back to the candle body. */
export function sanitize(p: HistoryPoint): SanitizedPoint {
  const o = Number(p.open), c = Number(p.close);
  const h = (p.high === null || p.high === undefined) ? Math.max(o, c) : Number(p.high);
  const l = (p.low === null || p.low === undefined) ? Math.min(o, c) : Number(p.low);
  return { time: p.date, open: o, high: h, low: l, close: c, volume: Number(p.volume) || 0 };
}
