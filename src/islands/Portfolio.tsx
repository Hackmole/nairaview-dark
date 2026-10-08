import React, { useEffect, useState } from 'react';
import type { Holding } from '../lib/types.js';

/* React-owned portfolio tracker. Mounts on #portfolioApp.
   - Auth: GET /api/holdings (credentials: include). 401 or unreachable →
     redirect to the account page, exactly like the vanilla version.
   - Prices: baked 5 Oct 2026 snapshot first, then live daily-close prices via
     the `nv:live-prices` CustomEvent dispatched by assets/live.js.
   - CRUD: add/update form, two-step confirm delete, per-row gain/loss on
     covered holdings only.
*/

const API = 'https://nairaview-api.meetomidiora.workers.dev';
const SNAPSHOT: Record<string, number> = {
  DANGCEM: 1066.7, SEPLAT: 16000.1, GTCO: 132.2, ZENITHBANK: 135.4,
  FIRSTHOLDCO: 150.15, UBA: 45, ACCESSCORP: 30.45, STANBIC: 164,
  TRANSCORP: 36.25, NESTLE: 2750, NB: 73.8,
};

interface HoldingsResponse { holdings?: Holding[] }
interface LivePricesEvent extends CustomEvent { detail: { map?: Record<string, number> } }

function naira(n: number): string {
  return '₦' + Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function api(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(API + path, { credentials: 'include', ...(opts || {}) });
}

interface FormState { ticker: string; shares: string; avg_cost: string }

export default function Portfolio(): React.ReactElement | null {
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>(SNAPSHOT);
  const [liveCount, setLiveCount] = useState(0);
  const [form, setForm] = useState<FormState>({ ticker: '', shares: '', avg_cost: '' });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [armedDel, setArmedDel] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  function load() {
    api('/api/holdings').then((res) => {
      if (res.status === 401) { window.location.href = 'account'; return null; }
      if (!res.ok) throw new Error('down');
      return res.json() as Promise<HoldingsResponse>;
    }).then((out) => {
      if (!out) return;
      setHoldings(out.holdings || []);
      setStatus('ready');
    }).catch(() => {
      window.location.href = 'account';
    });
  }

  useEffect(() => { load(); }, []);

  /* the static shell starts hidden until auth resolves; the island owns it now */
  useEffect(() => {
    const app = document.getElementById('portfolioApp');
    if (app) app.hidden = false;
  }, []);

  /* live prices override the snapshot when the daily feed arrives */
  useEffect(() => {
    function onLive(e: Event) {
      const map = ((e as LivePricesEvent).detail && (e as LivePricesEvent).detail.map) || {};
      let n = 0;
      const touched: string[] = [];
      Object.keys(map).forEach((t) => { if (map[t] > 0) touched.push(t); });
      if (!touched.length) return;
      setPrices((prev) => {
        const next = { ...prev };
        touched.forEach((t) => { next[t] = map[t]; });
        return next;
      });
      n = touched.length;
      setLiveCount(n);
    }
    window.addEventListener('nv:live-prices', onLive);
    return () => { window.removeEventListener('nv:live-prices', onLive); };
  }, []);

  /* disarm the delete confirm after 5s */
  useEffect(() => {
    if (!armedDel) return;
    const t = setTimeout(() => { setArmedDel(null); }, 5000);
    return () => { clearTimeout(t); };
  }, [armedDel]);

  function submitHolding(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    const payload = {
      ticker: form.ticker.trim().toUpperCase(),
      shares: parseFloat(form.shares),
      avg_cost: parseFloat(form.avg_cost),
    };
    setSaving(true);
    api('/api/holdings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((res) => res.json().then((out: { error?: string }) => ({ res, out })))
      .then((r) => {
        setSaving(false);
        if (!r.res.ok) { setFormError(r.out.error || 'Could not save.'); return; }
        setForm({ ticker: '', shares: '', avg_cost: '' });
        load();
      }).catch(() => {
        setSaving(false);
        setFormError('Could not reach the server.');
      });
  }

  function removeHolding(ticker: string) {
    if (armedDel !== ticker) { setArmedDel(ticker); return; }
    setDeleting(ticker);
    api('/api/holdings?ticker=' + encodeURIComponent(ticker), { method: 'DELETE' })
      .then(() => { setDeleting(null); setArmedDel(null); load(); })
      .catch(() => { setDeleting(null); setArmedDel(null); });
  }

  if (status === 'loading') return null; /* static page shows nothing until authed */

  let totValue = 0, totCost = 0, totCoveredCost = 0, valued = false;
  const rows = holdings.map((h) => {
    const price = prices[h.ticker];
    const cost = h.shares * h.avg_cost;
    totCost += cost;
    let value: number | null = null, gain: number | null = null;
    if (price !== undefined) {
      value = h.shares * price;
      gain = value - cost;
      totValue += value; totCoveredCost += cost; valued = true;
    }
    return { h, price, cost, value, gain };
  });
  const totGain = totValue - totCoveredCost;

  const upd = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <div className="facts" id="portfolioTotals">
        <div className="fact">
          <span>Total value</span>
          <strong id="totValue">{valued ? naira(totValue) : '—'}</strong>
        </div>
        <div className="fact">
          <span>Total cost</span>
          <strong id="totCost">{naira(totCost)}</strong>
        </div>
        <div className="fact">
          <span>Gain / loss (covered)</span>
          <strong id="totGain" style={{ color: valued ? (totGain >= 0 ? 'var(--green-strong)' : 'var(--red)') : '' }}>
            {valued ? (totGain >= 0 ? '+' : '') + naira(totGain) : '—'}
          </strong>
        </div>
      </div>
      <p className="asof" id="priceNote">
        {liveCount
          ? 'Valued at the latest daily-close prices, refreshed after each market close. Gain/loss is calculated on covered holdings only.'
          : 'Valued at Nairaview\u2019s 5 Oct 2026 snapshot prices — not live. Prices exist for 11 covered stocks; other holdings show cost only, and gain/loss is calculated on covered holdings only.'}
      </p>
      <p className="form-note"><a href="account">Account settings &amp; log out</a></p>
      <div className="movers-col">
        <table className="movers-table" id="holdingsTable">
          <tbody>
            <tr>
              <th style={{ textAlign: 'left' }}>Ticker</th>
              <th>Shares</th><th>Avg cost</th><th>Price</th><th>Value</th><th>Gain/loss</th><th></th>
            </tr>
            {rows.map((r) => {
              const h = r.h;
              const badge = window.nvBadgeHTML ? window.nvBadgeHTML(h.ticker, 'sm') + ' ' : '';
              const gainColor = (r.gain as number) >= 0 ? 'var(--green-strong)' : 'var(--red)';
              return (
                <tr key={h.ticker}>
                  <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                    <span dangerouslySetInnerHTML={{ __html: badge }} />
                    <strong><a href={'stocks/' + h.ticker + '.html'}>{h.ticker}</a></strong>
                  </td>
                  <td className="num">{Number(h.shares).toLocaleString('en-NG')}</td>
                  <td className="num">{naira(h.avg_cost)}</td>
                  <td className="num">{r.price !== undefined ? naira(r.price) : '—'}</td>
                  <td className="num">{r.value !== null ? naira(r.value as number) : '—'}</td>
                  <td className="num">
                    {r.gain !== null
                      ? <span style={{ color: gainColor }}>{((r.gain as number) >= 0 ? '+' : '') + naira(r.gain as number)}</span>
                      : '—'}
                  </td>
                  <td>
                    <button
                      type="button" className="btn-ghost btn-sm"
                      disabled={deleting === h.ticker}
                      onClick={() => removeHolding(h.ticker)}
                    >{deleting === h.ticker ? 'Removing…' : armedDel === h.ticker ? 'Confirm remove?' : 'Remove'}</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {holdings.length === 0 && <p className="guide-p" id="emptyMsg">You have no holdings yet — add your first one below.</p>}
      <h2 className="guide-h2">Add or update a holding</h2>
      <form id="holdingForm" className="auth-form" onSubmit={submitHolding}>
        <label>Ticker
          <input name="ticker" required maxLength={12} placeholder="GTCO" style={{ textTransform: 'uppercase' }} value={form.ticker} onChange={upd('ticker')} />
        </label>
        <label>Shares
          <input name="shares" required type="number" min={0} step="any" placeholder="100" value={form.shares} onChange={upd('shares')} />
        </label>
        <label>Average cost per share (₦)
          <input name="avg_cost" required type="number" min={0} step="any" placeholder="120.50" value={form.avg_cost} onChange={upd('avg_cost')} />
        </label>
        {formError && <p className="form-error" id="holdingError" role="alert">{formError}</p>}
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save holding'}</button>
        <p className="form-note">Saving the same ticker again updates it. This is a personal tracker — not connected to your broker.</p>
      </form>
    </>
  );
}
