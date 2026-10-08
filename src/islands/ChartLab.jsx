import { useEffect, useRef, useState } from 'react';
import { createChart, LineSeries, CandlestickSeries, AreaSeries, HistogramSeries, LineStyle } from 'lightweight-charts';
import { sma, rsiWilder, macdCalc, sanitize } from '../lib/indicators.js';
import { getJSON } from '../lib/api.js';

/* React-owned Chart Lab. Adopts the existing page DOM (search, pill rows,
   chart containers) and manages all chart instances imperatively via refs —
   lightweight-charts is inherently imperative, so React owns the state
   (symbol, timeframe, style, indicators, fetched data) while the charts
   themselves live outside the render tree. The component renders nothing.

   Data: /api/history?symbol=SYM for the stock, /api/asi-history for the ASI
   (shared with compare mode). Fully guarded: chart containers keep their
   "Loading…" / error notes if a fetch fails.
*/

var UP = '#16a34a', DOWN = '#dc2626';

function isDark() {
  var t = null;
  try { t = document.documentElement.getAttribute('data-theme'); } catch (e) {}
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function themeOpts() {
  var dark = isDark();
  return {
    layout: {
      background: { type: 'solid', color: 'transparent' },
      textColor: dark ? '#c9d4e3' : '#3c4756',
      fontFamily: "'Public Sans', system-ui, sans-serif",
      fontSize: 12,
    },
    grid: {
      vertLines: { color: dark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)' },
      horzLines: { color: dark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)' },
    },
    crosshair: {
      vertLine: { color: dark ? '#5b6b85' : '#94a3b8', labelBackgroundColor: '#087a4b' },
      horzLine: { color: dark ? '#5b6b85' : '#94a3b8', labelBackgroundColor: '#087a4b' },
    },
    rightPriceScale: { borderColor: dark ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.12)' },
    timeScale: { borderColor: dark ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.12)', timeVisible: false },
  };
}

function fmtDate(iso) {
  var d = new Date(iso + 'T12:00:00Z');
  var M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return d.getUTCDate() + ' ' + M[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}

function money(n) {
  return '₦' + Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function el(id) { return document.getElementById(id); }

function setPressed(rowId, attr, value) {
  var row = el(rowId);
  if (!row) return;
  Array.prototype.forEach.call(row.querySelectorAll('button[' + attr + ']'), function (x) {
    x.setAttribute('aria-pressed', x.getAttribute(attr) === value ? 'true' : 'false');
  });
}

export default function ChartLab() {
  var [sym, setSym] = useState('DANGCEM');
  var [ctype, setCtype] = useState('candles');
  var [tf, setTf] = useState('all');
  var [ind, setInd] = useState({ sma5: false, sma20: false, rsi: false, macd: false, compare: false });
  var [stockData, setStockData] = useState([]);
  var [asiData, setAsiData] = useState([]);
  var [asiReady, setAsiReady] = useState(false);
  var [stockState, setStockState] = useState({ loading: true, error: '' });

  var charts = useRef({ main: null, mainSeries: [], rsi: null, rsiSeries: null, macd: null, macdLine: null, macdSig: null, macdHist: null, asi: null });
  var knownSyms = useRef({});
  var reqId = useRef(0);

  /* ---- one-time setup: create charts, wire controls, fetch ASI + datalist ---- */
  useEffect(function () {
    var c = charts.current;
    var chartEl = el('tv-chart');
    var asiEl = el('tv-asi');
    if (!chartEl || !asiEl) return;

    c.main = createChart(chartEl, Object.assign({ width: chartEl.clientWidth, height: chartEl.clientHeight }, themeOpts()));
    c.asi = createChart(asiEl, Object.assign({ width: asiEl.clientWidth, height: asiEl.clientHeight }, themeOpts()));

    /* ASI history feeds both the bottom chart and compare mode */
    getJSON('/api/asi-history').then(function (j) {
      var hist = (j && (j.history || j.data)) || [];
      if (!hist.length) throw new Error('no data');
      setAsiData(hist.map(function (p) { return { date: p.date, value: Number(p.value) }; }));
      setAsiReady(true);
      var err = el('asi-err');
      if (err) err.style.display = 'none';
      var s = c.asi.addSeries(AreaSeries, { lineColor: '#c9a227', topColor: 'rgba(201,162,39,0.35)', bottomColor: 'rgba(201,162,39,0.02)', lineWidth: 2 });
      s.setData(hist.map(function (p) { return { time: p.date, value: Number(p.value) }; }));
      c.asi.timeScale().fitContent();
      var asof = el('asi-asof');
      if (asof) asof.textContent = 'NGX All-Share Index · ' + hist.length + ' sessions (' + fmtDate(hist[0].date) + ' – ' + fmtDate(hist[hist.length - 1].date) + ') · Nairaview market feed, daily closes — not live.';
    }).catch(function (e) {
      var err = el('asi-err');
      if (err) err.textContent = 'Could not load ASI data (' + (e.message || 'error') + ').';
    });

    /* symbol datalist for the search box */
    getJSON('/api/prices').then(function (j) {
      var list = [];
      if (j) {
        if (Array.isArray(j)) list = j;
        else if (j.stocks) {
          if (Array.isArray(j.stocks)) list = j.stocks;
          else if (j.stocks.stocks && Array.isArray(j.stocks.stocks)) list = j.stocks.stocks;
        }
      }
      var dl = el('sym-list');
      if (!dl) return;
      var seen = {};
      list.forEach(function (s) {
        if (!s || !s.symbol || seen[s.symbol]) return;
        seen[s.symbol] = true;
        knownSyms.current[String(s.symbol).toUpperCase()] = true;
        var opt = document.createElement('option');
        opt.value = s.symbol;
        opt.textContent = s.symbol + (s.name ? ' — ' + s.name : '');
        dl.appendChild(opt);
      });
    }).catch(function () {});

    /* pill rows */
    function delegate(rowId, fn) {
      var row = el(rowId);
      if (!row) return function () {};
      function h(e) {
        var b = e.target.closest('button[data-sym],button[data-tf],button[data-type],button[data-ind]');
        if (!b || !row.contains(b)) return;
        fn(b);
      }
      row.addEventListener('click', h);
      return function () { row.removeEventListener('click', h); };
    }
    var offs = [
      delegate('sym-row', function (b) { setSym(b.getAttribute('data-sym')); }),
      delegate('tf-row', function (b) { setTf(b.getAttribute('data-tf')); }),
      delegate('type-row', function (b) { setCtype(b.getAttribute('data-type')); }),
      delegate('ind-row', function (b) {
        var k = b.getAttribute('data-ind');
        setInd(function (prev) {
          var next = Object.assign({}, prev);
          next[k] = !prev[k];
          return next;
        });
      }),
    ];

    /* search box: Enter commits, input clears the note */
    var searchInput = el('sym-search');
    function onKey(e) {
      if (e.key !== 'Enter') return;
      var v = searchInput.value.trim().toUpperCase();
      if (!v) return;
      var sn = el('search-note');
      if (knownSyms.current[v]) {
        setSym(v);
        searchInput.value = '';
        if (sn) { sn.textContent = ''; sn.hidden = true; }
      } else if (sn) {
        sn.textContent = 'No NGX listing found for "' + v + '". Try a quick pick or another ticker.';
        sn.hidden = false;
      }
    }
    if (searchInput) searchInput.addEventListener('keydown', onKey);

    /* resize */
    var ro = null;
    function fit() {
      if (c.main) c.main.applyOptions({ width: chartEl.clientWidth, height: chartEl.clientHeight });
      if (c.asi) c.asi.applyOptions({ width: asiEl.clientWidth, height: asiEl.clientHeight });
      if (c.rsi) { var w = el('rsi-wrap'); if (w) c.rsi.applyOptions({ width: w.clientWidth, height: w.clientHeight }); }
      if (c.macd) { var w2 = el('macd-wrap'); if (w2) c.macd.applyOptions({ width: w2.clientWidth, height: w2.clientHeight }); }
    }
    if (window.ResizeObserver) {
      ro = new ResizeObserver(fit);
      ro.observe(chartEl); ro.observe(asiEl);
    }
    window.addEventListener('resize', fit);

    return function () {
      offs.forEach(function (off) { off(); });
      if (searchInput) searchInput.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', fit);
      if (ro) ro.disconnect();
      ['main', 'rsi', 'macd', 'asi'].forEach(function (k) {
        try { if (c[k]) c[k].remove(); } catch (e) {}
        c[k] = null;
      });
      c.mainSeries = []; c.rsiSeries = null; c.macdLine = c.macdSig = c.macdHist = null;
    };
  }, []);

  /* ---- keep pill pressed-states in sync ---- */
  useEffect(function () {
    setPressed('sym-row', 'data-sym', sym);
    setPressed('tf-row', 'data-tf', tf);
    setPressed('type-row', 'data-type', ctype);
    var row = el('ind-row');
    if (row) {
      Array.prototype.forEach.call(row.querySelectorAll('button[data-ind]'), function (x) {
        var k = x.getAttribute('data-ind');
        x.setAttribute('aria-pressed', ind[k] ? 'true' : 'false');
      });
    }
  }, [sym, ctype, tf, ind]);

  /* ---- load stock history when the symbol changes ---- */
  useEffect(function () {
    var id = ++reqId.current;
    setStockState({ loading: true, error: '' });
    var err = el('tv-err');
    if (err) { err.style.display = 'flex'; err.textContent = 'Loading chart…'; }
    getJSON('/api/history?symbol=' + encodeURIComponent(sym)).then(function (j) {
      if (id !== reqId.current) return;
      if (!j.prices || !j.prices.length) throw new Error('no data');
      setStockData(j.prices);
      setStockState({ loading: false, error: '' });
      if (err) err.style.display = 'none';
    }).catch(function (e) {
      if (id !== reqId.current) return;
      setStockData([]);
      setStockState({ loading: false, error: String((e && e.message) || 'error') });
      if (err) { err.style.display = 'flex'; err.textContent = 'Could not load ' + sym + ' data (' + String((e && e.message) || 'error') + ').'; }
    });
  }, [sym]);

  /* ---- draw: rebuilds all series from current state ---- */
  useEffect(function () {
    var c = charts.current;
    if (!c.main || stockState.loading) return;
    var prices = stockData;
    var n = prices.length;
    if (tf === '1m' && n > 22) prices = prices.slice(n - 22);
    if (tf === '3m' && n > 66) prices = prices.slice(n - 66);
    if (!prices.length) return;

    /* clear main series */
    c.mainSeries.forEach(function (s) { try { c.main.removeSeries(s); } catch (e) {} });
    c.mainSeries = [];

    var notes = [];
    var data = prices.map(sanitize);
    var dates = data.map(function (d) { return d.time; });
    var closes = data.map(function (d) { return d.close; });

    function addOverlayLine(values, color) {
      var s = c.main.addSeries(LineSeries, { color: color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      var sd = [];
      for (var i = 0; i < dates.length; i++) {
        if (values[i] !== null && values[i] !== undefined) sd.push({ time: dates[i], value: values[i] });
      }
      s.setData(sd);
      c.mainSeries.push(s);
    }

    if (ind.compare) {
      var map = {};
      asiData.forEach(function (p) { map[p.date] = p.value; });
      var sd = [], sv = [], av = [];
      data.forEach(function (d) {
        if (map[d.time] !== undefined && map[d.time] !== null) { sd.push(d.time); sv.push(d.close); av.push(map[d.time]); }
      });
      if (!asiReady) {
        notes.push('ASI data still loading — comparison will appear in a moment.');
      } else if (sv.length < 2) {
        notes.push('Not enough overlapping ASI sessions to compare.');
      } else {
        var sb = sv[0], ab = av[0];
        var sPct = [], aPct = [];
        for (var i = 0; i < sv.length; i++) {
          sPct.push({ time: sd[i], value: (sv[i] / sb - 1) * 100 });
          aPct.push({ time: sd[i], value: (av[i] / ab - 1) * 100 });
        }
        var ls = c.main.addSeries(LineSeries, { color: '#0e9f6e', lineWidth: 2, title: sym + ' %' });
        ls.setData(sPct); c.mainSeries.push(ls);
        var as = c.main.addSeries(LineSeries, { color: '#32d9eb', lineWidth: 2, priceScaleId: 'asi', title: 'ASI %' });
        as.setData(aPct); c.mainSeries.push(as);
        c.main.priceScale('asi').applyOptions({ scaleMargins: { top: 0.12, bottom: 0.12 } });
      }
    } else if (ctype === 'candles') {
      var cs = c.main.addSeries(CandlestickSeries, { upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: false });
      cs.setData(data.map(function (d) { return { time: d.time, open: d.open, high: d.high, low: d.low, close: d.close }; }));
      c.mainSeries.push(cs);
    } else {
      var ar = c.main.addSeries(AreaSeries, { lineColor: '#0e9f6e', topColor: 'rgba(14,159,110,0.35)', bottomColor: 'rgba(14,159,110,0.02)', lineWidth: 2, priceLineVisible: true });
      ar.setData(data.map(function (d) { return { time: d.time, value: d.close }; }));
      c.mainSeries.push(ar);
    }

    if (!ind.compare) {
      if (ind.sma5) {
        if (closes.length >= 5) addOverlayLine(sma(closes, 5), '#f59e0b');
        else notes.push('SMA 5 needs 5 sessions — history accumulates daily.');
      }
      if (ind.sma20) {
        if (closes.length >= 20) addOverlayLine(sma(closes, 20), '#2563eb');
        else notes.push('SMA 20 needs 20 sessions — history accumulates daily.');
      }
    }

    var hasVol = data.some(function (d) { return d.volume > 0; });
    if (hasVol) {
      var vs = c.main.addSeries(HistogramSeries, { priceScaleId: '', priceFormat: { type: 'volume' } });
      c.main.priceScale('').applyOptions({ scaleMargins: { top: 0.86, bottom: 0 } });
      vs.setData(data.map(function (d) {
        return { time: d.time, value: d.volume, color: d.close >= d.open ? 'rgba(22,163,74,0.45)' : 'rgba(220,38,38,0.45)' };
      }));
      c.mainSeries.push(vs);
    }

    /* RSI pane */
    var rsiWrap = el('rsi-wrap'), rsiCap = el('rsi-cap');
    function hideRsi() { if (rsiWrap) rsiWrap.hidden = true; if (rsiCap) rsiCap.hidden = true; }
    if (ind.rsi) {
      if (closes.length < 15) {
        if (c.rsi) { try { c.rsi.remove(); } catch (e) {} c.rsi = null; c.rsiSeries = null; }
        hideRsi();
        notes.push('RSI 14 needs 15 sessions — history accumulates daily.');
      } else {
        if (rsiWrap) rsiWrap.hidden = false;
        if (!c.rsi && rsiWrap) {
          c.rsi = createChart(rsiWrap, Object.assign({ width: rsiWrap.clientWidth, height: rsiWrap.clientHeight }, themeOpts()));
          c.rsiSeries = c.rsi.addSeries(LineSeries, { color: '#8b5cf6', lineWidth: 2, priceLineVisible: false });
          c.rsiSeries.createPriceLine({ price: 70, color: '#dc2626', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '70' });
          c.rsiSeries.createPriceLine({ price: 30, color: '#16a34a', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '30' });
        }
        if (c.rsiSeries) {
          var r = rsiWilder(closes, 14), rd = [], last = null;
          for (var ri = 0; ri < dates.length; ri++) {
            if (r[ri] !== null) { rd.push({ time: dates[ri], value: r[ri] }); last = r[ri]; }
          }
          c.rsiSeries.setData(rd);
          c.rsi.timeScale().fitContent();
          if (rsiCap) {
            rsiCap.textContent = 'RSI (14)' + (last !== null ? ' · ' + last.toFixed(2) : '') + ' — above 70 often reads overbought, below 30 oversold. Educational only, not advice.';
            rsiCap.hidden = false;
          }
        }
      }
    } else hideRsi();

    /* MACD pane */
    var macdWrap = el('macd-wrap'), macdCap = el('macd-cap');
    function hideMacd() { if (macdWrap) macdWrap.hidden = true; if (macdCap) macdCap.hidden = true; }
    if (ind.macd) {
      if (closes.length < 26) {
        if (c.macd) { try { c.macd.remove(); } catch (e) {} c.macd = null; c.macdLine = c.macdSig = c.macdHist = null; }
        hideMacd();
        notes.push('MACD needs 26 sessions — history accumulates daily.');
      } else {
        if (macdWrap) macdWrap.hidden = false;
        if (!c.macd && macdWrap) {
          c.macd = createChart(macdWrap, Object.assign({ width: macdWrap.clientWidth, height: macdWrap.clientHeight }, themeOpts()));
          c.macdHist = c.macd.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false });
          c.macdLine = c.macd.addSeries(LineSeries, { color: '#2563eb', lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
          c.macdSig = c.macd.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        }
        if (c.macdLine) {
          var m = macdCalc(closes), ld = [], sgd = [], hd = [];
          for (var mi = 0; mi < dates.length; mi++) {
            if (m.line[mi] !== null) ld.push({ time: dates[mi], value: m.line[mi] });
            if (m.signal[mi] !== null) sgd.push({ time: dates[mi], value: m.signal[mi] });
            if (m.line[mi] !== null && m.signal[mi] !== null) {
              var v = m.line[mi] - m.signal[mi];
              hd.push({ time: dates[mi], value: v, color: v >= 0 ? 'rgba(22,163,74,0.55)' : 'rgba(220,38,38,0.55)' });
            }
          }
          c.macdLine.setData(ld);
          c.macdSig.setData(sgd);
          c.macdHist.setData(hd);
          c.macd.timeScale().fitContent();
          if (macdCap) {
            macdCap.textContent = 'MACD (12, 26, 9) — blue MACD line, amber signal line. Educational only, not advice.';
            macdCap.hidden = false;
          }
        }
      }
    } else hideMacd();

    c.main.timeScale().fitContent();

    var indNote = el('ind-note');
    if (indNote) {
      if (notes.length) { indNote.textContent = notes.join(' '); indNote.hidden = false; }
      else { indNote.textContent = ''; indNote.hidden = true; }
    }

    var first = data[0], last = data[data.length - 1];
    var chg = (last.close - first.close) / first.close * 100;
    var arrow = chg >= 0 ? '▲' : '▼';
    var active = [];
    if (ind.sma5) active.push('SMA 5');
    if (ind.sma20) active.push('SMA 20');
    if (ind.rsi) active.push('RSI 14');
    if (ind.macd) active.push('MACD');
    if (ind.compare) active.push('vs ASI (rebased %)');
    var asofEl = el('stock-asof');
    if (asofEl) asofEl.textContent = sym + ' · ' + data.length + ' sessions (' + fmtDate(first.time) + ' – ' + fmtDate(last.time) + ') · ' +
      money(last.close) + ' (' + arrow + ' ' + Math.abs(chg).toFixed(2) + '%)' +
      (active.length ? ' · ' + active.join(', ') : '') +
      ' · Nairaview market feed, daily closes — not live.';
  });

  return null;
}
