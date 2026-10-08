import { useEffect, useRef, useState } from 'react';
import {
  createChart, LineSeries, CandlestickSeries, AreaSeries, HistogramSeries, LineStyle, ColorType,
  type IChartApi, type ISeriesApi,
} from 'lightweight-charts';
import { sma, rsiWilder, macdCalc, sanitize } from '../lib/indicators.js';
import { getJSON } from '../lib/api.js';
import type { AsiHistoryResponse, HistoryPoint, HistoryResponse } from '../lib/types.js';

/* React-owned Chart Lab. Adopts the existing page DOM (search, pill rows,
   chart containers) and manages all chart instances imperatively via refs —
   lightweight-charts is inherently imperative, so React owns the state
   (symbol, timeframe, style, indicators, fetched data) while the charts
   themselves live outside the render tree. The component renders nothing.

   Data: /api/history?symbol=SYM for the stock, /api/asi-history for the ASI
   (shared with compare mode). Fully guarded: chart containers keep their
   "Loading…" / error notes if a fetch fails.
*/

const UP = '#16a34a', DOWN = '#dc2626';

interface IndicatorState {
  sma5: boolean; sma20: boolean; rsi: boolean; macd: boolean; compare: boolean;
}

interface ChartSet {
  main: IChartApi | null;
  mainSeries: ISeriesApi<'Line' | 'Candlestick' | 'Area' | 'Histogram'>[];
  rsi: IChartApi | null;
  rsiSeries: ISeriesApi<'Line'> | null;
  macd: IChartApi | null;
  macdLine: ISeriesApi<'Line'> | null;
  macdSig: ISeriesApi<'Line'> | null;
  macdHist: ISeriesApi<'Histogram'> | null;
  asi: IChartApi | null;
}

interface Asipoint { date: string; value: number }

