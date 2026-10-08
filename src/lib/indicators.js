/* Indicator math ported from the Chart Lab vanilla implementation.
   All functions are length-adaptive: they return null for sessions that
   don't have enough history yet. */

export function sma(values, n) {
  var out = [], i, j, s;
  for (i = 0; i < values.length; i++) {
    if (i < n - 1) { out.push(null); continue; }
    s = 0;
    for (j = i - n + 1; j <= i; j++) s += values[j];
    out.push(s / n);
  }
  return out;
}

export function rsiWilder(closes, period) {
  var out = [], i, d, g, l, dd, gg, ll, k;
  for (i = 0; i < closes.length; i++) out.push(null);
  if (closes.length < period + 1) return out;
  g = 0; l = 0;
  for (i = 1; i <= period; i++) {
    d = closes[i] - closes[i - 1];
    if (d > 0) g += d; else l -= d;
  }
  g /= period; l /= period;
  out[period] = (l === 0) ? 100 : 100 - (100 / (1 + g / l));
  for (k = period + 1; k < closes.length; k++) {
    dd = closes[k] - closes[k - 1];
    gg = dd > 0 ? dd : 0; ll = dd < 0 ? -dd : 0;
    g = (g * (period - 1) + gg) / period;
    l = (l * (period - 1) + ll) / period;
    out[k] = (l === 0) ? 100 : 100 - (100 / (1 + g / l));
  }
  return out;
}

export function ema(values, n) {
  var out = [], i, j, e, k;
  for (i = 0; i < values.length; i++) out.push(null);
  if (values.length < n) return out;
  k = 2 / (n + 1); e = 0;
  for (j = 0; j < n; j++) e += values[j];
  e /= n; out[n - 1] = e;
  for (j = n; j < values.length; j++) { e = values[j] * k + e * (1 - k); out[j] = e; }
  return out;
}

export function macdCalc(closes) {
  var e12 = ema(closes, 12), e26 = ema(closes, 26);
  var line = [], signal = [], i, s, vals = [], idx = [], sigE;
  for (i = 0; i < closes.length; i++) {
    line.push((e12[i] === null || e26[i] === null) ? null : e12[i] - e26[i]);
    signal.push(null);
  }
  for (i = 0; i < line.length; i++) { if (line[i] !== null) { vals.push(line[i]); idx.push(i); } }
  sigE = ema(vals, 9);
  for (s = 0; s < vals.length; s++) { if (sigE[s] !== null) signal[idx[s]] = sigE[s]; }
  return { line: line, signal: signal };
}

/* Normalize a raw history point: null highs/lows fall back to the candle body. */
export function sanitize(p) {
  var o = Number(p.open), c = Number(p.close);
  var h = (p.high === null || p.high === undefined) ? Math.max(o, c) : Number(p.high);
  var l = (p.low === null || p.low === undefined) ? Math.min(o, c) : Number(p.low);
  return { time: p.date, open: o, high: h, low: l, close: c, volume: Number(p.volume) || 0 };
}
