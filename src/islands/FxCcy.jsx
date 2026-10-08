import { useEffect, useState } from 'react';
import { getFx, fmtFx, fmtFxDate } from '../lib/fx.js';

/* React-owned FX currency section. One mount per currency via
   data-island="fx-ccy" data-ccy="USD|EUR|GBP". Paints the official/parallel/
   spread cards and draws the history SVG into the existing elements —
   static "₦—" placeholders stay if the feed fails. Renders nothing itself. */

function el(id) { return document.getElementById(id); }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); }

function chartSVG(history) {
  var pts = (history || []).filter(function (p) { return (p.official > 0) || (p.parallel > 0); });
  if (pts.length < 2) {
    return {
      svg: '<text x="500" y="180" text-anchor="middle" class="fx-empty">History is accumulating — the trend line appears after a few daily pulls.</text>',
      range: '',
    };
  }
  var W = 1000, H = 360, P = 36;
  var vals = [];
  pts.forEach(function (p) {
    if (p.official > 0) vals.push(p.official);
    if (p.parallel > 0) vals.push(p.parallel);
  });
  var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
  if (hi - lo < 1) hi = lo + 1;
  var pad = (hi - lo) * 0.15; lo -= pad; hi += pad;
  function x(i) { return P + (W - 2 * P) * (i / (pts.length - 1)); }
  function y(v) { return H - P - (H - 2 * P) * ((v - lo) / (hi - lo)); }
  function line(key, cls) {
    var d = '', started = false;
    pts.forEach(function (p, i) {
      var v = p[key];
      if (!(v > 0)) { started = false; return; }
      d += (started ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
      started = true;
    });
    return d ? '<path d="' + d + '" class="' + cls + '" fill="none" stroke-width="3"/>' : '';
  }
  return {
    svg: '<line x1="' + P + '" y1="' + (H - P) + '" x2="' + (W - P) + '" y2="' + (H - P) + '" class="fx-axis"/>' +
      line('official', 'fx-line-official') + line('parallel', 'fx-line-parallel'),
    range: ' · ' + fmtFxDate(pts[0].date) + ' → ' + fmtFxDate(pts[pts.length - 1].date),
  };
}

export default function FxCcy(props) {
  var ccy = (props.ccy || 'USD').toUpperCase();
  var P = cap(ccy);
  var [doc, setDoc] = useState(null);

  useEffect(function () {
    var alive = true;
    getFx().then(function (d) { if (alive) setDoc(d); });
    return function () { alive = false; };
  }, []);

  useEffect(function () {
    if (!doc) return;
    var latest = doc.latest || {};
    var history = doc.history || {};
    var legs = latest[ccy];
    if (legs) {
      if (legs.official > 0) {
        var o = el('fx' + P + 'Official'); if (o) o.textContent = fmtFx(legs.official);
        var od = el('fx' + P + 'OfficialDate'); if (od) od.textContent = 'NFEM · ' + fmtFxDate(legs.official_date);
      }
      if (legs.parallel > 0) {
        var pl = el('fx' + P + 'Parallel'); if (pl) pl.textContent = fmtFx(legs.parallel);
        var pd = el('fx' + P + 'ParallelDate'); if (pd) pd.textContent = 'Street rate · updated ' + fmtFxDate(legs.parallel_updated_at);
      }
      if (legs.official > 0 && legs.parallel > 0) {
        var spread = legs.parallel - legs.official;
        var sp = el('fx' + P + 'Spread');
        if (sp) sp.textContent = '₦' + Math.abs(spread).toLocaleString('en-NG', { maximumFractionDigits: 2 });
        var spct = el('fx' + P + 'SpreadPct');
        if (spct) spct.textContent = Math.abs(spread / legs.official * 100).toFixed(2) + (spread >= 0 ? '% above official' : '% below official');
      }
    }
    var drawn = chartSVG(history[ccy]);
    var svg = el('fx' + P + 'Chart');
    if (svg) svg.innerHTML = drawn.svg;
    var rg = el('fx' + P + 'ChartRange');
    if (rg) rg.textContent = drawn.range;
    /* hero date pill: painted once by the first-mounted section */
    var hd = el('fxHeroDate');
    if (hd && doc.pulled_at && !hd.dataset.fxPainted) {
      hd.textContent = 'Updated ' + fmtFxDate(doc.pulled_at);
      hd.dataset.fxPainted = '1';
    }
  }, [doc]);

  return null;
}
