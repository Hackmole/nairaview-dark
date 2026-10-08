/* Shared /api/fx fetch with a module-level cache so the converter and the
   three currency sections on the FX page make exactly one request. */
import { getJSON } from './api.js';

var cached = null;

export function getFx() {
  if (!cached) {
    cached = getJSON('/api/fx').then(function (doc) {
      return doc || {};
    }).catch(function () {
      cached = null; /* allow a retry on the next mount */
      return {};
    });
  }
  return cached;
}

export function fmtFx(n) {
  return '₦' + Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtFxDate(iso) {
  if (!iso) return '—';
  var d = new Date(iso.length <= 10 ? iso + 'T12:00:00Z' : iso);
  if (isNaN(d)) return '—';
  var M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return d.getUTCDate() + ' ' + M[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}
