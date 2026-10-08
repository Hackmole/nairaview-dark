import { useEffect, useState } from 'react';
import { getJSON, fmt2 } from '../lib/api.js';
import type { PricesResponse } from '../lib/types.js';

/* React-owned dividend hub. Mounts on #dividends-section (dividends.html).
   Reads the curated assets/dividends.json (verified NGX disclosures) and
   renders: upcoming payouts, the full 2026 table, and a live yield
   leaderboard (2026 declared DPS ÷ latest price from /api/prices).
   Yields are explicitly labeled as based on declared 2026 dividends. */

interface Dividend {
  ticker: string;
  company: string;
  amount: number;
  period: string;
  qualification_date: string | null;
  register_closure: string | null;
  payment_date: string | null;
  source: string;
}

interface DivDoc {
  dividends: Dividend[];
  updated: string;
  note: string;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const m = iso.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return Number(m[3]) + ' ' + M[Number(m[2]) - 1] + ' ' + m[1];
}

function money(n: number): string {
  return '₦' + fmt2(n);
}

export default function Dividends(): null {
  const [doc, setDoc] = useState<DivDoc | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});

  useEffect(() => {
    let alive = true;
    fetch('assets/dividends.json?v=20261008a')
      .then((r) => { if (!r.ok) throw new Error('bad status'); return r.json() as Promise<DivDoc>; })
      .then((d) => { if (alive) setDoc(d); })
      .catch(() => { /* section stays as-is */ });
    getJSON<PricesResponse>('/api/prices')
      .then((p) => {
        const list = p && p.stocks && p.stocks.stocks;
        if (!alive || !list) return;
        const map: Record<string, number> = {};
        list.forEach((s) => { if (s.current_price > 0) map[s.symbol] = Number(s.current_price); });
        setPrices(map);
      })
      .catch(() => { /* yields fall back to no-price state */ });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!doc) return;
    const today = new Date().toISOString().slice(0, 10);
    const badge = (s: string) => (window.nvBadgeHTML ? window.nvBadgeHTML(s) : '');

    /* upcoming: qualification date today or later */
    const upcoming = doc.dividends
      .filter((d) => d.qualification_date && d.qualification_date >= today)
      .sort((a, b) => (a.qualification_date as string).localeCompare(b.qualification_date as string));

    const upEl = document.getElementById('divUpcoming');
    if (upEl) {
      upEl.innerHTML = upcoming.length ? upcoming.map((d) => (
        '<article class="fx-card"><div class="fx-label">' + d.company + '</div>' +
        '<div class="fx-value">' + money(d.amount) + ' <span style="font-size:14px;color:var(--muted)">/ share</span></div>' +
        '<div class="fx-sub">' + d.period + ' · qualifies ' + fmtDate(d.qualification_date) +
        (d.payment_date ? ' · paid ' + fmtDate(d.payment_date) : '') + '</div>' +
        '<div class="fx-sub"><a href="stocks/' + d.ticker + '.html">' + d.ticker + ' stock page &rarr;</a></div></article>'
      )).join('') : '<div class="empty-note">No upcoming payouts in the verified list.</div>';
      upEl.className = 'fx-grid';
    }

    /* full 2026 table */
    const tb = document.getElementById('divTableBody');
    if (tb) {
      const rows = doc.dividends.slice().sort((a, b) =>
        (b.qualification_date || '').localeCompare(a.qualification_date || ''));
      tb.innerHTML = rows.map((d) => (
        '<tr><td style="text-align:left;white-space:nowrap">' + badge(d.ticker) + ' <strong>' + d.ticker + '</strong><br><span style="color:var(--muted);font-size:12px">' + d.company + '</span></td>' +
        '<td>' + d.period + '</td><td class="num">' + money(d.amount) + '</td>' +
        '<td>' + fmtDate(d.qualification_date) + '</td><td>' + fmtDate(d.payment_date) + '</td>' +
        '<td style="text-align:left;font-size:12px;color:var(--muted)">' + d.source + '</td></tr>'
      )).join('');
    }

    /* yield leaderboard: 2026 declared DPS ÷ latest price */
    const perTicker: Record<string, number> = {};
    doc.dividends.forEach((d) => { perTicker[d.ticker] = (perTicker[d.ticker] || 0) + d.amount; });
    const yb = document.getElementById('divYieldBody');
    const yn = document.getElementById('divYieldNote');
    if (yb) {
      const rows = Object.keys(perTicker)
        .map((t) => ({ t, dps: perTicker[t], price: prices[t] }))
        .filter((r) => r.price && r.price > 0)
        .map((r) => ({ ...r, y: (r.dps / (r.price as number)) * 100 }))
        .sort((a, b) => b.y - a.y);
      const comp = (t: string) => {
        const d = doc.dividends.find((x) => x.ticker === t);
        return d ? d.company : t;
      };
      yb.innerHTML = rows.length ? rows.map((r) => (
        '<tr><td style="text-align:left;white-space:nowrap">' + badge(r.t) + ' <strong>' + r.t + '</strong><br><span style="color:var(--muted);font-size:12px">' + comp(r.t) + '</span></td>' +
        '<td class="num">' + money(r.dps) + '</td><td class="num">' + money(r.price as number) + '</td>' +
        '<td class="num"><strong>' + r.y.toFixed(2) + '%</strong></td></tr>'
      )).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--muted)">Price data unavailable — yields will appear when the feed loads.</td></tr>';
    }
    if (yn) yn.textContent = 'Yield = total dividends declared in 2026 ÷ latest close price. Only verified declarations are included; coverage grows as more are confirmed.';
  }, [doc, prices]);

  return null;
}
