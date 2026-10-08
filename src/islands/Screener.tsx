import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getJSON, toRow, dirArrow } from '../lib/api.js';
import type { DirectoryRow, PricesResponse } from '../lib/types.js';

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

const MOVER_OPTS: Array<[string, string]> = [
  ['all', 'All'],
  ['gainers', 'Gainers'],
  ['losers', 'Losers'],
  ['volume', 'Most traded'],
];

interface FilterState {
  mover: string;
  sector: string;
  minP: string;
  maxP: string;
  minC: string;
  maxC: string;
  sort: string;
}

function readWatchlist(): string[] {
  try { return JSON.parse(localStorage.getItem('ngxWatchlist') || '[]') as string[]; }
  catch { return []; }
}

function chgKey(e: DirectoryRow, what: 'chg' | 'price' | 'vol'): number | null {
  if (what === 'chg') return !e.vol && e.pv !== null && e.pv !== undefined && !e.noSnap ? (e.cv as number) : null;
  if (what === 'price') return e.pv ?? null;
  if (what === 'vol') return e.vol ? (e.cv as number) : null;
  return null;
}

function applyFilters(rows: DirectoryRow[], f: FilterState): DirectoryRow[] {
  const minP = parseFloat(f.minP), maxP = parseFloat(f.maxP);
  const minC = parseFloat(f.minC), maxC = parseFloat(f.maxC);
  const priceOn = !isNaN(minP) || !isNaN(maxP);
  const chgOn = !isNaN(minC) || !isNaN(maxC);
  const out = rows.filter((e) => {
    if (f.mover === 'gainers' && !(!e.vol && e.d === 'up')) return false;
    if (f.mover === 'losers' && e.d !== 'down') return false;
    if (f.mover === 'volume' && !e.vol) return false;
    if (f.sector !== 'All' && e.g !== f.sector) return false;
    if (priceOn) {
      if (e.pv === null || e.pv === undefined) return false;
      if (!isNaN(minP) && (e.pv as number) < minP) return false;
      if (!isNaN(maxP) && (e.pv as number) > maxP) return false;
    }
    if (chgOn) {
      const c = chgKey(e, 'chg');
      if (c === null) return false;
      if (!isNaN(minC) && c < minC) return false;
      if (!isNaN(maxC) && c > maxC) return false;
    }
    return true;
  });
  const key = f.sort;
  out.sort((a, b) => {
    if (key === 'name') return a.s < b.s ? -1 : a.s > b.s ? 1 : 0;
    const wk = key === 'vol-desc' ? 'vol' : key.indexOf('chg') === 0 ? 'chg' : 'price';
    const ka = chgKey(a, wk as 'chg' | 'price' | 'vol'), kb = chgKey(b, wk as 'chg' | 'price' | 'vol');
    if (ka === null && kb === null) return 0;
    if (ka === null) return 1;
    if (kb === null) return -1;
    return key === 'chg-asc' || key === 'price-asc' ? ka - kb : kb - ka;
  });
  return out;
}

function inputVal(id: string): string {
  const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
  return el ? el.value : '';
}

