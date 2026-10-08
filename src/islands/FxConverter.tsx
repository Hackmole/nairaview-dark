import { useEffect, useState } from 'react';
import { getFx, fmtFx, fmtFxDate } from '../lib/fx.js';
import type { FxDoc } from '../lib/types.js';

/* React-owned FX converter. Adopts the existing card DOM (#fxAmount, #fxCcy,
   .fx-rate-toggle) and paints the result into #fxConvertResult /
   #fxConvertNote. Renders nothing itself. */

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
    const ccyEl = el('fxCcy') as HTMLSelectElement | null;
    function onAmt() { if (amtEl) { const v = parseFloat(amtEl.value); setAmount(isNaN(v) ? NaN : v); } }
    function onCcy() { if (ccyEl) setCcy(ccyEl.value); }
    if (amtEl) {
      amtEl.addEventListener('input', onAmt);
      const v0 = parseFloat(amtEl.value);
      if (!isNaN(v0)) setAmount(v0);
    }
    if (ccyEl) { ccyEl.addEventListener('change', onCcy); setCcy(ccyEl.value); }
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
      if (ccyEl) ccyEl.removeEventListener('change', onCcy);
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