function isDark(): boolean {
  let t: string | null = null;
  try { t = document.documentElement.getAttribute('data-theme'); } catch { /* noop */ }
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

function themeOpts() {
  const dark = isDark();
  return {
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
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

function fmtDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return d.getUTCDate() + ' ' + M[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}

function money(n: number): string {
  return '₦' + Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function el(id: string): HTMLElement | null { return document.getElementById(id); }

function setPressed(rowId: string, attr: string, value: string) {
  const row = el(rowId);
  if (!row) return;
  Array.prototype.forEach.call(row.querySelectorAll('button[' + attr + ']'), (x: Element) => {
    x.setAttribute('aria-pressed', x.getAttribute(attr) === value ? 'true' : 'false');
  });
}

export default function ChartLab(): null {
  const [sym, setSym] = useState('DANGCEM');
  const [ctype, setCtype] = useState('candles');
  const [tf, setTf] = useState('all');
  const [ind, setInd] = useState<IndicatorState>({ sma5: false, sma20: false, rsi: false, macd: false, compare: false });
  const [stockData, setStockData] = useState<HistoryPoint[]>([]);
  const [asiData, setAsiData] = useState<Asipoint[]>([]);
  const [asiReady, setAsiReady] = useState(false);
  const [loading, setLoading] = useState(true);

  const charts = useRef<ChartSet>({ main: null, mainSeries: [], rsi: null, rsiSeries: null, macd: null, macdLine: null, macdSig: null, macdHist: null, asi: null });
  const knownSyms = useRef<Record<string, boolean>>({});
  const reqId = useRef(0);

  /* ---- one-time setup: create charts, wire controls, fetch ASI + datalist ---- */
  useEffect(() => {
    const c = charts.current;
    const chartEl = el('tv-chart');
    const asiEl = el('tv-asi');
    if (!chartEl || !asiEl) return;

    c.main = createChart(chartEl, { width: chartEl.clientWidth, height: chartEl.clientHeight, ...themeOpts() });
    c.asi = createChart(asiEl, { width: asiEl.clientWidth, height: asiEl.clientHeight, ...themeOpts() });

    /* ASI history feeds both the bottom chart and compare mode */
    getJSON<AsiHistoryResponse>('/api/asi-history').then((j) => {
      const hist = (j && (j.history || j.data)) || [];
      if (!hist.length) throw new Error('no data');
      setAsiData(hist.map((p) => ({ date: p.date, value: Number(p.value) })));
      setAsiReady(true);
      const err = el('asi-err');
      if (err) err.style.display = 'none';
      if (!c.asi) return;
      const s = c.asi.addSeries(AreaSeries, { lineColor: '#c9a227', topColor: 'rgba(201,162,39,0.35)', bottomColor: 'rgba(201,162,39,0.02)', lineWidth: 2 });
      s.setData(hist.map((p) => ({ time: p.date, value: Number(p.value) })));
      c.asi.timeScale().fitContent();
      const asof = el('asi-asof');
      if (asof) asof.textContent = 'NGX All-Share Index · ' + hist.length + ' sessions (' + fmtDate(hist[0].date) + ' – ' + fmtDate(hist[hist.length - 1].date) + ') · Nairaview market feed, daily closes — not live.';
    }).catch((e: unknown) => {
      const err = el('asi-err');
      if (err) err.textContent = 'Could not load ASI data (' + ((e as Error)?.message || 'error') + ').';
    });

    /* symbol datalist for the search box */
    getJSON<{ stocks?: { stocks?: Array<{ symbol?: string; name?: string }> } | Array<{ symbol?: string; name?: string }> }>('/api/prices').then((j) => {
      let list: Array<{ symbol?: string; name?: string }> = [];
      if (j) {
        if (Array.isArray(j)) list = j;
        else if (j.stocks) {
          if (Array.isArray(j.stocks)) list = j.stocks;
          else if (j.stocks.stocks && Array.isArray(j.stocks.stocks)) list = j.stocks.stocks;
        }
      }
      const dl = el('sym-list');
      if (!dl) return;
      const seen: Record<string, boolean> = {};
      list.forEach((s) => {
        if (!s || !s.symbol || seen[s.symbol]) return;
        seen[s.symbol] = true;
        knownSyms.current[String(s.symbol).toUpperCase()] = true;
        const opt = document.createElement('option');
        opt.value = s.symbol;
        opt.textContent = s.symbol + (s.name ? ' — ' + s.name : '');
        dl.appendChild(opt);
      });
    }).catch(() => { /* search stays empty; quick picks still work */ });

    /* pill rows */
    function delegate(rowId: string, fn: (b: HTMLElement) => void): () => void {
      const row = el(rowId);
      if (!row) return () => {};
      function h(e: Event) {
        const b = (e.target as HTMLElement).closest('button[data-sym],button[data-tf],button[data-type],button[data-ind]') as HTMLElement | null;
        if (!b || !row!.contains(b)) return;
        fn(b);
      }
      row.addEventListener('click', h);
      return () => { row.removeEventListener('click', h); };
    }
    const offs = [
      delegate('sym-row', (b) => setSym(b.getAttribute('data-sym') || 'DANGCEM')),
      delegate('tf-row', (b) => setTf(b.getAttribute('data-tf') || 'all')),
      delegate('type-row', (b) => setCtype(b.getAttribute('data-type') || 'candles')),
      delegate('ind-row', (b) => {
        const k = b.getAttribute('data-ind') as keyof IndicatorState;
        if (!k) return;
        setInd((prev) => ({ ...prev, [k]: !prev[k] }));
      }),
    ];

    /* search box: Enter commits */
    const searchInput = el('sym-search') as HTMLInputElement | null;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Enter' || !searchInput) return;
      const v = searchInput.value.trim().toUpperCase();
      if (!v) return;
      const sn = el('search-note');
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
    function fit() {
      if (c.main && chartEl) c.main.applyOptions({ width: chartEl.clientWidth, height: chartEl.clientHeight });
      if (c.asi && asiEl) c.asi.applyOptions({ width: asiEl.clientWidth, height: asiEl.clientHeight });
      if (c.rsi) { const w = el('rsi-wrap'); if (w) c.rsi.applyOptions({ width: w.clientWidth, height: w.clientHeight }); }
      if (c.macd) { const w2 = el('macd-wrap'); if (w2) c.macd.applyOptions({ width: w2.clientWidth, height: w2.clientHeight }); }
    }
    let ro: ResizeObserver | null = null;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(fit);
      ro.observe(chartEl); ro.observe(asiEl);
    }
    window.addEventListener('resize', fit);

    return () => {
      offs.forEach((off) => off());
      if (searchInput) searchInput.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', fit);
      if (ro) ro.disconnect();
      (['main', 'rsi', 'macd', 'asi'] as const).forEach((k) => {
        try { if (c[k]) (c[k] as IChartApi).remove(); } catch { /* noop */ }
        (c[k] as IChartApi | null) = null;
      });
      c.mainSeries = []; c.rsiSeries = null; c.macdLine = c.macdSig = c.macdHist = null;
    };
  }, []);

  /* ---- keep pill pressed-states in sync ---- */
  useEffect(() => {
    setPressed('sym-row', 'data-sym', sym);
    setPressed('tf-row', 'data-tf', tf);
    setPressed('type-row', 'data-type', ctype);
    const row = el('ind-row');
    if (row) {
      Array.prototype.forEach.call(row.querySelectorAll('button[data-ind]'), (x: Element) => {
        const k = x.getAttribute('data-ind') as keyof IndicatorState;
        x.setAttribute('aria-pressed', k && ind[k] ? 'true' : 'false');
      });
    }
  }, [sym, ctype, tf, ind]);

  /* ---- load stock history when the symbol changes ---- */
  useEffect(() => {
    const id = ++reqId.current;
    setLoading(true);
    const err = el('tv-err');
    if (err) { err.style.display = 'flex'; err.textContent = 'Loading chart…'; }
    getJSON<HistoryResponse>('/api/history?symbol=' + encodeURIComponent(sym)).then((j) => {
      if (id !== reqId.current) return;
      if (!j.prices || !j.prices.length) throw new Error('no data');
      setStockData(j.prices);
      setLoading(false);
      if (err) err.style.display = 'none';
    }).catch((e: unknown) => {
      if (id !== reqId.current) return;
      setStockData([]);
      setLoading(false);
      if (err) { err.style.display = 'flex'; err.textContent = 'Could not load ' + sym + ' data (' + ((e as Error)?.message || 'error') + ').'; }
    });
  }, [sym]);

  /* ---- draw: rebuilds all series from current state ---- */
  useEffect(() => {
    const c = charts.current;
    if (!c.main || loading) return;
    let prices = stockData;
    const n = prices.length;
    if (tf === '1m' && n > 22) prices = prices.slice(n - 22);
    if (tf === '3m' && n > 66) prices = prices.slice(n - 66);
    if (!prices.length) return;

    c.mainSeries.forEach((s) => { try { c.main!.removeSeries(s); } catch { /* noop */ } });
    c.mainSeries = [];

    const notes: string[] = [];
    const data = prices.map(sanitize);
    const dates = data.map((d) => d.time);
    const closes = data.map((d) => d.close);

    function addOverlayLine(values: Array<number | null>, color: string) {
      const s = c.main!.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      const sd: Array<{ time: string; value: number }> = [];
      for (let i = 0; i < dates.length; i++) {
        if (values[i] !== null && values[i] !== undefined) sd.push({ time: dates[i], value: values[i] as number });
      }
      s.setData(sd);
      c.mainSeries.push(s);
    }

    if (ind.compare) {
      const map: Record<string, number> = {};
      asiData.forEach((p) => { map[p.date] = p.value; });
      const sd: string[] = [], sv: number[] = [], av: number[] = [];
      data.forEach((d) => {
        if (map[d.time] !== undefined && map[d.time] !== null) { sd.push(d.time); sv.push(d.close); av.push(map[d.time]); }
      });
      if (!asiReady) {
        notes.push('ASI data still loading — comparison will appear in a moment.');
      } else if (sv.length < 2) {
        notes.push('Not enough overlapping ASI sessions to compare.');
      } else {
        const sb = sv[0], ab = av[0];
        const sPct: Array<{ time: string; value: number }> = [], aPct: Array<{ time: string; value: number }> = [];
        for (let i = 0; i < sv.length; i++) {
          sPct.push({ time: sd[i], value: (sv[i] / sb - 1) * 100 });
          aPct.push({ time: sd[i], value: (av[i] / ab - 1) * 100 });
        }
        const ls = c.main.addSeries(LineSeries, { color: '#0e9f6e', lineWidth: 2, title: sym + ' %' });
        ls.setData(sPct); c.mainSeries.push(ls);
        const as = c.main.addSeries(LineSeries, { color: '#32d9eb', lineWidth: 2, priceScaleId: 'asi', title: 'ASI %' });
        as.setData(aPct); c.mainSeries.push(as);
        c.main.priceScale('asi').applyOptions({ scaleMargins: { top: 0.12, bottom: 0.12 } });
      }
    } else if (ctype === 'candles') {
      const cs = c.main.addSeries(CandlestickSeries, { upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: false });
      cs.setData(data.map((d) => ({ time: d.time, open: d.open, high: d.high, low: d.low, close: d.close })));
      c.mainSeries.push(cs);
    } else {
      const ar = c.main.addSeries(AreaSeries, { lineColor: '#0e9f6e', topColor: 'rgba(14,159,110,0.35)', bottomColor: 'rgba(14,159,110,0.02)', lineWidth: 2, priceLineVisible: true });
      ar.setData(data.map((d) => ({ time: d.time, value: d.close })));
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

    const hasVol = data.some((d) => d.volume > 0);
    if (hasVol) {
      const vs = c.main.addSeries(HistogramSeries, { priceScaleId: '', priceFormat: { type: 'volume' } });
      c.main.priceScale('').applyOptions({ scaleMargins: { top: 0.86, bottom: 0 } });
      vs.setData(data.map((d) => ({
        time: d.time, value: d.volume,
        color: d.close >= d.open ? 'rgba(22,163,74,0.45)' : 'rgba(220,38,38,0.45)',
      })));
      c.mainSeries.push(vs);
    }

    /* RSI pane */
    const rsiWrap = el('rsi-wrap'), rsiCap = el('rsi-cap');
    const hideRsi = () => { if (rsiWrap) rsiWrap.hidden = true; if (rsiCap) rsiCap.hidden = true; };
    if (ind.rsi) {
      if (closes.length < 15) {
        if (c.rsi) { try { c.rsi.remove(); } catch { /* noop */ } c.rsi = null; c.rsiSeries = null; }
        hideRsi();
        notes.push('RSI 14 needs 15 sessions — history accumulates daily.');
      } else {
        if (rsiWrap) rsiWrap.hidden = false;
        if (!c.rsi && rsiWrap) {
          c.rsi = createChart(rsiWrap, { width: rsiWrap.clientWidth, height: rsiWrap.clientHeight, ...themeOpts() });
          c.rsiSeries = c.rsi.addSeries(LineSeries, { color: '#8b5cf6', lineWidth: 2, priceLineVisible: false });
          c.rsiSeries.createPriceLine({ price: 70, color: '#dc2626', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '70' });
          c.rsiSeries.createPriceLine({ price: 30, color: '#16a34a', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '30' });
        }
        if (c.rsiSeries && c.rsi) {
          const r = rsiWilder(closes, 14);
          const rd: Array<{ time: string; value: number }> = [];
          let last: number | null = null;
          for (let ri = 0; ri < dates.length; ri++) {
            if (r[ri] !== null) { rd.push({ time: dates[ri], value: r[ri] as number }); last = r[ri]; }
          }
          c.rsiSeries.setData(rd);
          c.rsi.timeScale().fitContent();
          if (rsiCap) {
            rsiCap.textContent = 'RSI (14)' + (last !== null ? ' · ' + (last as number).toFixed(2) : '') + ' — above 70 often reads overbought, below 30 oversold. Educational only, not advice.';
            rsiCap.hidden = false;
          }
        }
      }
    } else hideRsi();

    /* MACD pane */
    const macdWrap = el('macd-wrap'), macdCap = el('macd-cap');
    const hideMacd = () => { if (macdWrap) macdWrap.hidden = true; if (macdCap) macdCap.hidden = true; };
    if (ind.macd) {
      if (closes.length < 26) {
        if (c.macd) { try { c.macd.remove(); } catch { /* noop */ } c.macd = null; c.macdLine = c.macdSig = c.macdHist = null; }
        hideMacd();
        notes.push('MACD needs 26 sessions — history accumulates daily.');
      } else {
        if (macdWrap) macdWrap.hidden = false;
        if (!c.macd && macdWrap) {
          c.macd = createChart(macdWrap, { width: macdWrap.clientWidth, height: macdWrap.clientHeight, ...themeOpts() });
          c.macdHist = c.macd.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false });
          c.macdLine = c.macd.addSeries(LineSeries, { color: '#2563eb', lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
          c.macdSig = c.macd.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        }
        if (c.macdLine && c.macdSig && c.macdHist && c.macd) {
          const m = macdCalc(closes);
          const ld: Array<{ time: string; value: number }> = [];
          const sgd: Array<{ time: string; value: number }> = [];
          const hd: Array<{ time: string; value: number; color: string }> = [];
          for (let mi = 0; mi < dates.length; mi++) {
            if (m.line[mi] !== null) ld.push({ time: dates[mi], value: m.line[mi] as number });
            if (m.signal[mi] !== null) sgd.push({ time: dates[mi], value: m.signal[mi] as number });
            if (m.line[mi] !== null && m.signal[mi] !== null) {
              const v = (m.line[mi] as number) - (m.signal[mi] as number);
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

    const indNote = el('ind-note');
    if (indNote) {
      if (notes.length) { indNote.textContent = notes.join(' '); indNote.hidden = false; }
      else { indNote.textContent = ''; indNote.hidden = true; }
    }

    const first = data[0], last = data[data.length - 1];
    const chg = (last.close - first.close) / first.close * 100;
    const arrow = chg >= 0 ? '▲' : '▼';
    const active: string[] = [];
    if (ind.sma5) active.push('SMA 5');
    if (ind.sma20) active.push('SMA 20');
    if (ind.rsi) active.push('RSI 14');
    if (ind.macd) active.push('MACD');
    if (ind.compare) active.push('vs ASI (rebased %)');
    const asofEl = el('stock-asof');
    if (asofEl) asofEl.textContent = sym + ' · ' + data.length + ' sessions (' + fmtDate(first.time) + ' – ' + fmtDate(last.time) + ') · ' +
      money(last.close) + ' (' + arrow + ' ' + Math.abs(chg).toFixed(2) + '%)' +
      (active.length ? ' · ' + active.join(', ') : '') +
      ' · Nairaview market feed, daily closes — not live.';
  });

  return null;
}