export default function Screener(): React.ReactElement {
  const [stocks, setStocks] = useState<DirectoryRow[]>(() =>
    Array.isArray(window.directory) ? window.directory.slice() : []);
  const [watch, setWatch] = useState<string[]>(readWatchlist);
  const [f, setF] = useState<FilterState>({ mover: 'all', sector: 'All', minP: '', maxP: '', minC: '', maxC: '', sort: 'chg-desc' });

  const sectors = useMemo(() => {
    const s: Record<string, boolean> = {};
    stocks.forEach((e) => { if (e.g) s[e.g] = true; });
    return ['All'].concat(Object.keys(s).sort());
  }, [stocks]);

  /* Build the mover chips + sector options (vanilla did this in site.js). */
  useEffect(() => {
    const host = document.getElementById('screenMover');
    if (host && !host.children.length) {
      MOVER_OPTS.forEach((opt) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'sector-chip'; b.textContent = opt[1];
        b.setAttribute('aria-pressed', opt[0] === 'all' ? 'true' : 'false');
        b.dataset.mover = opt[0];
        host.appendChild(b);
      });
    }
    const sel = document.getElementById('screenSector') as HTMLSelectElement | null;
    if (sel && !sel.options.length) {
      sectors.forEach((g) => {
        const o = document.createElement('option'); o.value = g; o.textContent = g; sel.appendChild(o);
      });
    }
  }, [sectors]);

  /* Wire the static controls into React state. */
  useEffect(() => {
    function sync() {
      const pressed = document.querySelector('#screenMover .sector-chip[aria-pressed="true"]') as HTMLElement | null;
      setF({
        mover: (pressed && pressed.dataset.mover) || 'all',
        sector: inputVal('screenSector') || 'All',
        minP: inputVal('screenMinP'), maxP: inputVal('screenMaxP'),
        minC: inputVal('screenMinC'), maxC: inputVal('screenMaxC'),
        sort: inputVal('screenSort') || 'chg-desc',
      });
    }
    const host = document.getElementById('screenMover');
    function onChip(e: Event) {
      const b = (e.target as HTMLElement).closest('.sector-chip') as HTMLElement | null;
      if (!b || !host) return;
      host.querySelectorAll('.sector-chip').forEach((c) => {
        c.setAttribute('aria-pressed', c === b ? 'true' : 'false');
      });
      sync();
    }
    if (host) host.addEventListener('click', onChip);
    const ids = ['screenSector', 'screenMinP', 'screenMaxP', 'screenMinC', 'screenMaxC', 'screenSort'];
    const els = ids
      .map((id) => document.getElementById(id))
      .filter((e): e is HTMLElement => !!e);
    els.forEach((el) => {
      el.addEventListener('change', sync); el.addEventListener('input', sync);
    });
    sync();
    return () => {
      if (host) host.removeEventListener('click', onChip);
      els.forEach((el) => { el.removeEventListener('change', sync); el.removeEventListener('input', sync); });
    };
  }, []);

  /* Refresh from the live API; baked snapshot stays on failure. */
  useEffect(() => {
    let cancelled = false;
    getJSON<PricesResponse>('/api/prices')
      .then((doc) => {
        const list = doc && doc.stocks && doc.stocks.stocks;
        if (cancelled || !list || !list.length) return;
        const bySym: Record<string, DirectoryRow> = {};
        list.map(toRow).forEach((r) => { bySym[r.s] = r; });
        setStocks((prev) => prev.map((e) => {
          const liveR = bySym[e.s];
          return liveR ? { ...e, p: liveR.p, m: liveR.m, d: liveR.d, pv: liveR.pv, cv: liveR.cv, vol: false, noSnap: false } : e;
        }));
      })
      .catch(() => { /* keep baked snapshot */ });
    return () => { cancelled = true; };
  }, []);

  function toggleStar(s: string) {
    setWatch((prev) => {
      const i = prev.indexOf(s);
      const next = i === -1 ? prev.concat([s]) : prev.slice(0, i).concat(prev.slice(i + 1));
      try { localStorage.setItem('ngxWatchlist', JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }

  const rows = useMemo(() => applyFilters(stocks, f), [stocks, f]);

  useEffect(() => {
    const el = document.getElementById('screenCount');
    if (el) el.textContent = rows.length + (rows.length === 1 ? ' stock' : ' stocks');
  }, [rows.length]);

  function openStock(s: string, ev: React.MouseEvent) {
    if (window.nvOpenModal) { window.nvOpenModal(s, ev.currentTarget as Element); return; }
    window.location.href = 'stocks/' + s + '.html';
  }

  if (!rows.length) {
    return <div className="empty-note">No stocks match these filters.</div>;
  }

  return (
    <>
      {rows.map((r) => {
        const starred = watch.indexOf(r.s) !== -1;
        const badgeHTML = window.nvBadgeHTML ? window.nvBadgeHTML(r.s) : '';
        return (
          <div className="market-row" key={r.s}>
            <button
              type="button" className="star"
              aria-pressed={starred ? 'true' : 'false'}
              aria-label={(starred ? 'Remove ' : 'Add ') + r.s + (starred ? ' from' : ' to') + ' watchlist'}
              onClick={(ev) => { ev.stopPropagation(); toggleStar(r.s); }}
            >{starred ? '★' : '☆'}</button>
            <button
              type="button" className="row-main"
              aria-label={r.s + ', ' + r.c + ' — view details'}
              onClick={(ev) => openStock(r.s, ev)}
            >
              <span dangerouslySetInnerHTML={{ __html: badgeHTML }} />
              <span className="row-text">
                <span className="symbol">{r.s}<span className="list-tag">{r.g}</span></span>
                <span className="company">{r.c}</span>
              </span>
            </button>
            <div className="price">{r.p || '—'}</div>
            <div className={'move ' + (r.d || '')}>
              {r.vol ? (r.m || '') + ' shares' : dirArrow(r.cv) + (r.m || '')}
            </div>
          </div>
        );
      })}
    </>
  );
}
