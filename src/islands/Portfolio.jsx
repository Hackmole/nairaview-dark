import React, { useEffect, useState } from 'react';

/* React-owned portfolio tracker. Mounts on #portfolioApp.
   - Auth: GET /api/holdings (credentials: include). 401 or unreachable →
     redirect to the account page, exactly like the vanilla version.
   - Prices: baked 5 Oct 2026 snapshot first, then live daily-close prices via
     the `nv:live-prices` CustomEvent dispatched by assets/live.js.
   - CRUD: add/update form, two-step confirm delete, per-row gain/loss on
     covered holdings only.
*/

var API = 'https://nairaview-api.meetomidiora.workers.dev';
var SNAPSHOT = { DANGCEM: 1066.7, SEPLAT: 16000.1, GTCO: 132.2, ZENITHBANK: 135.4, FIRSTHOLDCO: 150.15, UBA: 45, ACCESSCORP: 30.45, STANBIC: 164, TRANSCORP: 36.25, NESTLE: 2750, NB: 73.8 };

function naira(n) {
  return '₦' + Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function api(path, opts) {
  return fetch(API + path, Object.assign({ credentials: 'include' }, opts || {}));
}

export default function Portfolio() {
  var [status, setStatus] = useState('loading'); /* loading | ready */
  var [holdings, setHoldings] = useState([]);
  var [prices, setPrices] = useState(SNAPSHOT);
  var [liveCount, setLiveCount] = useState(0);
  var [form, setForm] = useState({ ticker: '', shares: '', avg_cost: '' });
  var [formError, setFormError] = useState('');
  var [saving, setSaving] = useState(false);
  var [armedDel, setArmedDel] = useState(null);
  var [deleting, setDeleting] = useState(null);

  function load() {
    api('/api/holdings').then(function (res) {
      if (res.status === 401) { window.location.href = 'account'; return null; }
      if (!res.ok) throw new Error('down');
      return res.json();
    }).then(function (out) {
      if (!out) return;
      setHoldings(out.holdings || []);
      setStatus('ready');
    }).catch(function () {
      window.location.href = 'account';
    });
  }

  useEffect(function () { load(); }, []);

  /* the static shell starts hidden until auth resolves; the island owns it now */
  useEffect(function () {
    var app = document.getElementById('portfolioApp');
    if (app) app.hidden = false;
  }, []);

  /* live prices override the snapshot when the daily feed arrives */
  useEffect(function () {
    function onLive(e) {
      var map = (e.detail && e.detail.map) || {};
      var n = 0;
      setPrices(function (prev) {
        var next = Object.assign({}, prev);
        Object.keys(map).forEach(function (t) {
          if (map[t] > 0) { next[t] = map[t]; n++; }
        });
        return next;
      });
      if (n) setLiveCount(n);
    }
    window.addEventListener('nv:live-prices', onLive);
    return function () { window.removeEventListener('nv:live-prices', onLive); };
  }, []);

  /* disarm the delete confirm after 5s */
  useEffect(function () {
    if (!armedDel) return;
    var t = setTimeout(function () { setArmedDel(null); }, 5000);
    return function () { clearTimeout(t); };
  }, [armedDel]);

  function submitHolding(e) {
    e.preventDefault();
    setFormError('');
    var payload = {
      ticker: form.ticker.trim().toUpperCase(),
      shares: parseFloat(form.shares),
      avg_cost: parseFloat(form.avg_cost),
    };
    setSaving(true);
    api('/api/holdings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (res) {
      return res.json().then(function (out) { return { res: res, out: out }; });
    }).then(function (r) {
      setSaving(false);
      if (!r.res.ok) { setFormError(r.out.error || 'Could not save.'); return; }
      setForm({ ticker: '', shares: '', avg_cost: '' });
      load();
    }).catch(function () {
      setSaving(false);
      setFormError('Could not reach the server.');
    });
  }

  function removeHolding(ticker) {
    if (armedDel !== ticker) { setArmedDel(ticker); return; }
    setDeleting(ticker);
    api('/api/holdings?ticker=' + encodeURIComponent(ticker), { method: 'DELETE' })
      .then(function () { setDeleting(null); setArmedDel(null); load(); })
      .catch(function () { setDeleting(null); setArmedDel(null); });
  }

  if (status === 'loading') return null; /* static page shows nothing until authed */

  var totValue = 0, totCost = 0, totCoveredCost = 0, valued = false;
  var rows = holdings.map(function (h) {
    var price = prices[h.ticker];
    var cost = h.shares * h.avg_cost;
    totCost += cost;
    var value = null, gain = null;
    if (price !== undefined) {
      value = h.shares * price;
      gain = value - cost;
      totValue += value; totCoveredCost += cost; valued = true;
    }
    return { h: h, price: price, cost: cost, value: value, gain: gain };
  });
  var totGain = totValue - totCoveredCost;

  function upd(k) {
    return function (e) { setForm(Object.assign({}, form, { [k]: e.target.value })); };
  }

  return React.createElement(
    React.Fragment,
    null,
    React.createElement('div', { className: 'facts', id: 'portfolioTotals' },
      React.createElement('div', { className: 'fact' },
        React.createElement('span', null, 'Total value'),
        React.createElement('strong', { id: 'totValue' }, valued ? naira(totValue) : '—')),
      React.createElement('div', { className: 'fact' },
        React.createElement('span', null, 'Total cost'),
        React.createElement('strong', { id: 'totCost' }, naira(totCost))),
      React.createElement('div', { className: 'fact' },
        React.createElement('span', null, 'Gain / loss (covered)'),
        React.createElement('strong', {
          id: 'totGain',
          style: { color: valued ? (totGain >= 0 ? 'var(--green-strong)' : 'var(--red)') : '' },
        }, valued ? (totGain >= 0 ? '+' : '') + naira(totGain) : '—'))),
    React.createElement('p', { className: 'asof', id: 'priceNote' },
      liveCount
        ? 'Valued at the latest daily-close prices, refreshed after each market close. Gain/loss is calculated on covered holdings only.'
        : 'Valued at Nairaview\u2019s 5 Oct 2026 snapshot prices — not live. Prices exist for 11 covered stocks; other holdings show cost only, and gain/loss is calculated on covered holdings only.'),
    React.createElement('p', { className: 'form-note' },
      React.createElement('a', { href: 'account' }, 'Account settings & log out')),
    React.createElement('div', { className: 'movers-col' },
      React.createElement('table', { className: 'movers-table', id: 'holdingsTable' },
        React.createElement('tbody', null,
          React.createElement('tr', null,
            React.createElement('th', { style: { textAlign: 'left' } }, 'Ticker'),
            React.createElement('th', null, 'Shares'),
            React.createElement('th', null, 'Avg cost'),
            React.createElement('th', null, 'Price'),
            React.createElement('th', null, 'Value'),
            React.createElement('th', null, 'Gain/loss'),
            React.createElement('th', null)),
          rows.map(function (r) {
            var h = r.h;
            var badge = window.nvBadgeHTML ? window.nvBadgeHTML(h.ticker, 'sm') + ' ' : '';
            var gainColor = r.gain >= 0 ? 'var(--green-strong)' : 'var(--red)';
            return React.createElement('tr', { key: h.ticker },
              React.createElement('td', { style: { textAlign: 'left', whiteSpace: 'nowrap' } },
                React.createElement('span', { dangerouslySetInnerHTML: { __html: badge } }),
                React.createElement('strong', null,
                  React.createElement('a', { href: 'stocks/' + h.ticker + '.html' }, h.ticker))),
              React.createElement('td', { className: 'num' }, Number(h.shares).toLocaleString('en-NG')),
              React.createElement('td', { className: 'num' }, naira(h.avg_cost)),
              React.createElement('td', { className: 'num' }, r.price !== undefined ? naira(r.price) : '—'),
              React.createElement('td', { className: 'num' }, r.value !== null ? naira(r.value) : '—'),
              React.createElement('td', { className: 'num' },
                r.gain !== null
                  ? React.createElement('span', { style: { color: gainColor } }, (r.gain >= 0 ? '+' : '') + naira(r.gain))
                  : '—'),
              React.createElement('td', null,
                React.createElement('button', {
                  type: 'button',
                  className: 'btn-ghost btn-sm',
                  disabled: deleting === h.ticker,
                  onClick: function () { removeHolding(h.ticker); },
                }, deleting === h.ticker ? 'Removing…' : armedDel === h.ticker ? 'Confirm remove?' : 'Remove')));
          })))),
    holdings.length === 0 && React.createElement('p', { className: 'guide-p', id: 'emptyMsg' }, 'You have no holdings yet — add your first one below.'),
    React.createElement('h2', { className: 'guide-h2' }, 'Add or update a holding'),
    React.createElement('form', { id: 'holdingForm', className: 'auth-form', onSubmit: submitHolding },
      React.createElement('label', null, 'Ticker',
        React.createElement('input', { name: 'ticker', required: true, maxLength: 12, placeholder: 'GTCO', style: { textTransform: 'uppercase' }, value: form.ticker, onChange: upd('ticker') })),
      React.createElement('label', null, 'Shares',
        React.createElement('input', { name: 'shares', required: true, type: 'number', min: 0, step: 'any', placeholder: '100', value: form.shares, onChange: upd('shares') })),
      React.createElement('label', null, 'Average cost per share (₦)',
        React.createElement('input', { name: 'avg_cost', required: true, type: 'number', min: 0, step: 'any', placeholder: '120.50', value: form.avg_cost, onChange: upd('avg_cost') })),
      formError && React.createElement('p', { className: 'form-error', id: 'holdingError', role: 'alert' }, formError),
      React.createElement('button', { type: 'submit', className: 'btn-primary', disabled: saving }, saving ? 'Saving…' : 'Save holding'),
      React.createElement('p', { className: 'form-note' }, 'Saving the same ticker again updates it. This is a personal tracker — not connected to your broker.'))
  );
}
