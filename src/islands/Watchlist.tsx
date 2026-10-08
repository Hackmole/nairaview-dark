import React, { useEffect, useMemo, useState } from 'react';
import { getJSON, toRow, dirArrow } from '../lib/api.js';
import type { DirectoryRow, PricesResponse } from '../lib/types.js';

/* React-owned watchlist page. Mounts on #watchList (watchlist.html).
   Reads the ngxWatchlist localStorage key (shared with stars across the
   site), paints instantly from the baked window.directory, then refreshes
   from /api/prices. Unstarring here updates the list immediately. */

function readWatchlist(): string[] {
  try { return JSON.parse(localStorage.getItem('ngxWatchlist') || '[]') as string[]; }
  catch { return []; }
}

export default function Watchlist(): React.ReactElement {
  const [stocks, setStocks] = useState<DirectoryRow[]>(() =>
    Array.isArray(window.directory) ? window.directory.slice() : []);
  const [watch, setWatch] = useState<string[]>(readWatchlist);

  /* refresh from the live API; baked snapshot stays on failure */
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

  /* keep in sync if stars change in another tab */
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === 'ngxWatchlist') setWatch(readWatchlist());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  function unstar(s: string) {
    setWatch((prev) => {
      const next = prev.filter((x) => x !== s);
      try { localStorage.setItem('ngxWatchlist', JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  }

  const rows = useMemo(() => {
    const bySym: Record<string, DirectoryRow> = {};
    stocks.forEach((e) => { bySym[e.s] = e; });
    return watch
      .map((s) => bySym[s])
      .filter((r): r is DirectoryRow => !!r)
      .sort((a, b) => (b.cv ?? -Infinity) - (a.cv ?? -Infinity));
  }, [stocks, watch]);

  useEffect(() => {
    const c = document.getElementById('watchCount2');
    if (c) c.textContent = rows.length ? rows.length + (rows.length === 1 ? ' stock' : ' stocks') : '';
  }, [rows.length]);

  function openStock(s: string, ev: React.MouseEvent) {
    if (window.nvOpenModal) { window.nvOpenModal(s, ev.currentTarget as Element); return; }
    window.location.href = 'stocks/' + s + '.html';
  }

  if (!watch.length) {
    return (
      <div className="empty-note">
        Your watchlist is empty. Tap the ☆ on any stock to follow it here.<br />
        <a href="screener">Open the screener &rarr;</a>
      </div>
    );
  }

  return (
    <>
      {rows.map((r) => {
        const badgeHTML = window.nvBadgeHTML ? window.nvBadgeHTML(r.s) : '';
        return (
          <div className="market-row" key={r.s}>
            <button
              type="button" className="star"
              aria-pressed="true"
              aria-label={'Remove ' + r.s + ' from watchlist'}
              onClick={(ev) => { ev.stopPropagation(); unstar(r.s); }}
            >★</button>
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
