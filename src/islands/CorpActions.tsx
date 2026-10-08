import { useEffect, useState } from 'react';

/* React-owned corporate actions feed. Mounts on #corp-actions-section
   (corporate-actions.html). Reads the curated assets/corporate-actions.json
   (verified NGX filings) and renders a type-badged action list. */

interface CorpAction {
  ticker: string;
  company: string;
  type: 'bonus' | 'rights' | 'delisting' | 'split' | 'merger';
  title: string;
  detail: string;
  date: string | null;
  status: string;
  source: string;
}

interface CaDoc {
  actions: CorpAction[];
  updated: string;
  note: string;
}

const TYPE_STYLE: Record<string, { label: string; color: string }> = {
  bonus: { label: 'BONUS', color: 'var(--green-strong)' },
  rights: { label: 'RIGHTS', color: 'var(--blue)' },
  split: { label: 'SPLIT', color: 'var(--blue)' },
  delisting: { label: 'DELISTED', color: 'var(--red)' },
  merger: { label: 'M&A', color: 'var(--gold)' },
};

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const m = iso.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return Number(m[3]) + ' ' + M[Number(m[2]) - 1] + ' ' + m[1];
}

export default function CorpActions(): null {
  const [doc, setDoc] = useState<CaDoc | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('assets/corporate-actions.json')
      .then((r) => { if (!r.ok) throw new Error('bad status'); return r.json() as Promise<CaDoc>; })
      .then((d) => { if (alive) setDoc(d); })
      .catch(() => { /* feed stays empty with the note */ });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!doc) return;
    const host = document.getElementById('caList');
    if (host) {
      const rows = doc.actions.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      host.innerHTML = rows.map((a) => {
        const st = TYPE_STYLE[a.type] || { label: a.type.toUpperCase(), color: 'var(--muted)' };
        const badge = window.nvBadgeHTML ? window.nvBadgeHTML(a.ticker) : '';
        return '<article class="news-card" style="margin-bottom:14px">' +
          '<div><span class="otag" style="border-color:' + st.color + ';color:' + st.color + '">' + st.label + '</span> ' +
          '<span style="color:var(--muted);font-size:12px">' + fmtDate(a.date) + ' · ' + a.status + '</span></div>' +
          '<h3 style="margin:10px 0 6px">' + badge + ' ' + a.title + ' — ' + a.company + '</h3>' +
          '<p style="color:var(--muted);font-size:14px;line-height:1.6">' + a.detail + '</p>' +
          '<p style="font-size:12px;color:var(--muted)">Source: ' + a.source + '</p></article>';
      }).join('');
    }
    const note = document.getElementById('caNote');
    if (note) note.textContent = doc.note + ' Last verified ' + fmtDate(doc.updated) + '.';
  }, [doc]);

  return null;
}
