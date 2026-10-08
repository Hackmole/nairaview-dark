/* Nairaview React islands — entry point.
   Islands architecture: the static HTML pages stay exactly as they are
   (SEO-safe, post-pull-refresh-safe). React mounts only on [data-island]
   regions and owns the interactive rendering there. If the bundle fails to
   load, every page keeps working in its static/vanilla form.

   Adopt-style islands (ChartLab, FX) return null and manage existing page DOM
   via effects — the loader mounts them on a detached holder div, because
   React 19's createRoot() wipes its container's children on mount.
   Render-style islands (Screener, Portfolio) own their container's contents
   and mount on it directly.

   Adding an island:
   1. Create src/islands/MyIsland.tsx (default export, React component).
   2. Register it in ISLANDS below; add to ADOPT if it adopts existing DOM.
   3. In the HTML page, add data-island="my-island" to the mount element and,
      if the island replaces vanilla site.js behavior, set
      window.NV_ISLANDS['my-island'] = true in a small inline script BEFORE
      the site.js script tag so site.js skips its own version.
   4. Run `npm run build` and commit the rebuilt assets/islands.js
      (bump the ?v= query param on the script tag like other assets).
*/
import React from 'react';
import { createRoot } from 'react-dom/client';
import Screener from './islands/Screener.js';
import ChartLab from './islands/ChartLab.js';
import Portfolio from './islands/Portfolio.js';
import FxConverter from './islands/FxConverter.js';
import FxCcy from './islands/FxCcy.js';

type IslandComponent = React.ComponentType<Record<string, string | undefined>>;

const ISLANDS: Record<string, IslandComponent> = {
  screener: Screener as IslandComponent,
  'chart-lab': ChartLab as IslandComponent,
  portfolio: Portfolio as IslandComponent,
  'fx-converter': FxConverter as IslandComponent,
  'fx-ccy': FxCcy as IslandComponent,
};

/* Islands that adopt existing DOM (return null) must not mount on the
   content element — createRoot() would wipe its children. */
const ADOPT: Record<string, boolean> = {
  'chart-lab': true,
  'fx-converter': true,
  'fx-ccy': true,
};

function mount(): void {
  document.querySelectorAll('[data-island]').forEach((el) => {
    const element = el as HTMLElement;
    const name = element.getAttribute('data-island') || '';
    const Comp = ISLANDS[name];
    if (!Comp || element.dataset.islandMounted) return;
    element.dataset.islandMounted = '1';
    let host: HTMLElement = element;
    if (ADOPT[name]) {
      host = document.createElement('div');
      host.setAttribute('data-island-host', name);
      host.style.display = 'none';
      document.body.appendChild(host);
    }
    try {
      /* mount element dataset (e.g. data-ccy) is passed as props */
      createRoot(host).render(React.createElement(Comp, { ...element.dataset }));
    } catch {
      /* leave the static content untouched on failure */
      delete element.dataset.islandMounted;
      if (host !== element) host.remove();
    }
  });
}

window.NV_ISLANDS = window.NV_ISLANDS || {};
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
