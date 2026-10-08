import { useEffect, useState } from 'react';
import { getFx, fmtFx, fmtFxDate } from '../lib/fx.js';
import type { FxDoc } from '../lib/types.js';

/* React-owned FX converter. Adopts the existing card DOM (#fxAmount, the custom
   currency dropdown #fxCcyDrop, .fx-rate-toggle) and paints the result into
   #fxConvertResult / #fxConvertNote. Renders nothing itself. */

function el(id: string): HTMLElement | null { return document.getElementById(id); }

export default function FxConverter(): null {
  const [amount, setAmount] = useState<number>(100);
  const [ccy, setCcy] = useState('USD');
  const [leg, setLeg] = useState('official');
  const [rates, setRates] = useState<FxDoc['latest'] | null>(null);

  useEffect(() => {
    let alive = true;
    getFx().then((doc) => { if (alive) setRates((doc && doc.latest) || null); });
    const amtEl = el('fxAmount') as HTMLInputElement | null;
    function onAmt() { if (amtEl) { const v = parseFloat(amtEl.value); setAmount(isNaN(v) ? NaN : v); } }
    if (amtEl) {
      amtEl.addEventListener('input', onAmt);
      const v0 = parseFloat(amtEl.value);
      if (!isNaN(v0)) setAmount(v0);
    }
    /* Custom currency dropdown (a native select's option list can't be styled
       reliably, so this listbox replaces it). */
    const btn = el('fxCcyBtn') as HTMLButtonElement | null;
    const list = el('fxCcyList');
    const label = el('fxCcyLabel');
    const opts = list ? Array.prototype.slice.call(list.querySelectorAll('[role="option"]')) as HTMLElement[] : [];
    let cur = 'USD';
    let isOpen = false;
    let focusIdx = 0;
    function paint() {
      opts.forEach((o) => {
        o.setAttribute('aria-selected', o.getAttribute('data-ccy') === cur ? 'true' : 'false');
        o.classList.remove('fx-focus');
      });
      if (label) label.textContent = cur;
      if (btn) btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      if (list) list.hidden = !isOpen;
    }
    function choose(v: string) {
      cur = v;
      setCcy(v);
      isOpen = false;
      paint();
      if (btn) btn.focus();
    }
    function openList() {
      isOpen = true;
      focusIdx = Math.max(0, opts.findIndex((o) => o.getAttribute('data-ccy') === cur));
      paint();
    }
    function onBtnClick() { if (isOpen) { isOpen = false; paint(); } else openList(); }
    function onOptClick(e: Event) {
      const v = (e.currentTarget as HTMLElement).getAttribute('data-ccy');
      if (v) choose(v);
    }
    function onDocClick(e: Event) {
      if (isOpen && !(e.target as HTMLElement).closest('#fxCcyDrop')) { isOpen = false; paint(); }
    }
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (!isOpen) {
        if (t === btn && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openList(); }
        return;
      }
      if (e.key === 'Escape') { isOpen = false; paint(); if (btn) btn.focus(); }
      else if (t === btn && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); isOpen = false; paint(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        focusIdx = (focusIdx + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length;
        opts.forEach((o, i) => o.classList.toggle('fx-focus', i === focusIdx));
        opts[focusIdx].focus();
      } else if ((e.key === 'Enter' || e.key === ' ') && t.getAttribute('role') === 'option') {
        e.preventDefault();
        const v = t.getAttribute('data-ccy');
        if (v) choose(v);
      }
    }
    if (btn) btn.addEventListener('click', onBtnClick);
    opts.forEach((o) => o.addEventListener('click', onOptClick));
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    const toggles = Array.prototype.slice.call(document.querySelectorAll('.fx-rate-toggle')) as HTMLElement[];
    function onToggle(e: Event) {
      const b = e.currentTarget as HTMLElement;
      setLeg(b.getAttribute('data-leg') || 'official');
      toggles.forEach((t) => {
        const on = t === b;
        t.classList.toggle('active', on);
        t.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    toggles.forEach((t) => { t.addEventListener('click', onToggle); });
    return () => {
      alive = false;
      if (amtEl) amtEl.removeEventListener('input', onAmt);
      if (btn) btn.removeEventListener('click', onBtnClick);
      opts.forEach((o) => o.removeEventListener('click', onOptClick));
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
      toggles.forEach((t) => { t.removeEventListener('click', onToggle); });
    };
  }, []);

  useEffect(() => {
    const res = el('fxConvertResult'), note = el('fxConvertNote');
    if (!res) return;
    const legs = rates && rates[ccy];
    const rate = legs ? legs[leg as 'official' | 'parallel'] : undefined;
    if (!legs || !(rate && rate > 0) || !(amount >= 0) || isNaN(amount)) {
      res.textContent = '₦—';
      if (note) note.textContent = 'Rate loading…';
      return;
    }
    res.textContent = fmtFx(amount * (rate as number));
    if (note) {
      const legName = leg === 'official' ? 'official NFEM rate' : 'indicative street rate';
      note.textContent = amount.toLocaleString('en-NG') + ' ' + ccy + ' at the ' + legName + ' · ' + fmtFxDate(legs!.official_date);
    }
  });

  return null;
}
