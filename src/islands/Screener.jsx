import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getJSON, toRow, dirArrow, esc } from '../lib/api.js';

/* React-owned stock screener results.
   - Mounts on #screenList (screener.html). The static filter controls stay in
     the HTML; this island wires them up and owns the results rendering.
   - Data: paints instantly from the baked window.directory, then refreshes
     from /api/prices. If the fetch fails the baked snapshot stays — the
     screener never goes stale or blank.
   - Row interactions reuse the site's shared pieces: window.nvBadgeHTML for
     logos, window.nvOpenModal for the stock modal, and the ngxWatchlist
     localStorage key shared with the vanilla pages.
*/

var MOVER_OPTS = [
  ['all', 'All'],
  ['gainers', 'Gainers'],
  ['losers', 'Losers'],
  ['volume', 'Most traded'],
];

function readWatchlist() {
  try { return JSON.parse(localStorage.getItem('ngxWatchlist') || '[]'); } catch (e) { return []; }
}

function chgKey(e, what) {
  if (what === 'chg') return !e.vol && e.pv !== null && !e.noSnap ? e.cv : null;
  if (what === 'price') return e.pv;
  if (what === 'vol') return e.vol ? e.cv : null;
  return null;
}

function applyFilters(rows, f) {
  var minP = parseFloat(f.minP), maxP = parseFloat(f.maxP);
  var minC = parseFloat(f.minC), maxC = parseFloat(f.maxC);
  var priceOn = !isNaN(minP) || !isNaN(maxP);
  var chgOn = !isNaN(minC) || !isNaN(maxC);
  var out = rows.filter(function (e) {
    if (f.mover === 'gainers' && !(!e.vol && e.d === 'up')) return false;
    if (f.mover === 'losers' && e.d !== 'down') return false;
    if (f.mover === 'volume' && !e.vol) return false;
    if (f.sector !== 'All' && e.g !== f.sector) return false;
    if (priceOn) {
      if (e.pv === null) return false;
      if (!isNaN(minP) && e.pv < minP) return false;
      if (!isNaN(maxP) && e.pv > maxP) return false;
    }
    if (chgOn) {
      var c = chgKey(e, 'chg');
      if (c === null) return false;
      if (!isNaN(minC) && c < minC) return false;
      if (!isNaN(maxC) && c > maxC) return false;
    }
    return true;
  });
  var key = f.sort;
  out.sort(function (a, b) {
    if (key === 'name') return a.s < b.s ? -1 : a.s > b.s ? 1 : 0;
    var wk = key === 'vol-desc' ? 'vol' : key.indexOf('chg') === 0 ? 'chg' : 'price';
    var ka = chgKey(a, wk), kb = chgKey(b, wk);
    if (ka === null && kb === null) return 0;
    if (ka === null) return 1;
    if (kb === null) return -1;
    return key === 'chg-asc' || key === 'price-asc' ? ka - kb : kb - ka;
  });
  return out;
}

