/* Nairaview React islands — entry point.
   Islands architecture: the static HTML pages stay exactly as they are
   (SEO-safe, post-pull-refresh-safe). React mounts only on [data-island]
   regions and owns the interactive rendering there. If the bundle fails to
   load, every page keeps working in its static/vanilla form.

   Adding an island:
   1. Create src/islands/MyIsland.jsx (default export, React component).
   2. Register it in ISLANDS below.
   3. In the HTML page, add data-island="my-island" to the mount element and,
      if the island replaces vanilla site.js behavior, set
      window.NV_ISLANDS['my-island'] = true in a small inline script BEFORE
      the site.js script tag so site.js skips its own version.
   4. Run `npm run build` and commit the rebuilt assets/islands.js
      (bump the ?v= query param on the script tag like other assets).
*/
import React from 'react';
import { createRoot } from 'react-dom/client';
import Screener from './islands/Screener.jsx';
import ChartLab from './islands/ChartLab.jsx';
import Portfolio from './islands/Portfolio.jsx';
import FxConverter from './islands/FxConverter.jsx';
import FxCcy from './islands/FxCcy.jsx';

var ISLANDS = {
  screener: Screener,
  'chart-lab': ChartLab,
  portfolio: Portfolio,
  'fx-converter': FxConverter,
  'fx-ccy': FxCcy,
};

/* Adopt-style islands (ChartLab, FX) return null and manage existing page DOM
   via effects. React 19's createRoot() wipes its container's children on
   mount, so these must NEVER mount on the content element itself — they get
   a detached holder div instead. Render-style islands (Screener, Portfolio)
   own their container's contents and mount on it directly. */
var ADOPT = {
  'chart-lab': true,
  'fx-converter': true,
  'fx-ccy': true,
};

function mount() {
  document.querySelectorAll('[data-island]').forEach(function (el) {
    var name = el.getAttribute('data-island');
    var Comp = ISLANDS[name];
    if (!Comp || el.dataset.islandMounted) return;
    el.dataset.islandMounted = '1';
    var host = el;
    if (ADOPT[name]) {
      host = document.createElement('div');
      host.setAttribute('data-island-host', name);
      host.style.display = 'none';
      document.body.appendChild(host);
    }
    try {
      /* mount element dataset (e.g. data-ccy) is passed as props */
      createRoot(host).render(React.createElement(Comp, Object.assign({}, el.dataset)));
    } catch (e) {
      /* leave the static content untouched on failure */
      delete el.dataset.islandMounted;
      if (host !== el) host.remove();
    }
  });
}

window.NV_ISLANDS = window.NV_ISLANDS || {};
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
