import { useEffect, useState } from 'react';
import { getFx, fmtFx, fmtFxDate } from '../lib/fx.js';

/* React-owned FX converter. Adopts the existing card DOM (#fxAmount, #fxCcy,
   .fx-rate-toggle) and paints the result into #fxConvertResult /
   #fxConvertNote. Renders nothing itself. */

function el(id) { return document.getElementById(id); }

export default function FxConverter() {
  var [amount, setAmount] = useState(100);
  var [ccy, setCcy] = useState('USD');
  var [leg, setLeg] = useState('official');
  var [rates, setRates] = useState(null);

  useEffect(function () {
    var alive = true;
    getFx().then(function (doc) {
      if (alive) setRates((doc && doc.latest) || null);
    });
    var amtEl = el('fxAmount'), ccyEl = el('fxCcy');
    function onAmt() { var v = parseFloat(amtEl.value); setAmount(isNaN(v) ? NaN : v); }
    function onCcy() { setCcy(ccyEl.value); }
    if (amtEl) { amtEl.addEventListener('input', onAmt); if (amtEl.value) { var v0 = parseFloat(amtEl.value); if (!isNaN(v0)) setAmount(v0); } }
    if (ccyEl) { ccyEl.addEventListener('change', onCcy); setCcy(ccyEl.value); }
    var toggles = Array.prototype.slice.call(document.querySelectorAll('.fx-rate-toggle'));
    function onToggle(e) {
      var b = e.currentTarget;
      var l = b.getAttribute('data-leg');
      setLeg(l);
      toggles.forEach(function (t) {
        var on = t === b;
        t.classList.toggle('active', on);
        t.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    toggles.forEach(function (t) { t.addEventListener('click', onToggle); });
    return function () {
      alive = false;
      if (amtEl) amtEl.removeEventListener('input', onAmt);
      if (ccyEl) ccyEl.removeEventListener('change', onCcy);
      toggles.forEach(function (t) { t.removeEventListener('click', onToggle); });
    };
  }, []);

  useEffect(function () {
    var res = el('fxConvertResult'), note = el('fxConvertNote');
    if (!res) return;
    var legs = rates && rates[ccy];
    if (!legs || !(legs[leg] > 0) || !(amount >= 0) || isNaN(amount)) {
      res.textContent = '₦—';
      if (note) note.textContent = 'Rate loading…';
      return;
    }
    res.textContent = fmtFx(amount * legs[leg]);
    if (note) {
      var legName = leg === 'official' ? 'official NFEM rate' : 'indicative street rate';
      note.textContent = amount.toLocaleString('en-NG') + ' ' + ccy + ' at the ' + legName + ' · ' + fmtFxDate(legs.official_date);
    }
  });

  return null;
}
