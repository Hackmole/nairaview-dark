/* Shared API + formatting helpers for Nairaview React islands. */

var API = 'https://nairaview-api.meetomidiora.workers.dev';

export function getJSON(path, timeoutMs) {
  var ctrl = new AbortController();
  var t = setTimeout(function () { ctrl.abort(); }, timeoutMs || 12000);
  return fetch(API + path, { signal: ctrl.signal })
    .then(function (r) {
      clearTimeout(t);
      if (!r.ok) throw new Error('bad status ' + r.status);
      return r.json();
    })
    .catch(function (e) {
      clearTimeout(t);
      throw e;
    });
}

export function fmt2(n) {
  return Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtN(n) {
  return n === null || n === undefined || n === '' ? '—' : '₦' + fmt2(n);
}

export function signedPct(chg) {
  var v = Math.round(Number(chg) * 100) / 100;
  return (v > 0 ? '+' : v < 0 ? '−' : '') + fmt2(Math.abs(v)) + '%';
}

export function dirArrow(chg) {
  return chg > 0 ? '▲ ' : chg < 0 ? '▼ ' : '■ ';
}

/* Normalize an /api/prices stock into the directory row shape. */
export function toRow(s) {
  var px = Number(s.current_price);
  var chg = s.official_change_percent != null ? s.official_change_percent : s.change_percent;
  chg = Number(chg) || 0;
  return {
    s: s.symbol,
    c: s.name,
    p: '₦' + fmt2(px),
    m: signedPct(chg),
    d: chg < 0 ? 'down' : 'up',
    pv: px,
    cv: Math.round(chg * 100) / 100,
    volNum: Number(s.volume) || 0,
    g: s.sector || '',
    noSnap: false,
  };
}

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