export default function Screener() {
  var listRef = useRef(null);
  var [stocks, setStocks] = useState(function () {
    return Array.isArray(window.directory) ? window.directory.slice() : [];
  });
  var [live, setLive] = useState(false);
  var [watch, setWatch] = useState(readWatchlist);
  var [f, setF] = useState({ mover: 'all', sector: 'All', minP: '', maxP: '', minC: '', maxC: '', sort: 'chg-desc' });

  var sectors = useMemo(function () {
    var s = {};
    stocks.forEach(function (e) { if (e.g) s[e.g] = 1; });
    return ['All'].concat(Object.keys(s).sort());
  }, [stocks]);

  /* Build the mover chips + sector options (vanilla did this in site.js). */
  useEffect(function () {
    var host = document.getElementById('screenMover');
    if (host && !host.children.length) {
      MOVER_OPTS.forEach(function (opt) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'sector-chip'; b.textContent = opt[1];
        b.setAttribute('aria-pressed', opt[0] === 'all' ? 'true' : 'false');
        b.dataset.mover = opt[0];
        host.appendChild(b);
      });
    }
    var sel = document.getElementById('screenSector');
    if (sel && !sel.options.length) {
      sectors.forEach(function (g) {
        var o = document.createElement('option'); o.value = g; o.textContent = g; sel.appendChild(o);
      });
    }
  }, [sectors]);

  /* Wire the static controls into React state. */
  useEffect(function () {
    function sync() {
      var gv = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
      var pressed = document.querySelector('#screenMover .sector-chip[aria-pressed="true"]');
      setF({
        mover: pressed ? pressed.dataset.mover : 'all',
        sector: gv('screenSector') || 'All',
        minP: gv('screenMinP'), maxP: gv('screenMaxP'),
        minC: gv('screenMinC'), maxC: gv('screenMaxC'),
        sort: gv('screenSort') || 'chg-desc',
      });
    }
    var host = document.getElementById('screenMover');
    function onChip(e) {
      var b = e.target.closest('.sector-chip'); if (!b) return;
      host.querySelectorAll('.sector-chip').forEach(function (c) {
        c.setAttribute('aria-pressed', c === b ? 'true' : 'false');
      });
      sync();
    }
    if (host) host.addEventListener('click', onChip);
    var ids = ['screenSector', 'screenMinP', 'screenMaxP', 'screenMinC', 'screenMaxC', 'screenSort'];
    var els = ids.map(function (id) { return document.getElementById(id); }).filter(Boolean);
    els.forEach(function (el) {
      el.addEventListener('change', sync); el.addEventListener('input', sync);
    });
    sync();
    return function () {
      if (host) host.removeEventListener('click', onChip);
      els.forEach(function (el) { el.removeEventListener('change', sync); el.removeEventListener('input', sync); });
    };
  }, []);

  /* Refresh from the live API; baked snapshot stays on failure. */
  useEffect(function () {
    var cancelled = false;
    getJSON('/api/prices')
      .then(function (doc) {
        var list = doc && doc.stocks && doc.stocks.stocks;
        if (cancelled || !list || !list.length) return;
        var bySym = {};
        list.map(toRow).forEach(function (r) { bySym[r.s] = r; });
        setStocks(function (prev) {
          return prev.map(function (e) {
            var liveR = bySym[e.s];
            return liveR ? Object.assign({}, e, {
              p: liveR.p, m: liveR.m, d: liveR.d, pv: liveR.pv, cv: liveR.cv, vol: false, noSnap: false,
            }) : e;
          });
        });
        setLive(true);
      })
      .catch(function () { /* keep baked snapshot */ });
    return function () { cancelled = true; };
  }, []);

  function toggleStar(s) {
    setWatch(function (prev) {
      var i = prev.indexOf(s);
      var next = i === -1 ? prev.concat([s]) : prev.slice(0, i).concat(prev.slice(i + 1));
      try { localStorage.setItem('ngxWatchlist', JSON.stringify(next)); } catch (e) {}
      return next;
    });
  }

  var rows = useMemo(function () { return applyFilters(stocks, f); }, [stocks, f]);

  useEffect(function () {
    var el = document.getElementById('screenCount');
    if (el) el.textContent = rows.length + (rows.length === 1 ? ' stock' : ' stocks');
  }, [rows.length]);

  function openStock(s, ev) {
    if (window.nvOpenModal) { window.nvOpenModal(s, ev.currentTarget); return; }
    window.location.href = 'stocks/' + s + '.html';
  }

  if (!rows.length) {
    return React.createElement('div', { className: 'empty-note' }, 'No stocks match these filters.');
  }

  return React.createElement(
    React.Fragment,
    null,
    rows.map(function (r) {
      var starred = watch.indexOf(r.s) !== -1;
      var badgeHTML = window.nvBadgeHTML ? window.nvBadgeHTML(r.s) : '';
      return React.createElement(
        'div', { className: 'market-row', key: r.s },
        React.createElement('button', {
          type: 'button', className: 'star',
          'aria-pressed': starred ? 'true' : 'false',
          'aria-label': (starred ? 'Remove ' : 'Add ') + r.s + (starred ? ' from' : ' to') + ' watchlist',
          onClick: function (ev) { ev.stopPropagation(); toggleStar(r.s); },
        }, starred ? '★' : '☆'),
        React.createElement('button', {
          type: 'button', className: 'row-main',
          'aria-label': r.s + ', ' + r.c + ' — view details',
          onClick: function (ev) { openStock(r.s, ev); },
        },
          React.createElement('span', { dangerouslySetInnerHTML: { __html: badgeHTML } }),
          React.createElement('span', { className: 'row-text' },
            React.createElement('span', { className: 'symbol' }, r.s,
              React.createElement('span', { className: 'list-tag' }, r.g)),
            React.createElement('span', { className: 'company' }, r.c))),
        React.createElement('div', { className: 'price' }, r.p || '—'),
        React.createElement('div', { className: 'move ' + (r.d || '') },
          r.vol ? (r.m || '') + ' shares' : dirArrow(r.cv) + (r.m || ''))
      );
    })
  );
}
