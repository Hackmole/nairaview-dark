import { useEffect, useState } from 'react';

/* React-owned insider dealings feed. Mounts on #insider-section
   (insider-dealings.html). Reads the curated assets/insider-dealings.json
   (NGX insider-dealing filings) and renders the transactions table. */

interface Deal {
  ticker: string;
  company: string;
  insider: string;
  role: string;
  side: 'buy' | 'sell';
  shares: number;
  price: number;
  date: string | null;
  disclosed: string | null;
  source: string;
}

interface InsiderDoc {
  deals: Deal[];
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
  return '₦' + Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function InsiderDeals(): null {
  const [doc, setDoc] = useState<InsiderDoc | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('assets/insider-dealings.json')
      .then((r) => { if (!r.ok) throw new Error('bad status'); return r.json() as Promise<InsiderDoc>; })
      .then((d) => { if (alive) setDoc(d); })
      .catch(() => { /* table stays empty */ });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!doc) return;
    const tb = document.getElementById('insiderBody');
    if (tb) {
      const rows = doc.deals.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      tb.innerHTML = rows.map((d) => {
        const badge = window.nvBadgeHTML ? window.nvBadgeHTML(d.ticker) : '';
        const sideColor = d.side === 'buy' ? 'var(--green-strong)' : 'var(--red)';
        const value = d.shares * d.price;
        return '<tr><td style="text-align:left"><strong>' + d.insider + '</strong><br><span style="color:var(--muted);font-size:12px">' + d.role + '</span></td>' +
          '<td style="text-align:left;white-space:nowrap">' + badge + ' <strong>' + d.ticker + '</strong></td>' +
          '<td><span style="color:' + sideColor + ';font-weight:700">' + d.side.toUpperCase() + '</span></td>' +
          '<td class="num">' + d.shares.toLocaleString('en-NG') + '</td>' +
          '<td class="num">' + money(d.price) + '</td>' +
          '<td class="num">' + money(value) + '</td>' +
          '<td>' + fmtDate(d.date) + '</td></tr>';
      }).join('');
    }
    const note = document.getElementById('insiderNote');
    if (note) note.textContent = doc.note + ' Last verified ' + fmtDate(doc.updated) + '.';
  }, [doc]);

  return null;
}
