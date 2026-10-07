    /* ---- Per-stock icons: real company logos where we have them
       (assets/logos/{TICKER}.png, see window.NV_LOGOS), falling back to a
       deterministic two-letter monogram badge so no stock renders icon-less. ---- */
    (function stockBadges() {
      var PALETTE = ['#1d4ed8', '#0e7490', '#0f766e', '#15803d', '#4d7c0f', '#a16207',
                     '#b45309', '#b91c1c', '#be123c', '#7c3aed', '#6d28d9', '#0c4a6e'];
      function initials(sym) {
        var s = String(sym || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!s) return '?';
        return s.length <= 2 ? s : s.charAt(0) + s.charAt(1);
      }
      function colorFor(sym) {
        var s = String(sym || '').toUpperCase();
        var h = 0, i;
        for (i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997;
        return PALETTE[h % PALETTE.length];
      }
      function monoHTML(sym, size) {
        var cls = 'stk-badge' + (size ? ' ' + size : '');
        return '<span class="' + cls + '" style="background:' + colorFor(sym) +
               '" aria-hidden="true">' + initials(sym) + '</span>';
      }
      window.nvMonoHTML = monoHTML;
      /* Old directory tickers that were renamed on the NGX. */
      var LOGO_ALIAS = { GUARANTY: 'GTCO', ACCESS: 'ACCESSCORP', TOTALNG: 'TOTAL', CCNN: 'BUACEMENT' };
      function logoKey(sym) { return LOGO_ALIAS[sym] || sym; }
      function logoBase() {
        return window.location.pathname.indexOf('/stocks/') !== -1 ? '../assets/logos/' : 'assets/logos/';
      }
      window.nvBadgeHTML = function (sym, size) {
        var cls = 'stk-badge' + (size ? ' ' + size : '');
        var key = logoKey(sym);
        if (window.NV_LOGOS && window.NV_LOGOS[key]) {
          return '<span class="' + cls + ' stk-logo" aria-hidden="true">' +
            '<img class="stk-img" data-sym="' + sym + '" data-size="' + (size || '') + '"' +
            ' src="' + logoBase() + key + '.png" alt="" loading="lazy"></span>';
        }
        return monoHTML(sym, size);
      };
      window.nvBadge = function (sym, size) {
        var d = document.createElement('div');
        d.innerHTML = window.nvBadgeHTML(sym, size);
        return d.firstChild;
      };
      /* If a logo image fails to load, swap in the monogram badge. */
      document.addEventListener('error', function (ev) {
        var t = ev.target;
        if (t && t.tagName === 'IMG' && t.className.indexOf('stk-img') !== -1 && !t.getAttribute('data-fbk')) {
          t.setAttribute('data-fbk', '1');
          var d = document.createElement('div');
          d.innerHTML = monoHTML(t.getAttribute('data-sym'), t.getAttribute('data-size') || undefined);
          if (t.parentNode) t.parentNode.replaceWith(d.firstChild);
        }
      }, true);
    }());

    /* ---- Theme: manual light/dark override, runs before first paint where possible ---- */
    (function themeInit() {
      function saved() { try { return localStorage.getItem('nv-theme'); } catch (e) { return null; } }
      function apply(t) {
        if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
        else document.documentElement.removeAttribute('data-theme');
        paintLogo();
      }
      function isDark() {
        var t = document.documentElement.getAttribute('data-theme');
        if (t) return t === 'dark';
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      }
      function paintLogo() {
        var img = document.querySelector('.brand img');
        if (!img) return;
        var src = img.getAttribute('src') || '';
        var base = src.replace(/logo(-dark)?\.svg$/, '');
        if (!base) return;
        img.setAttribute('src', base + (isDark() ? 'logo-dark.svg' : 'logo.svg'));
        var pic = img.closest('picture');
        if (pic) { var s = pic.querySelector('source'); if (s) s.remove(); }
      }
      apply(saved());
      if (window.matchMedia) {
        var mq = window.matchMedia('(prefers-color-scheme: dark)');
        if (mq.addEventListener) mq.addEventListener('change', function () { if (!saved()) paintLogo(); });
      }
      /* Toggle button: dark <-> light. Dark is the default on this edition. */
      var header = document.querySelector('.header-inner');
      if (header && !header.querySelector('.theme-toggle')) {
        var btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'theme-toggle';
        var icons = { light: '\u2600', dark: '\u263E' };
        var labels = { light: 'Appearance: light', dark: 'Appearance: dark' };
        function state() { return saved() === 'light' ? 'light' : 'dark'; }
        function paint() {
          var st = state();
          btn.textContent = icons[st];
          btn.setAttribute('aria-label', labels[st] + ' — activate to change');
          btn.title = labels[st];
        }
        btn.addEventListener('click', function () {
          var next = state() === 'dark' ? 'light' : 'dark';
          try { localStorage.setItem('nv-theme', next); } catch (e) {}
          apply(next);
          paint();
        });
        paint();
        header.appendChild(btn);
      }
    }());
    /* ---- Market status: NGX trades Mon–Fri 9:30–16:00 WAT (continuous session) ---- */
    (function marketStatus() {
      var statusEl = document.querySelector('.topline .status');
      if (!statusEl) return;
      var now = new Date();
      var wat = new Date(now.getTime() + (now.getTimezoneOffset() + 60) * 60000);
      var day = wat.getDay(), mins = wat.getHours() * 60 + wat.getMinutes();
      var open = day >= 1 && day <= 5 && mins >= 570 && mins < 960;
      statusEl.innerHTML = '<i class="status-dot" aria-hidden="true"></i> ' + (open ? 'MARKET OPEN' : 'MARKET CLOSED');
      statusEl.classList.toggle('closed', !open);
      var hh = String(wat.getHours()).padStart(2, '0'), mm = String(wat.getMinutes()).padStart(2, '0');
      statusEl.title = 'Nigerian Exchange trading hours: Mon–Fri 9:30–16:00 WAT. Now ' + hh + ':' + mm + ' WAT.';
    }());
    /* ---- Auth nav: runs FIRST so links appear even if a widget below throws ---- */
    (function authNav() {
      var nav = document.querySelector('.site-nav');
      if (!nav || nav.querySelector('[data-authnav]')) return;
      var prefix = window.location.pathname.indexOf('/stocks/') === 0 ? '../' : '';
      var here = window.location.pathname.replace(/\/$/, '');
      /* Single Portfolio entry: logged-out visitors are routed through sign-in
         by portfolio.html itself; logged-in users land on their holdings. */
      var a = document.createElement('a');
      a.href = prefix + 'portfolio'; a.textContent = 'Portfolio'; a.setAttribute('data-authnav', '1');
      if (/portfolio$/.test(here)) a.className = 'active';
      nav.appendChild(a);
    }());
    /* ---- Nav link icons: every header link gets a small inline SVG icon. ---- */
    (function navIcons() {
      var S = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
      var ICONS = {
        'home': S + '<path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>',
        'stocks': S + '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>',
        'screener': S + '<path d="M4 5h16l-6 7v5l-4 2v-7z"/></svg>',
        'offers': S + '<path d="M20.6 13.4 12 22 2 12V2h10l8.6 8.6a2 2 0 0 0 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
        'calendar': S + '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
        'news': S + '<path d="M4 6h13v12H6a2 2 0 0 1-2-2z"/><path d="M17 8h2a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H4"/><path d="M7 10h7M7 14h5"/></svg>',
        'learn': S + '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/></svg>',
        'recap': S + '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 9h6M9 13h6M9 17h4"/></svg>',
        'portfolio': S + '<path d="M21.2 15.9A10 10 0 1 1 8 2.8"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>'
      };
      function paint() {
        var nav = document.querySelector('.site-nav');
        if (!nav) return;
        Array.prototype.forEach.call(nav.querySelectorAll('a'), function (a) {
          if (a.querySelector('svg')) return;
          var key = a.textContent.trim().toLowerCase();
          if (ICONS[key]) a.insertAdjacentHTML('afterbegin', ICONS[key]);
        });
      }
      paint();
      /* Re-run after any late nav injection so new links get icons too. */
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paint);
      else setTimeout(paint, 0);
    }());
    (function () {
      /* Open a collapsible section when its anchor is targeted (e.g. news.html#news). */
      function openHash() {
        var id = (location.hash || '').slice(1);
        if (!id) return;
        var sec = document.getElementById(id);
        var det = sec && sec.querySelector('details.collapse');
        if (det) det.open = true;
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', openHash);
      else openHash();
      window.addEventListener('hashchange', openHash);
    }());
    (function () {
      /* Direction arrow for a row: ▲/▼ double-encodes the color signal.
         Volume and no-snapshot rows carry no direction. */
      function dirArrow(r) {
        if (!r || r.vol || r.noSnap) return '';
        var v = Number(r.cv);
        if (v > 0) return '▲ ';
        if (v < 0) return '▼ ';
        return '';
      }
      var rangeSessions = { '1W': 5, '1M': 22, '3M': 66, '6M': 132, 'YTD': 'ytd' };
      var currentRange = '1W';
      /* Points for a range: last N sessions, or every session since 1 Jan for YTD.
         Works on the snapshot asiHistory and on live data swapped in later. */
      function rangePoints(range) {
        if (range === 'YTD') {
          var yr = String(new Date().getFullYear());
          var pts = asiHistory.filter(function (p) { return p.d >= yr + '-01-01'; });
          return pts.length > 1 ? pts : asiHistory.slice(-22);
        }
        return asiHistory.slice(-Math.min(rangeSessions[range] || 22, asiHistory.length));
      }
      function fmtAsiLabel(iso) {
        var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        var parts = String(iso).split('-');
        return parts[2].replace(/^0/, '') + ' ' + months[Number(parts[1]) - 1] + ' ' + parts[0];
      }
      var svg = document.getElementById('asiChart');
      var tooltip = document.getElementById('tooltip');
      var periodLabel = document.getElementById('periodLabel');
      var chartChange = document.getElementById('chartChange');
      var NS = 'http://www.w3.org/2000/svg';

      function formatNumber(n) { return n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
      function node(name, attrs) {
        var el = document.createElementNS(NS, name);
        Object.keys(attrs || {}).forEach(function (key) { el.setAttribute(key, attrs[key]); });
        return el;
      }
      function draw(range) {
        while (svg.firstChild) svg.removeChild(svg.firstChild);
        var points = rangePoints(range);
        if (!points.length) return;
        function plabel(p) { return p.label || fmtAsiLabel(p.d); }
        function fmtPct(v) {
          if (Math.abs(v) < 0.0005) return '0%';
          return (v < 0 ? '−' : '+') + Math.abs(v).toFixed(2) + '%';
        }
        var title = node('title', { id: 'chartTitle' }); title.textContent = 'NGX All-Share Index performance vs range start'; svg.appendChild(title);
        var desc = node('desc', { id: 'chartDesc' }); desc.textContent = 'Percent change of the ASI from the first selected close (' + plabel(points[0]) + ') to ' + plabel(points[points.length - 1]) + '.'; svg.appendChild(desc);
        var defs = node('defs', {});
        /* Each fill's own bounding box frames its gradient: the up fill fades
           from green at the line to transparent at zero; the down fill from
           transparent at zero to red at the line. */
        var gradUp = node('linearGradient', { id: 'asiUpGrad', x1: '0', y1: '0', x2: '0', y2: '1' });
        gradUp.appendChild(node('stop', { offset: '0%' }));
        gradUp.appendChild(node('stop', { offset: '100%' }));
        var gradDown = node('linearGradient', { id: 'asiDownGrad', x1: '0', y1: '0', x2: '0', y2: '1' });
        gradDown.appendChild(node('stop', { offset: '0%' }));
        gradDown.appendChild(node('stop', { offset: '100%' }));
        defs.appendChild(gradUp); defs.appendChild(gradDown);
        svg.appendChild(defs);
        var W = 1000, H = 360, L = 72, R = 28, T = 34, B = 46;
        var base = points[0].v;
        var pcts = points.map(function (p) { return base ? (p.v - base) / base * 100 : 0; });
        var minP = Math.min.apply(null, pcts), maxP = Math.max.apply(null, pcts);
        var span = Math.max(Math.abs(minP), Math.abs(maxP), 0.05) * 1.18;
        function x(i) { return points.length === 1 ? (L + W - R) / 2 : L + i * (W - L - R) / (points.length - 1); }
        function y(pct) { return T + (span - pct) * (H - T - B) / (2 * span); }
        var zeroY = y(0);
        [-1, -0.5, 0, 0.5, 1].forEach(function (f) {
          var gy = y(span * f);
          svg.appendChild(node('line', { x1: L, x2: W - R, y1: gy, y2: gy, 'class': 'grid-line' }));
          var label = node('text', { x: L - 12, y: gy + 4, 'text-anchor': 'end', 'class': 'axis-label' });
          label.textContent = fmtPct(span * f); svg.appendChild(label);
        });
        var coords = pcts.map(function (pc, idx) { return [x(idx), y(pc)]; });
        /* Split the line and the zero-anchored fills at the zero line so no
           fill ever leaks across it. side 1 = above zero, side -1 = below. */
        function splitPaths(side) {
          function inR(pct) { return side === 1 ? pct >= -1e-9 : pct <= 1e-9; }
          function crossX(x1, y1, x2, y2) { var t = (zeroY - y1) / (y2 - y1); return (t > 0 && t < 1) ? x1 + t * (x2 - x1) : null; }
          function fx(n) { return n.toFixed(1); }
          var line = '', area = '', open = false, i, x1, y1, x2, y2, c1, c2, cx;
          function lemit(px, py) { line += (open ? 'L' : 'M') + fx(px) + ',' + fx(py) + ' '; open = true; }
          function aemit(px, py) { area += (area ? 'L' : 'M') + fx(px) + ',' + fx(py) + ' '; }
          for (i = 0; i < coords.length - 1; i++) {
            x1 = coords[i][0]; y1 = coords[i][1]; x2 = coords[i + 1][0]; y2 = coords[i + 1][1];
            c1 = inR(pcts[i]); c2 = inR(pcts[i + 1]);
            if (c1 && c2) { aemit(x1, y1); if (i === coords.length - 2) aemit(x2, y2); }
            else if (c1) { aemit(x1, y1); cx = crossX(x1, y1, x2, y2); if (cx !== null) aemit(cx, zeroY); }
            else if (c2) { cx = crossX(x1, y1, x2, y2); if (cx !== null) aemit(cx, zeroY); if (i === coords.length - 2) aemit(x2, y2); }
            else { aemit(x1, zeroY); aemit(x2, zeroY); }
          }
          open = false;
          for (i = 0; i < coords.length - 1; i++) {
            x1 = coords[i][0]; y1 = coords[i][1]; x2 = coords[i + 1][0]; y2 = coords[i + 1][1];
            c1 = inR(pcts[i]); c2 = inR(pcts[i + 1]);
            if (c1 && c2) { lemit(x1, y1); if (i === coords.length - 2) lemit(x2, y2); }
            else if (c1) { lemit(x1, y1); cx = crossX(x1, y1, x2, y2); if (cx !== null) lemit(cx, zeroY); open = false; }
            else if (c2) { cx = crossX(x1, y1, x2, y2); open = false; if (cx !== null) { lemit(cx, zeroY); lemit(x2, y2); } }
            else { open = false; }
          }
          var areaD = '';
          if (area) areaD = area + 'L' + fx(coords[coords.length - 1][0]) + ',' + fx(zeroY) + ' L' + fx(coords[0][0]) + ',' + fx(zeroY) + ' Z';
          return { line: line, area: areaD };
        }
        var up = splitPaths(1), down = splitPaths(-1);
        if (down.area) svg.appendChild(node('path', { d: down.area, 'class': 'area-down' }));
        if (up.area) svg.appendChild(node('path', { d: up.area, 'class': 'area-up' }));
        /* Zero line sits above the fills so it stays crisp where they meet it. */
        svg.appendChild(node('line', { x1: L, x2: W - R, y1: zeroY, y2: zeroY, 'class': 'zero-line' }));
        if (down.line) svg.appendChild(node('path', { d: down.line, 'class': 'series-down' }));
        if (up.line) svg.appendChild(node('path', { d: up.line, 'class': 'series-up' }));
        points.forEach(function (p, idx) {
          var dot = node('circle', { cx: coords[idx][0], cy: coords[idx][1], r: 5, 'class': 'chart-dot ' + (pcts[idx] < 0 ? 'down' : 'up'), tabindex: '0', role: 'button', 'aria-label': plabel(p) + ': ' + formatNumber(p.v) + ' (' + fmtPct(pcts[idx]) + ')' });
          function show() {
            var wrap = svg.parentElement.getBoundingClientRect();
            var box = svg.getBoundingClientRect();
            tooltip.textContent = plabel(p) + ' · ' + formatNumber(p.v) + ' (' + fmtPct(pcts[idx]) + ')';
            tooltip.style.left = ((coords[idx][0] / W) * box.width + box.left - wrap.left) + 'px';
            tooltip.style.top = ((coords[idx][1] / H) * box.height + box.top - wrap.top) + 'px';
            tooltip.classList.add('visible'); tooltip.setAttribute('aria-hidden', 'false');
          }
          function hide() { tooltip.classList.remove('visible'); tooltip.setAttribute('aria-hidden', 'true'); }
          dot.addEventListener('mouseenter', show); dot.addEventListener('focus', show); dot.addEventListener('click', show); dot.addEventListener('mouseleave', hide); dot.addEventListener('blur', hide);
          svg.appendChild(dot);
        });
        var first = node('text', { x: L, y: H - 17, 'text-anchor': 'start', 'class': 'axis-label' }); first.textContent = plabel(points[0]); svg.appendChild(first);
        var last = node('text', { x: W - R, y: H - 17, 'text-anchor': 'end', 'class': 'axis-label' }); last.textContent = plabel(points[points.length-1]); svg.appendChild(last);
        var chgPct = pcts[pcts.length - 1];
        chartChange.textContent = fmtPct(chgPct) + ' since ' + plabel(points[0]);
        chartChange.className = 'chart-change ' + (chgPct < 0 ? 'down' : 'up');
        periodLabel.textContent = plabel(points[0]) + ' — ' + plabel(points[points.length-1]);
      }
      document.querySelectorAll('.range-button').forEach(function (button) {
        button.addEventListener('click', function () {
          document.querySelectorAll('.range-button').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
          button.setAttribute('aria-pressed', 'true');
          currentRange = button.getAttribute('data-range');
          draw(currentRange);
        });
      });

      
      var dirState = { query: '', sector: 'All' };
      var dirSearch = document.getElementById('dirSearch');
      var dirList = document.getElementById('directoryList');
      var dirCount = document.getElementById('dirCount');
      var sectorChips = document.getElementById('sectorChips');
      function dirRows() {
        var q = dirState.query.toLowerCase();
        /* Map current NGX tickers back to the old directory symbols. */
        var REV_ALIAS = { GUARANTY: 'GTCO', ACCESS: 'ACCESSCORP', TOTALNG: 'TOTAL', CCNN: 'BUACEMENT', FBNH: 'FIRSTHOLDCO' };
        return directory.filter(function (e) {
          if (dirState.sector !== 'All' && e.g !== dirState.sector) return false;
          if (!q) return true;
          if (e.s.toLowerCase().indexOf(q) !== -1 || e.c.toLowerCase().indexOf(q) !== -1 || e.g.toLowerCase().indexOf(q) !== -1) return true;
          var aq = REV_ALIAS[q.toUpperCase()]; if (aq && e.s === aq) return true;
        }).sort(function (a, b) { return a.s < b.s ? -1 : a.s > b.s ? 1 : 0; });
      }
      function renderDirectory() {
        if (!dirList) return;
        dirList.innerHTML = '';
        var rows = dirRows();
        dirCount.textContent = rows.length + (rows.length === 1 ? ' stock' : ' stocks');
        if (!rows.length) {
          var empty = document.createElement('div'); empty.className = 'empty-note';
          empty.textContent = 'No stocks match your search.';
          dirList.appendChild(empty); return;
        }
        rows.forEach(function (r) {
          var item = document.createElement('div'); item.className = 'market-row';
          var star = document.createElement('button'); star.type = 'button'; star.className = 'star';
          var starred = isStarred(r.s);
          star.setAttribute('aria-pressed', starred ? 'true' : 'false');
          star.setAttribute('aria-label', (starred ? 'Remove ' : 'Add ') + r.s + (starred ? ' from' : ' to') + ' watchlist');
          star.textContent = starred ? '★' : '☆';
          star.addEventListener('click', function (ev) { ev.stopPropagation(); toggleStar(r.s); });
          var main = document.createElement('button'); main.type = 'button'; main.className = 'row-main';
          main.setAttribute('aria-label', r.s + ', ' + r.c + ' — view details');
          var symbol = document.createElement('span'); symbol.className = 'symbol'; symbol.textContent = r.s;
          var tag = document.createElement('span'); tag.className = 'list-tag'; tag.textContent = r.g;
          symbol.appendChild(tag);
          var company = document.createElement('span'); company.className = 'company'; company.textContent = r.c;
          var rowText = document.createElement('span'); rowText.className = 'row-text'; rowText.appendChild(symbol); rowText.appendChild(company); main.appendChild(window.nvBadge(r.s)); main.appendChild(rowText);
          main.addEventListener('click', function () { openModal(r.s, main); });
          var price = document.createElement('div'); price.className = 'price'; price.textContent = r.p;
          var move = document.createElement('div'); move.className = 'move ' + (r.d || ''); move.textContent = dirArrow(r) + r.m;
          item.appendChild(star); item.appendChild(main); item.appendChild(price); item.appendChild(move);
          dirList.appendChild(item);
        });
      }
      if (sectorChips) (function buildSectorChips() {
        var sectors = ['All'];
        directory.forEach(function (e) { if (sectors.indexOf(e.g) === -1) sectors.push(e.g); });
        sectors.forEach(function (name) {
          var b = document.createElement('button'); b.type = 'button'; b.className = 'sector-chip';
          b.textContent = name; b.setAttribute('aria-pressed', name === 'All' ? 'true' : 'false');
          b.addEventListener('click', function () {
            dirState.sector = name;
            sectorChips.querySelectorAll('.sector-chip').forEach(function (c) { c.setAttribute('aria-pressed', c === b ? 'true' : 'false'); });
            renderDirectory();
          });
          sectorChips.appendChild(b);
        });
      }());
      var dirTimer = null;
      if (dirSearch) dirSearch.addEventListener('input', function () {
        clearTimeout(dirTimer);
        dirTimer = setTimeout(function () { dirState.query = dirSearch.value.trim(); renderDirectory(); }, 160);
      });
      var marketList = document.getElementById('market-list');
      var searchInput = document.getElementById('stockSearch');
      var watchCount = document.getElementById('watchCount');
      /* ---- Market breadth: leaders & laggards side by side ---- */
      var leadersList = document.getElementById('leadersList');
      var laggardsList = document.getElementById('laggardsList');
      var breadthCols = document.getElementById('breadthCols');
      var state = { view: 'breadth', query: '' };
      var watchlist = [];
      try { watchlist = JSON.parse(localStorage.getItem('ngxWatchlist') || '[]'); } catch (e) { watchlist = []; }
      function saveWatchlist() { try { localStorage.setItem('ngxWatchlist', JSON.stringify(watchlist)); } catch (e) {} }
      function isStarred(s) { return watchlist.indexOf(s) !== -1; }
      function updateWatchCount() { if (!watchCount) return; watchCount.textContent = watchlist.length ? '(' + watchlist.length + ')' : ''; }
      function findStock(s) {
        for (var k in tables) {
          for (var i = 0; i < tables[k].length; i++) {
            if (tables[k][i].s === s) return { row: tables[k][i], list: k };
          }
        }
        for (var j = 0; j < directory.length; j++) {
          if (directory[j].s === s) return { row: directory[j], list: 'directory' };
        }
        return null;
      }
      function toggleStar(s) {
        var i = watchlist.indexOf(s);
        if (i === -1) watchlist.push(s); else watchlist.splice(i, 1);
        saveWatchlist(); updateWatchCount(); render(); renderDirectory();
        if (currentModal === s) paintModalStar(s);
      }
      function buildRow(r, i, tag) {
        var item = document.createElement('div'); item.className = 'market-row';
        var star = document.createElement('button'); star.type = 'button'; star.className = 'star';
        var starred = isStarred(r.s);
        star.setAttribute('aria-pressed', starred ? 'true' : 'false');
        star.setAttribute('aria-label', (starred ? 'Remove ' : 'Add ') + r.s + (starred ? ' from' : ' to') + ' watchlist');
        star.textContent = starred ? '\u2605' : '\u2606';
        star.addEventListener('click', function (ev) { ev.stopPropagation(); toggleStar(r.s); });
        var main = document.createElement('button'); main.type = 'button'; main.className = 'row-main';
        main.setAttribute('aria-label', r.s + ', ' + r.c + ' \u2014 view details');
        var symbol = document.createElement('span'); symbol.className = 'symbol'; symbol.textContent = (i + 1) + '. ' + r.s;
        if (tag) {
          var tg = document.createElement('span'); tg.className = 'list-tag'; tg.textContent = tag;
          symbol.appendChild(tg);
        }
        var company = document.createElement('span'); company.className = 'company'; company.textContent = r.c;
        var rowText = document.createElement('span'); rowText.className = 'row-text'; rowText.appendChild(symbol); rowText.appendChild(company);
        main.appendChild(window.nvBadge(r.s)); main.appendChild(rowText);
        main.addEventListener('click', function () { openModal(r.s, main); });
        var price = document.createElement('div'); price.className = 'price'; price.textContent = r.p;
        var move = document.createElement('div');
        move.className = 'move' + (r.vol ? '' : ' ' + (r.d || ''));
        move.textContent = r.vol ? r.m + ' shares' : dirArrow(r) + r.m;
        item.appendChild(star); item.appendChild(main); item.appendChild(price); item.appendChild(move);
        return item;
      }
      function renderBreadth() {
        if (!breadthCols || !leadersList || !laggardsList) return;
        leadersList.innerHTML = ''; laggardsList.innerHTML = '';
        tables.gainers.slice(0, 5).forEach(function (r, i) { leadersList.appendChild(buildRow(r, i)); });
        tables.losers.slice(0, 5).forEach(function (r, i) { laggardsList.appendChild(buildRow(r, i)); });
      }
      function flatRows() {
        var q = state.query.trim().toLowerCase();
        if (q) {
          var out = [];
          ['gainers', 'losers', 'volume'].forEach(function (k) {
            tables[k].forEach(function (r) {
              if (r.s.toLowerCase().indexOf(q) !== -1 || r.c.toLowerCase().indexOf(q) !== -1) out.push({ row: r, list: k });
            });
          });
          return out;
        }
        if (state.view === 'watchlist') return watchlist.map(findStock).filter(Boolean);
        return tables.volume.map(function (r) { return { row: r, list: 'volume' }; });
      }
      function paintTabs() {
        document.querySelectorAll('.breadth-toggle button').forEach(function (b) {
          b.setAttribute('aria-selected', state.query ? 'false' : (b.getAttribute('data-view') === state.view ? 'true' : 'false'));
        });
      }
      function render() {
        paintTabs();
        if (!marketList) return;
        var inBreadth = state.view === 'breadth' && !state.query.trim();
        if (breadthCols) breadthCols.hidden = !inBreadth;
        marketList.hidden = inBreadth;
        if (inBreadth) { renderBreadth(); return; }
        marketList.innerHTML = '';
        var rows = flatRows();
        if (!rows.length) {
          var empty = document.createElement('div'); empty.className = 'empty-note';
          empty.textContent = (state.view === 'watchlist' && !state.query.trim())
            ? 'Your watchlist is empty. Tap the \u2606 on any stock \u2014 or star it inside its details \u2014 to pin it here. It stays saved in this browser.'
            : 'No stocks match your search.';
          marketList.appendChild(empty);
          return;
        }
        rows.forEach(function (entry, i) {
          marketList.appendChild(buildRow(entry.row, i, entry.list && typeof listNames !== 'undefined' ? listNames[entry.list] : ''));
        });
      }
      document.querySelectorAll('.breadth-toggle button').forEach(function (button) {
        button.addEventListener('click', function () {
          state.view = button.getAttribute('data-view');
          state.query = ''; if (searchInput) searchInput.value = '';
          marketList.setAttribute('aria-labelledby', button.id);
          render();
        });
      });
      var searchTimer = null;
      if (searchInput) searchInput.addEventListener('input', function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () { state.query = searchInput.value.trim(); render(); }, 160);
      });
      var backdrop = document.getElementById('modalBackdrop');
      var modalClose = document.getElementById('modalClose');
      var modalStar = document.getElementById('modalStar');
      var currentModal = null, lastFocused = null;
      function paintModalStar(s) {
        modalStar.textContent = isStarred(s) ? '★ Starred — tap to remove from watchlist' : '☆ Add to watchlist';
      }
      function openModal(s, opener) {
        var found = findStock(s); if (!found) return;
        var r = found.row;
        var isDir = found.list === 'directory';
        currentModal = s; lastFocused = opener || document.activeElement;
        var snapShort = window.NVTradeDate || '25 Sep 2026';
        document.getElementById('modalList').textContent = isDir ? 'Market directory' : (listNames[found.list] + ' \u00b7 Snapshot ' + snapShort);
        var msEl = document.getElementById('modalSymbol');
        msEl.innerHTML = '';
        msEl.appendChild(window.nvBadge(r.s, 'lg'));
        var msTx = document.createElement('span'); msTx.textContent = r.s; msEl.appendChild(msTx);
        document.getElementById('modalCompany').textContent = r.c + (isDir && r.g ? ' \u00b7 ' + r.g : '');
        document.getElementById('modalPrice').textContent = r.p;
        document.getElementById('modalMoveLabel').textContent = r.vol ? 'Volume' : (r.noSnap ? 'Sector' : 'Day change');
        var mm = document.getElementById('modalMove');
        mm.textContent = r.noSnap ? r.g : (r.vol ? r.m + ' shares' : dirArrow(r) + r.m);
        mm.style.color = r.noSnap ? 'inherit' : (r.d === 'up' ? 'var(--green-strong)' : 'var(--red)');
        var mpEl = document.getElementById('modalPage');
        if (mpEl) {
          var hasPage = !!(window.NV_STOCK_PAGES && window.NV_STOCK_PAGES[s]);
          mpEl.hidden = !hasPage;
          if (hasPage) mpEl.href = 'stocks/' + s;
        }
        paintModalStar(s);
        backdrop.hidden = false;
        document.body.style.overflow = 'hidden';
        modalClose.focus();
      }
      function closeModal() {
        backdrop.hidden = true;
        document.body.style.overflow = '';
        currentModal = null;
        if (lastFocused && lastFocused.focus) lastFocused.focus();
      }
      if (modalClose) modalClose.addEventListener('click', closeModal);
      if (backdrop) backdrop.addEventListener('click', function (ev) { if (ev.target === backdrop) closeModal(); });
      document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && backdrop && !backdrop.hidden) closeModal(); });
      if (modalStar) modalStar.addEventListener('click', function () { if (currentModal) toggleStar(currentModal); });
      var newsState = { sector: 'All' };
      var newsChips = document.getElementById('newsChips');
      function getNewsCards() { return Array.prototype.slice.call(document.querySelectorAll('.news-card')); }
      var newsSectors = ['All', 'Market-wide', 'Banking', 'Insurance', 'Oil & Gas', 'Consumer Goods', 'Industrial Goods'];
      var newsKeys = { 'All': 'all', 'Market-wide': 'market', 'Banking': 'banking', 'Insurance': 'insurance', 'Oil & Gas': 'oilgas', 'Consumer Goods': 'consumer', 'Industrial Goods': 'industrial' };
      function renderNews() {
        var key = newsKeys[newsState.sector];
        var n = 0;
        getNewsCards().forEach(function (c) {
          var show = key === 'all' || c.getAttribute('data-sector') === key;
          c.style.display = show ? '' : 'none';
          if (show) n++;
        });
        var newsCountEl = document.getElementById('newsCount');
        if (newsCountEl) newsCountEl.textContent = n + (n === 1 ? ' story' : ' stories');
      }
      if (newsChips) newsSectors.forEach(function (name) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'sector-chip';
        b.textContent = name; b.setAttribute('aria-pressed', name === 'All' ? 'true' : 'false');
        b.addEventListener('click', function () {
          newsState.sector = name;
          newsChips.querySelectorAll('.sector-chip').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
          renderNews();
        });
        newsChips.appendChild(b);
      });
      renderNews();
      // Live headlines from the auto newsroom (worker refreshes the feed every few hours).
      (function loadLiveNews() {
        var grid = document.getElementById('liveNewsGrid');
        if (!grid) return;
        var section = document.getElementById('liveNewsSection');
        var updatedEl = document.getElementById('liveNewsUpdated');
        var sectorKey = { 'market-wide': 'market', 'banking': 'banking', 'insurance': 'insurance', 'oil & gas': 'oilgas', 'consumer goods': 'consumer', 'industrial goods': 'industrial' };
        var sectorLabel = { 'market-wide': 'Market-wide', 'banking': 'Banking', 'insurance': 'Insurance', 'oil & gas': 'Oil & Gas', 'consumer goods': 'Consumer Goods', 'industrial goods': 'Industrial Goods' };
        function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
        function fmtDate(ts) {
          var d = new Date(ts);
          var months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
          return d.getDate() + ' ' + months[d.getMonth()];
        }
        function ago(ts) {
          var m = Math.round((Date.now() - ts) / 60000);
          if (m < 1) return 'just now';
          if (m < 60) return m + 'm ago';
          var h = Math.round(m / 60);
          return h < 24 ? h + 'h ago' : Math.round(h / 24) + 'd ago';
        }
        fetch('https://nairaview-api.meetomidiora.workers.dev/api/news')
          .then(function (r) { if (!r.ok) throw new Error('news feed unavailable'); return r.json(); })
          .then(function (data) {
            var items = (data && data.items) || [];
            if (!items.length) { if (section) section.style.display = 'none'; return; }
            var html = '';
            items.slice(0, 24).forEach(function (it) {
              var key = sectorKey[it.sector] || 'market';
              var thumbHtml = it.image ? '<div class="news-thumb"><img src="' + esc(it.image) + '" alt="" loading="lazy" onerror="this.closest(\'.news-thumb\').remove()"></div>' : '';
              html += '<a class="news-card" data-sector="' + key + '" href="' + esc(it.link) + '" target="_blank" rel="noopener noreferrer">'
                + thumbHtml
                + '<div class="news-meta"><span>' + esc((it.source || '').toUpperCase()) + '</span><span>' + esc(fmtDate(it.published_at)) + '</span><span class="news-sector">' + esc(sectorLabel[it.sector] || 'Market-wide') + '</span></div>'
                + '<h3>' + esc(it.title) + '</h3>'
                + (it.description ? '<p>' + esc(it.description) + '</p>' : '')
                + '<span class="arrow" aria-hidden="true">\u2197</span></a>';
            });
            grid.innerHTML = html;
            if (updatedEl && data.updated_at) updatedEl.textContent = 'Updated ' + ago(data.updated_at);
            renderNews();
          })
          .catch(function () { if (section) section.style.display = 'none'; });
      })();
      document.querySelectorAll('.news-card[data-tickers]').forEach(function (card) {
        var tickers = card.getAttribute('data-tickers').split(',').slice(0, 2);
        var wrap = document.createElement('div');
        wrap.className = 'ticker-chips';
        tickers.forEach(function (t) {
          var chip = document.createElement('span');
          chip.className = 'ticker-chip';
          chip.textContent = t;
          chip.setAttribute('role', 'link');
          chip.setAttribute('tabindex', '0');
          chip.setAttribute('aria-label', 'View ' + t + ' stock page');
          function go(ev) { ev.preventDefault(); ev.stopPropagation(); window.location.href = 'stocks/' + t; }
          chip.addEventListener('click', go);
          chip.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') go(ev); });
          wrap.appendChild(chip);
        });
        card.appendChild(wrap);
      });
      var stickyClosed = false;
      function revealAds() {
        var anySticky = false;
        document.querySelectorAll('.ad-slot').forEach(function (slot) {
          if (slot.id === 'adSticky' && stickyClosed) return;
          if (slot.querySelector('iframe')) {
            slot.classList.add('ad-live');
            if (slot.id === 'adSticky') anySticky = true;
          }
        });
        document.body.classList.toggle('ad-sticky-on', anySticky);
      }
      var adTries = 0;
      function pollAds() {
        revealAds();
        if (++adTries < 15 && !document.querySelector('.ad-slot.ad-live')) setTimeout(pollAds, 1000);
      }
      window.addEventListener('load', function () { setTimeout(pollAds, 1500); });
      var adClose = document.getElementById('adStickyClose');
      if (adClose) adClose.addEventListener('click', function () {
        stickyClosed = true;
        document.getElementById('adSticky').classList.remove('ad-live');
        document.body.classList.remove('ad-sticky-on');
      });
      /* ---- Native market ticker (own snapshot data; replaces blocked ngnmarket iframe) ---- */
      function renderTape() {
        var track = document.getElementById('tickerTrack');
        if (!track) return;
        var rows = (typeof tables !== 'undefined') ? tables.gainers.concat(tables.losers) : [];
        if (!rows.length) { track.parentNode.style.display = 'none'; return; }
        var html = rows.map(function (r) {
          return '<span class="ticker-item">' + window.nvBadgeHTML(r.s, 'sm') + '<span class="tk-s">' + r.s + '</span>' +
            '<span class="tk-p">' + r.p + '</span>' +
            '<span class="tk-m ' + (r.d === 'up' ? 'up' : 'down') + '">' + dirArrow(r) + r.m + '</span></span>';
        }).join('');
        track.innerHTML = html + html; /* duplicate for a seamless -50% loop */
      }
      renderTape();
      /* ---- Market heatmap: cap-weighted treemap ----
         Tile area follows sqrt(market cap) so giants read as giants;
         direction is triple-encoded (pastel tint + colored figure + arrow),
         and every figure keeps dark text. */
      function renderHeatmap() {
        var host = document.getElementById('heatTiles');
        if (!host) return;
        host.innerHTML = '';
        var rows = tables.gainers.concat(tables.losers);
        if (!rows.length) return;
        var roots = rows.map(function (r) { return Math.sqrt(Number(r.mc) || 0); });
        var maxRoot = Math.max.apply(null, roots.concat([1]));
        rows.forEach(function (r, idx) {
          var t = document.createElement('button');
          t.type = 'button'; t.className = 'heat-tile'; t.setAttribute('role', 'listitem');
          var grow = 1 + Math.round(11 * roots[idx] / maxRoot);
          /* Basis carries the weight (no shrink, so small tiles can't be
             equalized); leftover row space still distributes by grow. */
          t.style.flex = grow + ' 0 ' + (80 + grow * 50) + 'px';
          /* Cap the width so a lone tile on the last row can't stretch
             full-width and read as the biggest company. */
          t.style.maxWidth = (grow * 170) + 'px';
          t.style.background = r.cv >= 0 ? 'var(--green-soft)' : 'var(--red-soft)';
          var s1 = document.createElement('span'); s1.className = 'ht-s'; s1.textContent = r.s;
          var s2 = document.createElement('span'); s2.className = 'ht-c ' + (r.cv >= 0 ? 'up' : 'down'); s2.textContent = dirArrow(r) + r.m;
          var s3 = document.createElement('span'); s3.className = 'ht-p'; s3.textContent = r.p;
          t.insertBefore(window.nvBadge(r.s, 'sm'), t.firstChild);
          t.appendChild(s1); t.appendChild(s2); t.appendChild(s3);
          t.setAttribute('aria-label', r.s + ', ' + r.c + ', day change ' + r.m + ' \u2014 view details');
          t.addEventListener('click', function () { openModal(r.s, t); });
          host.appendChild(t);
        });
      }
      renderHeatmap();
      /* ---- Stock screener ---- */
      if (document.getElementById('screenList')) {
      var scrState = { mover: 'all', sector: 'All', minP: '', maxP: '', minC: '', maxC: '', sort: 'chg-desc' };
      var screenList = document.getElementById('screenList');
      var screenCount = document.getElementById('screenCount');
      function scrKey(e, what) {
        if (what === 'chg') return (!e.vol && e.pv !== null && !e.noSnap) ? e.cv : null;
        if (what === 'price') return e.pv;
        if (what === 'vol') return e.vol ? e.cv : null;
        return null;
      }
      function scrRows() {
        var minP = parseFloat(scrState.minP), maxP = parseFloat(scrState.maxP);
        var minC = parseFloat(scrState.minC), maxC = parseFloat(scrState.maxC);
        var priceOn = !isNaN(minP) || !isNaN(maxP);
        var chgOn = !isNaN(minC) || !isNaN(maxC);
        var rows = directory.filter(function (e) {
          if (scrState.mover === 'gainers' && !(!e.vol && e.d === 'up')) return false;
          if (scrState.mover === 'losers' && e.d !== 'down') return false;
          if (scrState.mover === 'volume' && !e.vol) return false;
          if (scrState.sector !== 'All' && e.g !== scrState.sector) return false;
          if (priceOn) {
            if (e.pv === null) return false;
            if (!isNaN(minP) && e.pv < minP) return false;
            if (!isNaN(maxP) && e.pv > maxP) return false;
          }
          if (chgOn) {
            var c = scrKey(e, 'chg');
            if (c === null) return false;
            if (!isNaN(minC) && c < minC) return false;
            if (!isNaN(maxC) && c > maxC) return false;
          }
          return true;
        });
        var key = scrState.sort;
        rows.sort(function (a, b) {
          if (key === 'name') return a.s < b.s ? -1 : a.s > b.s ? 1 : 0;
          var wk = key === 'vol-desc' ? 'vol' : (key.indexOf('chg') === 0 ? 'chg' : 'price');
          var ka = scrKey(a, wk), kb = scrKey(b, wk);
          if (ka === null && kb === null) return 0;
          if (ka === null) return 1;
          if (kb === null) return -1;
          return (key === 'chg-asc' || key === 'price-asc') ? ka - kb : kb - ka;
        });
        return rows;
      }
      function renderScreener() {
        screenList.innerHTML = '';
        var rows = scrRows();
        screenCount.textContent = rows.length + (rows.length === 1 ? ' stock' : ' stocks');
        if (!rows.length) {
          var empty = document.createElement('div'); empty.className = 'empty-note';
          empty.textContent = 'No stocks match these filters.';
          screenList.appendChild(empty); return;
        }
        rows.forEach(function (r) {
          var item = document.createElement('div'); item.className = 'market-row';
          var star = document.createElement('button'); star.type = 'button'; star.className = 'star';
          var starred = isStarred(r.s);
          star.setAttribute('aria-pressed', starred ? 'true' : 'false');
          star.setAttribute('aria-label', (starred ? 'Remove ' : 'Add ') + r.s + (starred ? ' from' : ' to') + ' watchlist');
          star.textContent = starred ? '★' : '☆';
          star.addEventListener('click', function (ev) { ev.stopPropagation(); toggleStar(r.s); renderScreener(); });
          var main = document.createElement('button'); main.type = 'button'; main.className = 'row-main';
          main.setAttribute('aria-label', r.s + ', ' + r.c + ' — view details');
          var symbol = document.createElement('span'); symbol.className = 'symbol'; symbol.textContent = r.s;
          var tag = document.createElement('span'); tag.className = 'list-tag'; tag.textContent = r.g;
          symbol.appendChild(tag);
          var company = document.createElement('span'); company.className = 'company'; company.textContent = r.c;
          var rowText = document.createElement('span'); rowText.className = 'row-text'; rowText.appendChild(symbol); rowText.appendChild(company); main.appendChild(window.nvBadge(r.s)); main.appendChild(rowText);
          main.addEventListener('click', function () { openModal(r.s, main); });
          var price = document.createElement('div'); price.className = 'price'; price.textContent = r.p;
          var move = document.createElement('div'); move.className = 'move ' + (r.d || ''); move.textContent = r.vol ? r.m + ' shares' : dirArrow(r) + r.m;
          item.appendChild(star); item.appendChild(main); item.appendChild(price); item.appendChild(move);
          screenList.appendChild(item);
        });
      }
      (function buildScreenChips() {
        var host = document.getElementById('screenMover');
        [['all', 'All'], ['gainers', 'Gainers'], ['losers', 'Losers'], ['volume', 'Most traded']].forEach(function (opt) {
          var b = document.createElement('button'); b.type = 'button'; b.className = 'sector-chip';
          b.textContent = opt[1]; b.setAttribute('aria-pressed', opt[0] === 'all' ? 'true' : 'false');
          b.addEventListener('click', function () {
            scrState.mover = opt[0];
            host.querySelectorAll('.sector-chip').forEach(function (c) { c.setAttribute('aria-pressed', c === b ? 'true' : 'false'); });
            renderScreener();
          });
          host.appendChild(b);
        });
      }());
      (function buildScreenSectors() {
        var sel = document.getElementById('screenSector');
        var sectors = ['All'];
        directory.forEach(function (e) { if (sectors.indexOf(e.g) === -1) sectors.push(e.g); });
        sectors.forEach(function (name) {
          var o = document.createElement('option'); o.value = name;
          o.textContent = name === 'All' ? 'All sectors' : name;
          sel.appendChild(o);
        });
        sel.addEventListener('change', function () { scrState.sector = sel.value; renderScreener(); });
      }());
      [['screenMinP', 'minP'], ['screenMaxP', 'maxP'], ['screenMinC', 'minC'], ['screenMaxC', 'maxC']].forEach(function (pair) {
        document.getElementById(pair[0]).addEventListener('input', function (ev) { scrState[pair[1]] = ev.target.value; renderScreener(); });
      });
      document.getElementById('screenSort').addEventListener('change', function (ev) { scrState.sort = ev.target.value; renderScreener(); });
      document.getElementById('screenReset').addEventListener('click', function () {
        scrState = { mover: 'all', sector: 'All', minP: '', maxP: '', minC: '', maxC: '', sort: 'chg-desc' };
        document.getElementById('screenSector').value = 'All';
        document.getElementById('screenSort').value = 'chg-desc';
        ['screenMinP', 'screenMaxP', 'screenMinC', 'screenMaxC'].forEach(function (id) { document.getElementById(id).value = ''; });
        document.querySelectorAll('#screenMover .sector-chip').forEach(function (c, i) { c.setAttribute('aria-pressed', i === 0 ? 'true' : 'false'); });
        renderScreener();
      });
      renderScreener();
      }
      /* ---- Calendar type filters ---- */
      (function buildCalChips() {
        var host = document.getElementById('calChips');
        if (!host) return;
        ['All', 'Dividend', 'Offer', 'Earnings', 'Regulatory'].forEach(function (name, i) {
          var b = document.createElement('button'); b.type = 'button'; b.className = 'sector-chip';
          b.textContent = name; b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
          b.addEventListener('click', function () {
            host.querySelectorAll('.sector-chip').forEach(function (c) { c.setAttribute('aria-pressed', c === b ? 'true' : 'false'); });
            document.querySelectorAll('.cal-event').forEach(function (ev) {
              ev.style.display = (name === 'All' || ev.getAttribute('data-type') === name) ? '' : 'none';
            });
          });
          host.appendChild(b);
        });
      }());
      updateWatchCount();
      if (document.getElementById('asiChart')) draw(currentRange);
      render();
      renderDirectory();
      /* Live-data hooks: assets/live.js swaps in fresh market data after load
         and calls these to repaint without a page reload. */
      window.NV = window.NV || {};
      window.NV.redrawAsi = function (r) { if (document.getElementById('asiChart')) draw(r || currentRange); };
      window.NV.renderTape = function () { renderTape(); };
      window.NV.renderHeatmap = function () { renderHeatmap(); };
      window.NV.renderTables = function () { render(); };
      window.NV.renderDirectory = function () { renderDirectory(); };
      window.NV.renderScreener = function () { if (typeof renderScreener === 'function' && document.getElementById('screenList')) renderScreener(); };
    }());
    /* ---- 11. Sticky section sub-nav scroll-spy (homepage only) ---- */
    (function () {
      var nav = document.querySelector('.section-subnav');
      if (!nav || !('IntersectionObserver' in window)) return;
      var links = Array.prototype.slice.call(nav.querySelectorAll('a'));
      var map = {};
      links.forEach(function (a) {
        var id = a.getAttribute('href').slice(1);
        if (document.getElementById(id)) map[id] = a;
      });
      if (!links.length) return;
      var obs = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            links.forEach(function (a) { a.classList.toggle('active', a === map[e.target.id]); });
          }
        });
      }, { rootMargin: '-40% 0px -55% 0px' });
      Object.keys(map).forEach(function (id) { obs.observe(document.getElementById(id)); });
    }());
    /* ---- 12. Close-based price alerts (stock pages; signed-in users) ---- */
    (function priceAlerts() {
      var API = 'https://nairaview-api.meetomidiora.workers.dev';
      var m = window.location.pathname.match(/\/stocks\/([A-Za-z0-9]+)/);
      if (!m) return;
      var ticker = m[1].toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
      if (!ticker) return;
      var heading = document.querySelector('.section-heading');
      var anchor = heading ? heading.querySelector('p.asof') : null;
      if (!anchor) return;
      function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
      }
      function money(n) {
        return '\u20A6' + Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
      var box = document.createElement('div');
      box.className = 'alert-widget';
      box.innerHTML =
        '<h3 class="alert-title">Price alerts</h3>' +
        '<p class="guide-p alert-note">We check each daily close and email you once when ' + esc(ticker) + ' hits your target.</p>' +
        '<div class="alert-list"></div>' +
        '<p class="guide-p alert-signin" hidden>Please <a href="../account">sign in</a> to set a price alert.</p>' +
        '<form class="alert-form" hidden>' +
        '<label>Target (\u20A6)<input type="number" name="alerttarget" min="0.01" step="0.01" inputmode="decimal" required placeholder="0.00"></label>' +
        '<label>Direction<select name="alertdirection"><option value="above">at or above</option><option value="below">at or below</option></select></label>' +
        '<button type="submit" class="btn-primary">Set alert</button></form>' +
        '<p class="form-error" role="alert" hidden></p>';
      anchor.parentNode.insertBefore(box, anchor.nextSibling);
      var listEl = box.querySelector('.alert-list');
      var form = box.querySelector('.alert-form');
      var signin = box.querySelector('.alert-signin');
      var errEl = box.querySelector('.form-error');
      function showErr(msg) { errEl.textContent = msg || ''; errEl.hidden = !msg; }
      function renderAlerts(alerts) {
        var mine = (alerts || []).filter(function (a) { return a && a.ticker === ticker; });
        if (!mine.length) { listEl.innerHTML = ''; return; }
        listEl.innerHTML = mine.map(function (a) {
          var label = a.active === false
            ? 'Triggered at ' + money(a.triggered_price) + ' \u2014 now off'
            : (a.direction === 'below' ? 'At or below ' : 'At or above ') + money(a.target);
          return '<div class="alert-row"><span>' + esc(label) + '</span>' +
            '<button type="button" class="btn-ghost alert-del" data-id="' + esc(a.id) + '">Remove</button></div>';
        }).join('');
      }
      function readJson(res) { return res.json().then(function (j) { return { ok: res.ok, j: j }; }); }
      listEl.addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('.alert-del') : null;
        if (!b) return;
        showErr('');
        fetch(API + '/api/alerts?id=' + encodeURIComponent(b.getAttribute('data-id')),
          { method: 'DELETE', credentials: 'include' })
          .then(readJson)
          .then(function (r) { if (!r.ok) throw new Error((r.j && r.j.error) || 'Could not remove.'); load(); })
          .catch(function (e2) { showErr(e2.message); });
      });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        showErr('');
        var target = Number(form.querySelector('[name=alerttarget]').value);
        var direction = form.querySelector('[name=alertdirection]').value;
        fetch(API + '/api/alerts', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker: ticker, target: target, direction: direction })
        })
          .then(readJson)
          .then(function (r) { if (!r.ok) throw new Error((r.j && r.j.error) || 'Could not save.'); form.reset(); load(); })
          .catch(function (e2) { showErr(e2.message); });
      });
      function load() {
        fetch(API + '/api/alerts', { credentials: 'include' })
          .then(function (r) { if (!r.ok) throw new Error('load'); return r.json(); })
          .then(function (j) { renderAlerts(j.alerts); })
          .catch(function () { renderAlerts([]); });
      }
      fetch(API + '/api/auth/me', { credentials: 'include' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (me) {
          if (me && me.email) { form.hidden = false; load(); }
          else { signin.hidden = false; }
        })
        .catch(function () { signin.hidden = false; });
    }());
