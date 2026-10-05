/* Nairaview live market layer.
   Fetches the NGX feed (nairaview-api worker -> Cloudflare KV): a full pull
   each weekday after close plus a lighter session poll every 30 minutes
   while the market is open (Mon-Fri 9:30-16:00 WAT). Session snapshots are
   ~30 minutes delayed and labeled as such; outside session hours the page
   shows the latest daily close. Repaints the hero, metrics, ASI chart,
   ticker tape, heatmap, movers tables, directory, screener, stock pages and
   portfolio. Every block is guarded: if the feed is unreachable, the page
   keeps its static snapshot and nothing throws. */
(function () {
  'use strict';
  var API = 'https://nairaview-api.meetomidiora.workers.dev';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function getJSON(path) {
    return fetch(API + path).then(function (r) {
      if (!r.ok) throw new Error('bad status');
      return r.json();
    }).catch(function () { return null; });
  }
  function fmt2(n) {
    return Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  /* Nullable OHLC: corrupt/missing fields arrive as null — show "—", never ₦0.00. */
  function fmtN(n) {
    return (n === null || n === undefined || n === '') ? '—' : '₦' + fmt2(n);
  }
  function fmtInt(n) { return Math.round(Number(n)).toLocaleString('en-NG'); }
  function compact(n) {
    n = Number(n);
    if (n >= 1e12) return '₦' + (n / 1e12).toFixed(3) + 'tn';
    if (n >= 1e9) return '₦' + (n / 1e9).toFixed(2) + 'bn';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'm';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(Math.round(n));
  }
  function fmtDate(iso) {
    var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    return m[3].replace(/^0/, '') + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1];
  }
  var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  function fmtDateLong(iso) {
    var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    return Number(m[3]) + ' ' + MONTHS_LONG[Number(m[2]) - 1] + ' ' + m[1];
  }
  /* HH:MM in WAT (UTC+1, no DST) from an ISO UTC timestamp. */
  function fmtTimeWAT(iso) {
    var m = String(iso || '').match(/T(\d{2}):(\d{2})/);
    if (!m) return '';
    var h = (Number(m[1]) + 1) % 24;
    return (h < 10 ? '0' : '') + h + ':' + m[2];
  }
  /* Current weekday in WAT (0=Sunday..6=Saturday), visitor-timezone-proof. */
  function watWeekdayNow() {
    return new Date(Date.now() + 3600000).getUTCDay();
  }
  /* True only during the NGX continuous session (Mon-Fri 9:30-16:00 WAT),
     visitor-timezone-proof. The provider's own open/closed flag has been
     observed stale (still "open" hours after the close), so the clock is
     the primary signal; the provider can only veto with a closure
     (holiday), never declare the market open outside session hours. */
  function watInSessionNow() {
    var d = new Date(Date.now() + 3600000);
    var wd = d.getUTCDay();
    if (wd === 0 || wd === 6) return false;
    var mins = d.getUTCHours() * 60 + d.getUTCMinutes();
    return mins >= 570 && mins <= 960;
  }
  function signedPct(x) {
    x = Number(x) || 0;
    return (x < 0 ? '−' : '+') + Math.abs(x).toFixed(2) + '%';
  }

  /* ---------- homepage: hero + metrics + market-today recap ---------- */
  function paintMarket(market) {
    var ov = market && market.overview && market.overview.data;
    if (!ov) return;
    var tradeDate = fmtDate(ov.trade_date);
    var h1 = $('market-heading');
    if (h1) h1.textContent = fmt2(ov.asi);
    var move = $('heroMove');
    if (move) {
      var pct = Number(ov.pct_change) || 0;
      var pts = ov.asi * pct / 100;
      var cls = pct < 0 ? 'down' : 'up';
      move.innerHTML = '<span class="' + cls + '">' + (pct < 0 ? '▼ ' : '▲ ') + signedPct(pct) + '</span>' +
        '<span class="points">' + (pts < 0 ? '−' : '+') + fmt2(Math.abs(pts)) + ' points</span>';
    }
    var chartValue = $('chartValue');
    if (chartValue) chartValue.textContent = fmt2(ov.asi);
    function setMetric(id, detailId, value, detail) {
      var v = $(id), d = detailId && $(detailId);
      if (v) v.textContent = value;
      if (d) d.textContent = detail;
    }
    setMetric('metricMcap', null, compact(ov.market_cap));
    setMetric('metricVol', null, compact(ov.volume).replace('₦', ''));
    setMetric('metricDeals', null, fmtInt(ov.deals));
    /* Session state: the 30-min session poll marks its payload, and the
       status feed carries the real open/closed state. */
    var st = market.status && market.status.data;
    /* Single source of truth for open/closed, shared by the status pill
       and the topline label so they can never disagree with each other. */
    var providerClosed = (st && st.is_open === false) ||
      String(ov.market_status || '').toLowerCase() === 'closed';
    var marketOpen = watInSessionNow() && !providerClosed;
    var sessionLive = !!(marketOpen && ov.session);
    var sessionTime = sessionLive ? fmtTimeWAT(ov.as_of) : '';
    /* Every page carries a .topline-date hook now (index.html keeps its
       toplineDate id too). Three states: live session > weekday daily
       close > weekend snapshot, when the last close is two sessions old. */
    var td = document.querySelector('.topline .topline-date') || $('toplineDate');
    if (td) {
      var wd = watWeekdayNow();
      var weekend = wd === 0 || wd === 6;
      td.textContent = sessionLive
        ? 'SESSION · AS OF ' + sessionTime + ' WAT · ~30-MIN DELAYED'
        : (weekend ? 'SNAPSHOT · ' : 'DAILY CLOSE · ') + tradeDate.toUpperCase() + ' · WAT';
    }
    /* Keep every other feed-driven date caption in sync with the actual
       trade date, so the static fallbacks can't contradict the live data. */
    try {
      var longD = fmtDateLong(ov.trade_date);
      window.NVTradeDate = tradeDate;
      window.NVTradeDateLong = longD;
      var ml = $('modalList');
      if (ml) ml.textContent = 'Snapshot · ' + tradeDate;
      var mn = $('modalNoteDate');
      if (mn) mn.textContent = longD;
      var fd = $('footDate');
      if (fd) fd.textContent = tradeDate;
      try {
        var nds = document.querySelectorAll('.noteDate');
        for (var ni = 0; ni < nds.length; ni++) nds[ni].textContent = tradeDate;
      } catch (e2) {}
      var tp = $('tapeDate');
      if (tp) tp.textContent = longD;
      var ht = $('heatTiles');
      if (ht) ht.setAttribute('aria-label', 'Market heatmap, ' + longD);
    } catch (e) {}
    /* Hero metadata line: one quiet breadth/as-of line under the big figure. */
    var note = $('heroNote');
    if (note) {
      var pct2 = Number(ov.pct_change) || 0;
      note.textContent = fmtInt(ov.advancers) + ' advancers · ' + fmtInt(ov.decliners) + ' decliners · ' +
        fmtInt(ov.unchanged) + ' unchanged' + (sessionLive ? ' · as of ' + sessionTime + ' WAT · ~30-min delayed' : '');
    }
    var md = $('metricsDate');
    if (md) md.textContent = tradeDate;
    /* One consistent open/closed signal on every page: the WAT clock decides,
       the provider feed can only confirm a closure (holiday). */
    var statusEl = document.querySelector('.topline .status');
    if (statusEl) {
      statusEl.innerHTML = '<i class="status-dot" aria-hidden="true"></i> ' + (marketOpen ? 'MARKET OPEN' : 'MARKET CLOSED');
      statusEl.classList.toggle('closed', !marketOpen);
      statusEl.title = 'Market state: NGX trades Mon\u2013Fri 10:00\u201314:30 WAT. Prices carry the exchange\u2019s usual delay.';
    }
    /* Homepage hero pill mirrors the topline state (Figma quote-hero pattern). */
    var hp = document.getElementById('heroPill');
    if (hp) {
      hp.innerHTML = '<span class="dot"></span>' + (marketOpen ? 'MARKET OPEN' : 'MARKET CLOSED') +
        (sessionLive ? ' \u00B7 ' + sessionTime + ' WAT' : '');
      hp.classList.toggle('is-closed', !marketOpen);
    }
  }

  /* ---------- ASI history: real 120-session chart + honest YTD ---------- */
  function paintAsi(doc) {
    var hist = doc && doc.history;
    if (!hist || !hist.length || typeof asiHistory === 'undefined') return;
    asiHistory.length = 0;
    hist.forEach(function (p) {
      asiHistory.push({ d: String(p.date).slice(0, 10), label: fmtDate(p.date), v: Number(p.value) });
    });
    /* YTD computed from the first session of the current year (worker supplies
       the base; the 120-point chart window alone would not reach January). */
    var base = doc.ytd_base && Number(doc.ytd_base.value);
    if (base) {
      var last = asiHistory[asiHistory.length - 1].v;
      var ytd = (last - base) / base * 100;
      var ytdEl = $('metricYtd'), ytdD = $('metricYtdDetail');
      if (ytdEl) {
        ytdEl.textContent = signedPct(ytd);
        ytdEl.style.color = '';
      }
      if (ytdD) ytdD.textContent = 'from ' + fmtDate(doc.ytd_base.date);
    }
    if (window.NV && window.NV.redrawAsi) {
      try { window.NV.redrawAsi(); } catch (e) {}
    }
    /* Keep the chart's date caption honest: it shows the actual data window. */
    try {
      if (asiHistory.length) {
        var firstD = asiHistory[0].d, lastD = asiHistory[asiHistory.length - 1].d;
        var cd = $('chartDesc');
        if (cd) cd.textContent = 'Interactive chart showing selected verified market closes from ' +
          fmtDateLong(firstD) + ' to ' + fmtDateLong(lastD) + '.';
      }
    } catch (e) {}
  }

  /* ---------- movers tables, tape, heatmap, directory, screener ---------- */
  function toRow(s) {
    var px = Number(s.current_price);
    var chg = s.official_change_percent != null ? s.official_change_percent : s.change_percent;
    chg = Number(chg) || 0;
    return {
      s: s.symbol, c: s.name, p: '₦' + fmt2(px),
      m: signedPct(chg), d: chg < 0 ? 'down' : 'up',
      pv: px, cv: Math.round(chg * 100) / 100, volNum: Number(s.volume) || 0,
      mc: Number(s.market_cap) || 0, noSnap: false
    };
  }
  function paintStocks(doc) {
    var list = doc && doc.stocks && doc.stocks.stocks;
    if (!list || !list.length || typeof tables === 'undefined') return;
    var rows = list.map(toRow);
    var gainers = rows.filter(function (r) { return r.cv > 0; }).sort(function (a, b) { return b.cv - a.cv; }).slice(0, 5);
    var losers = rows.filter(function (r) { return r.cv < 0; }).sort(function (a, b) { return a.cv - b.cv; }).slice(0, 5);
    var volume = rows.slice().sort(function (a, b) { return b.volNum - a.volNum; }).slice(0, 5).map(function (r) {
      return { s: r.s, c: r.c, p: r.p, m: compact(r.volNum).replace('₦', ''), d: 'up', pv: r.pv, cv: r.volNum, vol: true, noSnap: false };
    });
    if (!gainers.length || !losers.length) return; /* keep snapshot if the feed looks thin */
    tables.gainers = gainers;
    tables.losers = losers;
    tables.volume = volume;
    /* Enrich the 170-stock directory exactly like data.js does for snapshots. */
    if (typeof directory !== 'undefined') {
      var bySym = {};
      rows.forEach(function (r) { bySym[r.s] = r; });
      directory.forEach(function (e) {
        var live = bySym[e.s];
        if (live) {
          e.p = live.p; e.m = live.m; e.d = live.d; e.pv = live.pv; e.cv = live.cv;
          e.vol = false; e.noSnap = false;
        }
      });
    }
    if (window.NV) {
      ['renderTape', 'renderHeatmap', 'renderTables', 'renderDirectory', 'renderScreener'].forEach(function (k) {
        try { if (window.NV[k]) window.NV[k](); } catch (e) {}
      });
    }
    /* Hand the price map to the portfolio page (same tab can't be both, but a
       CustomEvent keeps the contract explicit) and stash it globally. */
    var map = {};
    var liveRows = {};
    rows.forEach(function (r) { map[r.s] = r.pv; liveRows[r.s] = { name: r.c, price: r.pv, chg: r.cv }; });
    window.NVLivePrices = map;
    window.NVLiveRows = liveRows;
    if (doc.stocks.as_of) window.NVLiveAsOf = doc.stocks.as_of;
    try {
      window.dispatchEvent(new CustomEvent('nv:live-prices', { detail: { map: map, asOf: doc.stocks.as_of } }));
    } catch (e) {}
  }

  /* ---------- sparkline ---------- */
  function sparkSVG(closes, w, h) {
    w = w || 220; h = h || 56;
    var min = Math.min.apply(null, closes), max = Math.max.apply(null, closes);
    var span = (max - min) || 1;
    var pts = closes.map(function (v, i) {
      var x = closes.length === 1 ? w / 2 : 4 + i * (w - 8) / (closes.length - 1);
      var y = 4 + (1 - (v - min) / span) * (h - 8);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    var up = closes[closes.length - 1] >= closes[0];
    var color = up ? 'var(--green-strong)' : 'var(--red)';
    var lastX = pts.split(' ').pop().split(',');
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" role="img" aria-label="7-session price trend">' +
      '<polyline points="' + esc(pts) + '" fill="none" stroke="' + color + '" stroke-width="2"/>' +
      '<circle cx="' + lastX[0] + '" cy="' + lastX[1] + '" r="3" fill="' + color + '"/></svg>';
  }

  /* ---------- stock pages: interactive price chart ---------- */
  function fmtVolShort(n) {
    n = Number(n) || 0;
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'bn';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'm';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(Math.round(n));
  }
  function shortDate(iso) {
    var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    return Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1];
  }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function drawStockChart(mount, prices, days) {
    /* prices: [{date,open,high,low,close,volume}] oldest -> newest */
    var data = days ? prices.slice(-days) : prices.slice();
    var head = mount.querySelector('.pchart-head');
    var wrap = mount.querySelector('.pchart-wrap');
    var pills = mount.querySelector('.pchart-pills');
    var note = mount.querySelector('.pc-note');
    if (!data || data.length < 2) {
      if (head) head.style.display = 'none';
      if (pills) pills.style.display = 'none';
      wrap.innerHTML = '<p class="guide-p" style="padding:26px 4px">Price history is still accumulating for this stock — check back after the next trading sessions.</p>';
      if (note) note.style.display = 'none';
      return;
    }
    var n = data.length;
    var closes = data.map(function (p) { return Number(p.close); });
    var lo = Math.min.apply(null, data.map(function (p) { return Number(p.low || p.close); }));
    var hi = Math.max.apply(null, data.map(function (p) { return Number(p.high || p.close); }));
    var rng = (hi - lo) || 1;
    var up = closes[n - 1] >= closes[0];
    var col = up ? 'var(--green-strong)' : 'var(--red)';
    var ret = (closes[n - 1] / closes[0] - 1) * 100;

    var W = 760, H = 320, padL = 6, padR = 64, padT = 10;
    var pxTop = padT, pxBot = 272, xBot = 300;
    function X(i) { return padL + (W - padL - padR) * (n === 1 ? 0.5 : i / (n - 1)); }
    function Y(v) { return pxBot - (pxBot - pxTop) * (v - lo) / rng; }

    var i, d = '', pts = [];
    for (i = 0; i < n; i++) { pts.push(X(i).toFixed(1) + ',' + Y(closes[i]).toFixed(1)); }
    d = 'M' + pts.join(' L');
    var area = d + ' L' + X(n - 1).toFixed(1) + ',' + pxBot + ' L' + X(0).toFixed(1) + ',' + pxBot + ' Z';

    var grid = '', gl;
    for (i = 0; i <= 4; i++) {
      gl = pxBot - (pxBot - pxTop) * i / 4;
      var gv = lo + rng * i / 4;
      grid += '<line x1="' + padL + '" y1="' + gl.toFixed(1) + '" x2="' + (W - padR + 8) + '" y2="' + gl.toFixed(1) + '" stroke="var(--line)" stroke-width="1" stroke-dasharray="3 5" opacity="0.7"/>' +
        '<text x="' + (W - padR + 14) + '" y="' + (gl + 4).toFixed(1) + '" font-size="11" fill="var(--muted)" font-family="IBM Plex Mono,monospace">₦' + fmt2(gv) + '</text>';
    }
    var bars = '';
    var xl = '', ticks = 5, ti;
    for (ti = 0; ti < ticks; ti++) {
      i = Math.round(ti * (n - 1) / (ticks - 1));
      xl += '<text x="' + X(i).toFixed(1) + '" y="' + xBot + '" font-size="11" fill="var(--muted)" font-family="IBM Plex Mono,monospace" text-anchor="middle">' + esc(shortDate(data[i].date)) + '</text>';
    }
    var lx = X(n - 1), ly = Y(closes[n - 1]);
    var gid = 'pg' + Math.random().toString(36).slice(2, 8);
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Price history chart">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + col + '" stop-opacity="0.25"/><stop offset="1" stop-color="' + col + '" stop-opacity="0"/></linearGradient></defs>' +
      grid + '<path d="' + area + '" fill="url(#' + gid + ')"/>' +
      '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
      bars + xl +
      '<line id="pchart-xhair" y1="' + pxTop + '" y2="' + pxBot + '" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 3" opacity="0" style="display:none"/>' +
      '<circle id="pchart-dot" r="5" fill="' + col + '" stroke="#fff" stroke-width="2.5" opacity="0" style="display:none"/>' +
      '<rect id="pchart-hit" x="' + padL + '" y="' + pxTop + '" width="' + (W - padL - padR) + '" height="' + (pxBot - pxTop) + '" fill="transparent"/>' +
      '<circle cx="' + lx.toFixed(1) + '" cy="' + ly.toFixed(1) + '" r="5" fill="' + col + '" stroke="#fff" stroke-width="2.5"/></svg>';
    wrap.innerHTML = svg + '<div class="pchart-tip" id="pchartTip"></div>';

    var retEl = mount.querySelector('.pchart-ret');
    if (retEl) {
      retEl.textContent = (ret >= 0 ? '+' : '−') + Math.abs(ret).toFixed(2) + '%';
      retEl.className = 'pchart-ret ' + (up ? 'up' : 'down');
    }
    if (note) note.textContent = 'Daily closes · ' + n + ' sessions · ' + shortDate(data[0].date) + ' → ' + shortDate(data[n - 1].date) + ' · not intraday';

    /* timeframe pills */
    if (pills && !pills.dataset.built) {
      pills.dataset.built = '1';
      var defs = [['7D', 7], ['1M', 21], ['3M', 63], ['All', 0]];
      defs.forEach(function (df) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'pchart-pill'; b.textContent = df[0];
        b.setAttribute('aria-pressed', df[1] === days ? 'true' : 'false');
        if (df[1] && prices.length < df[1]) b.disabled = true;
        b.addEventListener('click', function () {
          if (b.disabled) return;
          var all = pills.querySelectorAll('.pchart-pill');
          for (var k = 0; k < all.length; k++) all[k].setAttribute('aria-pressed', 'false');
          b.setAttribute('aria-pressed', 'true');
          drawStockChart(mount, prices, df[1]);
        });
        pills.appendChild(b);
      });
    }

    /* hover crosshair */
    var hit = wrap.querySelector('#pchart-hit'), xh = wrap.querySelector('#pchart-xhair'),
        dot = wrap.querySelector('#pchart-dot'), tip = wrap.querySelector('#pchartTip');
    if (hit) {
      hit.addEventListener('mousemove', function (ev) {
        var r = hit.getBoundingClientRect();
        var mx = (ev.clientX - r.left) / r.width * (W - padL - padR) + padL;
        var idx = Math.round((mx - padL) / (W - padL - padR) * (n - 1));
        idx = Math.max(0, Math.min(n - 1, idx));
        var p = data[idx], cx = X(idx), cy = Y(Number(p.close));
        xh.setAttribute('x1', cx); xh.setAttribute('x2', cx);
        xh.style.display = 'block'; xh.setAttribute('opacity', '1');
        dot.setAttribute('cx', cx); dot.setAttribute('cy', cy);
        dot.style.display = 'block'; dot.setAttribute('opacity', '1');
        var pc = idx > 0 ? (Number(p.close) / Number(data[idx - 1].close) - 1) * 100 : 0;
        tip.innerHTML = '<div class="t-date">' + esc(fmtDate(p.date)) + '</div>' +
          '<div class="t-close">₦' + fmt2(p.close) + '</div>' +
          '<div class="t-row"><span>Open</span><b>' + fmtN(p.open) + '</b></div>' +
          '<div class="t-row"><span>High</span><b>' + fmtN(p.high) + '</b></div>' +
          '<div class="t-row"><span>Low</span><b>' + fmtN(p.low) + '</b></div>' +
          '<div class="t-row"><span>Change</span><b>' + signedPct(pc) + '</b></div>' +
          '<div class="t-row"><span>Volume</span><b>' + fmtVolShort(p.volume) + '</b></div>';
        tip.style.display = 'block';
        var wr = wrap.getBoundingClientRect();
        var tx = (cx / W) * wr.width + 14, ty = (cy / H) * wr.height - 10;
        tip.style.left = Math.min(tx, wr.width - 190) + 'px';
        tip.style.top = Math.max(ty - 120, 0) + 'px';
      });
      hit.addEventListener('mouseleave', function () {
        xh.style.display = 'none'; dot.style.display = 'none'; tip.style.display = 'none';
      });
    }
  }

  function refreshStockStats(prices) {
    if (!prices || prices.length < 1) return;
    var last = prices[prices.length - 1];
    var prev = prices.length > 1 ? prices[prices.length - 2] : last;
    var vols = prices.map(function (p) { return Number(p.volume) || 0; });
    var avgV = vols.reduce(function (a, b) { return a + b; }, 0) / vols.length;
    var hiT = Math.max.apply(null, prices.map(function (p) { return Number(p.high || p.close); }));
    var loT = Math.min.apply(null, prices.map(function (p) { return Number(p.low || p.close); }));
    var w0 = prices.length > 7 ? prices[prices.length - 8] : prices[0];
    var wchg = (Number(last.close) / Number(w0.close) - 1) * 100;
    function set(k, txt, cls) {
      var el = document.querySelector('[data-stat="' + k + '"] .v');
      if (!el) return;
      el.textContent = txt;
      if (cls) { el.classList.remove('up', 'down'); if (cls) el.classList.add(cls); }
    }
    set('open', fmtN(last.open));
    set('dayhigh', fmtN(last.high));
    set('daylow', fmtN(last.low));
    set('prevclose', '₦' + fmt2(prev.close));
    set('volume', fmtVolShort(last.volume));
    set('avgvol', fmtVolShort(avgV));
    set('chg7d', signedPct(wchg), wchg > 0 ? 'up' : (wchg < 0 ? 'down' : ''));
    set('hitracked', '₦' + fmt2(hiT));
    set('lotracked', '₦' + fmt2(loT));
    /* rebuild the history table from live data */
    var tb = document.getElementById('histBody');
    if (tb) {
      var html = '';
      for (var i = prices.length - 1; i >= 0; i--) {
        var p = prices[i];
        var pc = i > 0 ? (Number(p.close) / Number(prices[i - 1].close) - 1) * 100 : 0;
        html += '<tr><td>' + esc(fmtDate(p.date)) + '</td><td>' + fmtN(p.open) + '</td><td>' + fmtN(p.high) +
          '</td><td>' + fmtN(p.low) + '</td><td>₦' + fmt2(p.close) + '</td>' +
          '<td class="' + (pc > 0 ? 'up' : (pc < 0 ? 'down' : '')) + '">' + signedPct(pc) + '</td>' +
          '<td>' + fmtVolShort(p.volume) + '</td></tr>';
      }
      tb.innerHTML = html;
    }
  }

  function initStockChart() {
    var mount = document.getElementById('pchartMount');
    if (!mount) return;
    var sym = (window.NV_HIST && window.NV_HIST.symbol) || '';
    var embedded = (window.NV_HIST && window.NV_HIST.prices) || [];
    drawStockChart(mount, embedded, 0);
    refreshStockStats(embedded);
    if (!sym) return;
    /* pull live history and re-render if it is fresher */
    getJSON('/api/history?symbol=' + encodeURIComponent(sym)).then(function (doc) {
      var prices = doc && doc.prices;
      if (!prices || prices.length < 2) return;
      var cur = embedded.length ? embedded[embedded.length - 1].date : '';
      var fresh = prices[prices.length - 1].date;
      if (fresh !== cur || prices.length !== embedded.length) {
        window.NV_HIST.prices = prices;
        var active = mount.querySelector('.pchart-pill[aria-pressed="true"]');
        var days = 0;
        if (active) {
          var t = active.textContent;
          days = t === '7D' ? 7 : (t === '1M' ? 21 : (t === '3M' ? 63 : 0));
        }
        var pills = mount.querySelector('.pchart-pills');
        if (pills) pills.dataset.built = '';
        pills.innerHTML = '';
        drawStockChart(mount, prices, days);
        refreshStockStats(prices);
      }
    });
  }

  /* ---------- stock pages: live price + 7-session sparkline ---------- */
  function paintStockPage(map) {
    var m = window.location.pathname.match(/\/stocks\/([A-Za-z0-9]+)/);
    if (!m) return;
    var sym = m[1].toUpperCase();
    var priceEl = document.querySelector('.stock-price');
    var px = map[sym];
    var tradeDate = '';
    /* Per-stock icon on the stock page header. */
    try {
      if (priceEl && typeof window.nvBadge === 'function') {
        var h1 = priceEl.parentNode.querySelector('h1');
        if (h1 && !h1.querySelector('.stk-badge')) {
          h1.classList.add('stock-head-badged');
          h1.insertBefore(window.nvBadge(sym, 'lg'), h1.firstChild);
        }
      }
    } catch (e) {}
    if (priceEl && px) {
      priceEl.textContent = '₦' + fmt2(px);
      var asof = document.querySelector('p.asof');
      if (asof && window.NVLiveAsOf) tradeDate = fmtDate(window.NVLiveAsOf);
      if (asof) asof.textContent = 'As of the ' + (tradeDate || 'latest') + ' close.';
    }
    /* Keep the "last closed at" guide paragraph and trade-date stamp in sync
       with the live feed, so they can't contradict the hero price above. */
    try {
      var info = window.NVLiveRows && window.NVLiveRows[sym];
      var tdate = (window.NVLiveAsOf && fmtDate(window.NVLiveAsOf)) || tradeDate || '';
      var ltd = document.querySelectorAll('.liveTradeDate');
      for (var li = 0; li < ltd.length; li++) { if (tdate) ltd[li].textContent = tdate; }
      if (info) {
        var arrow = info.chg > 0 ? '▲' : (info.chg < 0 ? '▼' : '■');
        var gps = document.querySelectorAll('p.guide-p');
        for (var gi = 0; gi < gps.length; gi++) {
          var gp = gps[gi];
          if ((gp.textContent || '').indexOf('last closed at') !== -1) {
            gp.innerHTML = esc(info.name) + ' (' + esc(sym) + ') last closed at <strong>₦' + fmt2(info.price) +
              '</strong> (' + signedPct(info.chg) + ' ' + arrow + ' on the day) on ' + esc(tdate || 'latest') +
              '. Prices update here after each NGX trading session.';
          }
        }
      }
    } catch (e) {}
    getJSON('/api/history?symbol=' + encodeURIComponent(sym)).then(function (doc) {
      var prices = doc && doc.prices;
      if (!prices || prices.length < 2 || !priceEl || priceEl.querySelector('.spark')) return;
      var closes = prices.map(function (p) { return Number(p.close); });
      var wrap = document.createElement('div');
      wrap.className = 'spark-wrap';
      wrap.innerHTML = sparkSVG(closes) +
        '<div class="spark-caption">Last ' + closes.length + ' sessions · ' + fmtDate(prices[0].date) + ' → ' + fmtDate(prices[prices.length - 1].date) + '</div>';
      priceEl.parentNode.insertBefore(wrap, priceEl.nextSibling);
    });
  }

  function main() {
    getJSON('/api/market').then(function (market) {
      if (market) {
        try { paintMarket(market); } catch (e) {}
        var ov = market.overview && market.overview.data;
        if (ov && ov.trade_date) window.NVLiveAsOf = ov.trade_date;
      } else {
        /* Feed unreachable: the WAT clock alone still gives an honest
           open/closed pill so the page can't show a stale state. */
        try {
          var open = watInSessionNow();
          var el = document.querySelector('.topline .status');
          if (el) {
            el.innerHTML = '<i class="status-dot" aria-hidden="true"></i> ' + (open ? 'MARKET OPEN' : 'MARKET CLOSED');
            el.classList.toggle('closed', !open);
          }
          var hp2 = document.getElementById('heroPill');
          if (hp2) {
            hp2.innerHTML = '<span class="dot"></span>' + (open ? 'MARKET OPEN' : 'MARKET CLOSED');
            hp2.classList.toggle('is-closed', !open);
          }
        } catch (e) {}
      }
    });
    getJSON('/api/prices').then(function (prices) {
      if (prices) {
        try { paintStocks(prices); } catch (e) {}
        try { paintStockPage(window.NVLivePrices || {}); } catch (e) {}
      }
    });
    getJSON('/api/asi-history').then(function (doc) {
      if (doc) { try { paintAsi(doc); } catch (e) {} }
    });
    getJSON('/api/fx').then(function (doc) {
      if (doc) { try { paintFxStrip(doc); } catch (e) {} }
    });
    try { initStockChart(); } catch (e) {}
  }

  /* Homepage FX tiles (USD/EUR/GBP). Guarded: "—" stays if the feed fails. */
  function paintFxStrip(doc) {
    var latest = doc && doc.latest;
    if (!latest) return;
    [['USD', 'fxUsd'], ['EUR', 'fxEur'], ['GBP', 'fxGbp']].forEach(function (pair) {
      var ccy = latest[pair[0]];
      if (!ccy) return;
      var off = $(pair[1] + 'Official'), par = $(pair[1] + 'Parallel'),
          spr = $(pair[1] + 'Spread');
      if (off && ccy.official > 0) off.textContent = '₦' + fmt2(ccy.official);
      if (par && ccy.parallel > 0) par.textContent = '₦' + fmt2(ccy.parallel);
      if (spr && ccy.official > 0 && ccy.parallel > 0) {
        spr.textContent = '₦' + fmt2(Math.abs(ccy.parallel - ccy.official));
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
  else main();
}());
