#!/usr/bin/env python3
"""Generate one SEO stock page per NGX feed ticker in stocks/{SYM}.html.

Figma redesign pattern (quote hero, stat cards, price chart, dark footer).
Uses only real feed data; every figure is labeled with its trade date.
Trade date is derived from the feed itself (never hardcoded).
No invented fundamentals. Alias stubs (ACCESS/FBNH/GUARANTY) are preserved.
Curated external related-links are carried over per page.
"""
import json, os, html, re, urllib.request
from datetime import datetime

ROOT = os.path.expanduser('~/workspace/nairaview')
ASSET_V = '20261004a'
API = 'https://nairaview-api.meetomidiora.workers.dev'
SKIP = {'ACCESS', 'FBNH', 'GUARANTY'}  # ticker-alias redirect stubs
ALIAS = {'GUARANTY': 'GTCO', 'ACCESS': 'ACCESSCORP', 'TOTALNG': 'TOTAL', 'CCNN': 'BUACEMENT'}
LOGOS = set(f[:-4] for f in os.listdir(os.path.join(ROOT, 'assets', 'logos')) if f.endswith('.png'))
PALETTE = ['#1d4ed8', '#0e7490', '#0f766e', '#15803d', '#4d7c0f', '#a16207',
           '#b45309', '#b91c1c', '#be123c', '#7c3aed', '#6d28d9', '#0c4a6e']

def get_json(path, timeout=25):
    """Fetch JSON via curl (urllib hits IncompleteRead on large responses here)."""
    import subprocess
    out = subprocess.run(
        ['curl', '-s', '--retry', '2', '--max-time', str(timeout),
         '-H', 'User-Agent: nairaview-gen/1.0', API + path],
        capture_output=True, text=True, timeout=timeout + 10)
    return json.loads(out.stdout)

def fetch_prices():
    """Fetch /api/prices with retries; fall back to a fresh local snapshot."""
    last = None
    for _ in range(3):
        try:
            return get_json('/api/prices', timeout=45)
        except Exception as e:
            last = e
    fb = '/tmp/prices_feed.json'
    if os.path.exists(fb):
        print('API unreachable, using local snapshot', fb)
        return json.load(open(fb))
    raise last

print('fetching /api/prices ...')
d = fetch_prices()
inner = d['stocks'] if isinstance(d.get('stocks'), dict) else {}
stocks = inner.get('stocks', []) if isinstance(inner, dict) else []
raw_td = ((inner.get('market') or {}).get('trade_date')
          or inner.get('trade_date') or d.get('trade_date') or '')
try:
    dt = datetime.fromisoformat(str(raw_td).replace('Z', '+00:00'))
    trade_date = dt.strftime('%d %b %Y').lstrip('0')
    trade_iso = dt.strftime('%Y-%m-%d')
except Exception:
    trade_date = str(raw_td) or 'latest close'
    trade_iso = ''
print('trade_date:', trade_date, '| stocks:', len(stocks))

# carry over curated external related links from the pre-redesign pages (backup)
CURATED = {}
_backup = '/tmp/stocks_backup'
for sym in [s['symbol'] for s in stocks]:
    p = os.path.join(_backup, sym + '.html')
    if not os.path.exists(p):
        continue
    s = open(p).read()
    links = re.findall(r'<li><a href="(https?://[^"]+)"[^>]*>([^<]+)</a></li>', s)
    if links:
        CURATED[sym] = [(h, t) for h, t in links
                        if 'nairaview.com' not in h and not h.startswith('../')]
print('pages with curated links:', len(CURATED))

def esc(t):
    return html.escape(str(t), quote=True)

def fnum(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0

def fmt_price(p):
    return '₦' + format(fnum(p), ',.2f')

def fmt2(p):
    return format(fnum(p), ',.2f')

def fmt_ohlc(p):
    """Nullable OHLC: corrupt/missing fields arrive as None — show "—", never ₦0.00."""
    return '—' if p is None else '₦' + format(float(p), ',.2f')

def fmt_date_iso(iso):
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})', str(iso or ''))
    if not m:
        return ''
    months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return '%d %s %s' % (int(m.group(3)), months[int(m.group(2)) - 1], m.group(1))

def fmt_pct(p):
    v = fnum(p)
    return ('+' if v > 0 else '') + format(v, '.2f') + '%'

def fmt_int(n):
    try:
        return format(int(float(n)), ',d')
    except (TypeError, ValueError):
        return '—'

def fmt_mcap(n):
    n = fnum(n)
    if n <= 0:
        return '—'
    if n >= 1e12:
        return '₦' + format(n / 1e12, '.2f') + ' trillion'
    if n >= 1e9:
        return '₦' + format(n / 1e9, '.1f') + ' billion'
    if n >= 1e6:
        return '₦' + format(n / 1e6, '.1f') + ' million'
    return '₦' + format(n, ',.0f')

def fmt_vol(n):
    n = fnum(n)
    if n <= 0:
        return '—'
    if n >= 1e9:
        return format(n / 1e9, '.2f') + 'bn'
    if n >= 1e6:
        return format(n / 1e6, '.1f') + 'm'
    return format(n, ',.0f')

def badge(sym):
    key = ALIAS.get(sym, sym)
    if key in LOGOS:
        return ('<span class="stk-badge lg stk-logo" aria-hidden="true">'
                '<img class="stk-img" data-sym="' + esc(sym) + '" data-size="lg" '
                'src="../assets/logos/' + esc(key) + '.png" alt="" loading="lazy"></span>')
    h = 0
    for ch in sym:
        h = (h * 31 + ord(ch)) % 997
    init = re.sub(r'[^A-Z0-9]', '', sym)[:2]
    return ('<span class="stk-badge lg" style="background:' + PALETTE[h % len(PALETTE)] +
            '" aria-hidden="true">' + esc(init) + '</span>')

def arrow(p):
    v = fnum(p)
    return '▲' if v > 0 else ('▼' if v < 0 else '■')

def footer():
    return '''    <footer class="site-footer">
      <div class="footer-inner">
        <div class="footer-grid">
          <div class="footer-brand">
            <a class="brand" href="../" aria-label="Nairaview home"><img src="../assets/logo-dark.svg" alt="Nairaview" height="34"></a>
            <p>The Nigerian Exchange, decoded daily. Prices, movers, offers and plain-language guides &mdash; built for first-time investors.</p>
          </div>
          <div class="footer-col">
            <h4>Markets</h4>
            <a href="../stocks">All listed stocks</a>
            <a href="../screener">Stock screener</a>
            <a href="../offers">Public offers</a>
            <a href="../calendar">Market calendar</a>
          </div>
          <div class="footer-col">
            <h4>Nairaview</h4>
            <a href="../news">Market news</a>
            <a href="../learn">Learn</a>
            <a href="../portfolio">Portfolio tracker</a>
            <a href="../market-recap">Weekly recap</a>
          </div>
        </div>
        <div class="footer-legal">
          <span>&copy; 2026 Nairaview. information only, not investment advice.</span>
          <span>Market data is delayed. Prices may have changed, confirm before acting.</span>
        </div>
      </div>
    </footer>'''

TEMPLATE = '''<!doctype html>
<html lang="en">
<head>
<script>try{var t=localStorage.getItem("nv-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t);}catch(e){}</script>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="color-scheme" content="light dark" />
  <meta name="theme-color" content="#022126" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Nairaview" />
<meta property="og:title" content="@@OG_TITLE@@" />
<meta property="og:description" content="@@OG_DESC@@" />
<meta property="og:url" content="https://nairaview.com/stocks/@@SYM@@" />
<meta property="og:image" content="https://nairaview.com/assets/og-default.png" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="@@OG_TITLE@@" />
<meta name="twitter:description" content="@@OG_DESC@@" />
<meta name="twitter:image" content="https://nairaview.com/assets/og-default.png" />
<link rel="canonical" href="https://nairaview.com/stocks/@@SYM@@" />
  <meta name="description" content="@@META_DESC@@" />
  <link rel="icon" href="../assets/logo-icon.svg" type="image/svg+xml">
  <link rel="icon" href="../assets/favicon-32.png" sizes="32x32" type="image/png">
  <link rel="icon" href="../assets/favicon-48.png" sizes="48x48" type="image/png">
  <link rel="icon" href="../assets/favicon-96.png" sizes="96x96" type="image/png">
  <link rel="apple-touch-icon" href="../assets/apple-touch-icon.png">
  <title>@@TITLE@@</title>
  <link rel="stylesheet" href="../assets/styles.css?v=@@V@@" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Newsreader:opsz,wght@6..72,500;6..72,650&family=Public+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<script type="application/ld+json">
@@JSONLD@@
</script>
</head>
<body>
  <header class="site-header">
    <div class="header-inner">
      <a class="brand" href="../" aria-label="Nairaview home"><picture><source srcset="../assets/logo-dark.svg" media="(prefers-color-scheme: dark)"><img src="../assets/logo.svg" alt="Nairaview" height="34"></picture></a>
      <nav class="site-nav" aria-label="Primary">
          <a href="../">Home</a>
          <a href="../stocks" class="active">Stocks</a>
          <a href="../screener">Screener</a>
          <a href="../offers">Offers</a>
          <a href="../calendar">Calendar</a>
          <a href="../news">News</a>
          <a href="../learn">Learn</a>
      </nav>
    </div>
  </header>
  <div class="shell">
    <div class="topline">
      <span class="status"><i class="status-dot" aria-hidden="true"></i> MARKET CLOSED</span>
      <span>DAILY CLOSE &middot; @@TRADE_DATE_UC@@ &middot; WAT</span>
    </div>
    <main>
      <nav class="crumbs" aria-label="Breadcrumb"><a href="../">Home</a><span class="sep">/</span><a href="../stocks">Stocks</a><span class="sep">/</span><span>@@SYM@@</span></nav>
      <div class="quote-hero">
        <div class="section-heading">
          <p class="kicker">Stock page &middot; @@SECTOR@@ &middot; @@BOARD@@</p>
          <div class="quote-top">
            <div class="quote-id">@@BADGE@@<div><h1>@@H1@@</h1></div></div>
            <div><span class="status-pill"><span class="dot"></span>Daily close</span></div>
          </div>
          <div class="quote-price">@@PRICE@@</div>
          <div class="quote-chg @@CHG_CLASS@@">@@DAY_CHG@@</div>
          <p class="asof">As of the @@TRADE_DATE@@ close.</p>
        </div>
      </div>
@@KSTATS@@
@@CHARTMOUNT@@
@@PRANGE@@
@@HISTTABLE@@
      <div class="section" style="padding-top:34px">
        <div class="ad-slot ad-leaderboard" aria-hidden="true">
          <div class="ad-label">Advertisement</div>
          <script>
  atOptions = {
    'key' : '66835af5f63b0f5a7059b9333d8d655e',
    'format' : 'iframe',
    'height' : 90,
    'width' : 728,
    'params' : {}
  };
</script>
<script src="https://www.highrevenueformat.com/66835af5f63b0f5a7059b9333d8d655e/invoke.js"></script>
        </div>
        <h2 class="guide-h2">How to buy @@SYM@@ shares</h2>
        <p class="guide-p">Open an account with an NGX-licensed stockbroker, place a buy order for <strong>@@SYM@@</strong>, and track it in your <a href="../portfolio">portfolio tracker</a>. First time buying? <a href="../learn-buy-first-stock">This walkthrough</a> covers each step.</p>
        <h2 class="guide-h2">Frequently asked questions</h2>
        <details class="faq-item"><summary class="faq-q">What is the current @@SYM@@ share price?</summary><div class="faq-a"><p class="guide-p">@@NAME@@ (@@SYM@@) last closed at <strong>@@PRICE@@</strong> (@@DAY_CHG@@ on the day) on @@TRADE_DATE@@. Prices update here after each NGX trading session.</p></div></details>
        <details class="faq-item"><summary class="faq-q">What sector is @@SYM@@ in?</summary><div class="faq-a"><p class="guide-p">@@SYM@@ is listed on the NGX @@BOARD@@ under the @@SECTOR@@ sector.</p></div></details>
        <details class="faq-item"><summary class="faq-q">Where can I see @@SYM@@&rsquo;s recent price trend?</summary><div class="faq-a"><p class="guide-p">@@TREND_ANSWER@@</p></div></details>
        <details class="faq-item"><summary class="faq-q">Is @@SYM@@ a good investment?</summary><div class="faq-a"><p class="guide-p">Nairaview provides market data, not investment advice. Consider the company&rsquo;s financials, your goals and risk tolerance &mdash; and speak to a licensed adviser before deciding.</p></div></details>
        <h2 class="guide-h2">Related stocks</h2>
        <ul class="guide-list">
@@PEERS@@
@@CURATED@@
        </ul>
      </div>
    </main>
  </div>
@@FOOTER@@
  <script src="../assets/data.js?v=@@V@@"></script>
  <script src="../assets/logos.js"></script>
  <script src="../assets/site.js?v=@@V@@"></script>
  <script src="../assets/live.js?v=@@V@@"></script>
  <!-- Cloudflare Web Analytics --><script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{{"token": "a9f4136dd40547a7b1acca41e62cc7a5"}}'></script><!-- End Cloudflare Web Analytics -->
</body>
</html>
'''

by_sector = {}
for s in stocks:
    by_sector.setdefault(s.get('sector') or 'Other', []).append(s)
for sec in by_sector:
    by_sector[sec].sort(key=lambda s: fnum(s.get('market_cap')), reverse=True)

made, skipped, nochart = [], [], []
for s in stocks:
    sym = s['symbol']
    if sym in SKIP:
        skipped.append(sym)
        continue
    out = os.path.join(ROOT, 'stocks', sym + '.html')
    name = s.get('name') or sym
    sector = s.get('sector') or 'Other'
    board = s.get('market') or 'Main Board'
    price = fnum(s.get('current_price'))
    cp = fnum(s.get('change_percent'))
    prev = fnum(s.get('previous_close')) or (price / (1 + cp / 100) if cp != -100 else price)
    pts = price - prev
    day_chg = '%s %s (%s₦%s)' % (fmt_pct(cp), arrow(cp),
                                 '+' if pts > 0 else ('−' if pts < 0 else ''),
                                 format(abs(pts), ',.2f'))
    w = fnum(s.get('pct_change_7d'))
    w_chg = '%s %s' % (fmt_pct(w), arrow(w))
    volume = fmt_vol(s.get('volume'))
    mcap = fmt_mcap(s.get('market_cap'))
    shares = fmt_int(s.get('shares_outstanding'))

    # price history for the chart + key statistics (OHLCV per session)
    hist = []
    try:
        h = get_json('/api/history?symbol=' + sym, timeout=15)
        def _nn(x):
            # nullable OHLC: keep None as None so the page can show "—"
            try:
                v = float(x)
            except (TypeError, ValueError):
                return None
            return round(v, 2) if v > 0 else None
        for p in (h.get('prices') or []):
            if not p.get('close'):
                continue
            hist.append({
                'date': str(p.get('date') or '')[:10],
                'open': _nn(p.get('open')),
                'high': _nn(p.get('high')),
                'low': _nn(p.get('low')),
                'close': round(fnum(p.get('close')), 2),
                'volume': int(fnum(p.get('volume'))),
            })
    except Exception:
        pass
    if len(hist) >= 2:
        last, prevh = hist[-1], hist[-2]
        vols = [x['volume'] for x in hist]
        avg_v = sum(vols) / len(vols)
        hi_t = max((x['high'] if x['high'] is not None else x['close']) for x in hist)
        lo_t = min((x['low'] if x['low'] is not None else x['close']) for x in hist)
        w0 = hist[-8] if len(hist) > 7 else hist[0]
        w_chg_live = (last['close'] / w0['close'] - 1) * 100 if w0['close'] else 0
        ret_all = (hist[-1]['close'] / hist[0]['close'] - 1) * 100 if hist[0]['close'] else 0
        d_open = fmt_ohlc(last['open'])
        d_high = fmt_ohlc(last['high'])
        d_low = fmt_ohlc(last['low'])
        d_prev = '₦' + fmt2(prevh['close'])
        d_vol = fmt_vol(last['volume'])
        d_avgv = fmt_vol(avg_v)
        d_hit = '₦' + fmt2(hi_t)
        d_lot = '₦' + fmt2(lo_t)
        d_valtraded = '₦' + fmt_vol(last['volume'] * last['close'])
        # tracked-range widget (honest: only the sessions we have)
        span = (hi_t - lo_t) or 1
        pos = max(0, min(100, (last['close'] - lo_t) / span * 100))
        prange = (
            '<div class="prange"><div class="kstats-title">Tracked range &middot; since ' + esc(fmt_date_iso(hist[0]['date'])) + '</div>'
            '<div class="prange-bar"><span class="prange-marker" style="left:' + ('%.1f' % pos) + '%"></span></div>'
            '<div class="prange-labels">'
            '<span class="pl">Low<b>' + d_lot + '</b></span>'
            '<span class="pl">Now<b>₦' + fmt2(last['close']) + '</b></span>'
            '<span class="pl">High<b>' + d_hit + '</b></span>'
            '</div></div>')
        d_wchg = '%s %s' % (fmt_pct(w_chg_live), arrow(w_chg_live))
        d_wcls = 'up' if w_chg_live > 0 else ('down' if w_chg_live < 0 else '')
        n_hist = len(hist)
        chart_ret = '%s%.2f%%' % ('+' if ret_all >= 0 else '−', abs(ret_all))
        chart_rcls = 'up' if ret_all >= 0 else 'down'
        hist_json = json.dumps({'symbol': sym, 'prices': hist}, separators=(',', ':'))
        rows = []
        for x in reversed(hist):
            i = hist.index(x)
            pc = (x['close'] / hist[i - 1]['close'] - 1) * 100 if i > 0 and hist[i - 1]['close'] else 0
            rows.append(
                '<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>₦%s</td>'
                '<td class="%s">%s</td><td>%s</td></tr>' % (
                    esc(fmt_date_iso(x['date'])), fmt_ohlc(x['open']), fmt_ohlc(x['high']),
                    fmt_ohlc(x['low']), fmt2(x['close']),
                    'up' if pc > 0 else ('down' if pc < 0 else ''),
                    '%s%.2f%%' % ('+' if pc >= 0 else '−', abs(pc)),
                    fmt_vol(x['volume'])))
        hist_table = ('<div class="hist-card"><div class="kstats-title">Historical data &middot; daily closes</div>'
                      '<div style="overflow-x:auto"><table class="hist-table"><thead><tr>'
                      '<th>Date</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Change</th><th>Volume</th>'
                      '</tr></thead><tbody id="histBody">' + ''.join(rows) + '</tbody></table></div></div>')
        trend_answer = ('The interactive chart above covers all %d tracked sessions for %s — hover any point for the day&rsquo;s open, high, low and volume. Use the '
                        '<a href="../screener">stock screener</a> to compare %s against '
                        'its sector peers.' % (n_hist, sym, sym))
    else:
        nochart.append(sym)
        d_open = d_high = d_low = d_prev = d_avgv = d_hit = d_lot = d_valtraded = '—'
        d_vol = volume
        d_wchg, d_wcls = w_chg, ('up' if w > 0 else ('down' if w < 0 else ''))
        n_hist, chart_ret, chart_rcls = 0, '', ''
        hist_json, hist_table, prange = '', '', ''
        trend_answer = ('Nairaview updates %s after each NGX trading day. Use the '
                        '<a href="../screener">stock screener</a> to compare %s against '
                        'its sector peers.' % (sym, sym))

    # key statistics panel (ngnmarket-style)
    kstats = (
        '<div class="kstats"><div class="kstats-title">Key statistics &middot; ' + esc(trade_date) + ' close</div>'
        '<div class="kstats-grid">'
        '<div class="kstat" data-stat="prevclose"><div class="k">Previous close</div><div class="v">' + d_prev + '</div></div>'
        '<div class="kstat" data-stat="open"><div class="k">Open</div><div class="v">' + d_open + '</div></div>'
        '<div class="kstat" data-stat="dayhigh"><div class="k">Day high</div><div class="v">' + d_high + '</div></div>'
        '<div class="kstat" data-stat="daylow"><div class="k">Day low</div><div class="v">' + d_low + '</div></div>'
        '<div class="kstat" data-stat="volume"><div class="k">Volume</div><div class="v">' + d_vol + '</div></div>'
        '<div class="kstat" data-stat="avgvol"><div class="k">Avg volume</div><div class="v">' + d_avgv + '</div></div>'
        '<div class="kstat"><div class="k">Value traded</div><div class="v">' + d_valtraded + '</div></div>'
        '<div class="kstat"><div class="k">Market cap</div><div class="v">' + mcap + '</div></div>'
        '<div class="kstat"><div class="k">Shares outstanding</div><div class="v">' + shares + '</div></div>'
        '<div class="kstat" data-stat="chg7d"><div class="k">7-day change</div><div class="v ' + d_wcls + '">' + esc(d_wchg) + '</div></div>'
        '<div class="kstat" data-stat="hitracked"><div class="k">High &middot; tracked</div><div class="v">' + d_hit + '</div></div>'
        '<div class="kstat" data-stat="lotracked"><div class="k">Low &middot; tracked</div><div class="v">' + d_lot + '</div></div>'
        '<div class="kstat"><div class="k">Sector</div><div class="v" style="font-size:15px">' + esc(sector) + '</div></div>'
        '</div></div>')
    # interactive chart mount + embedded history (live.js renders + refreshes from /api/history)
    if n_hist >= 2:
        chart_mount = (
            '<div class="pchart" id="pchartMount">'
            '<div class="pchart-head"><div class="pchart-title">Price history &middot; ' + str(n_hist) + ' sessions</div>'
            '<div class="pchart-ret ' + chart_rcls + '">' + esc(chart_ret) + '</div></div>'
            '<div class="pchart-pills"></div>'
            '<div class="pchart-wrap"></div>'
            '<div class="pc-note">Daily closes &middot; not intraday</div>'
            '</div>'
            '<script>window.NV_HIST=' + hist_json + ';</script>')
    else:
        chart_mount = ''
        hist_table = ''

    peers = [p for p in by_sector.get(sector, []) if p['symbol'] != sym][:6]
    peer_lis = '\n'.join(
        '          <li><a href="%s.html">%s &mdash; %s</a></li>' % (
            p['symbol'], esc(p['symbol']), esc(p.get('name') or p['symbol']))
        for p in peers)
    curated_lis = '\n'.join(
        '          <li><a href="%s" target="_blank" rel="noopener noreferrer">%s</a></li>' % (h, t)
        for h, t in CURATED.get(sym, []))

    og_title = '%s — %s | Nairaview' % (sym, name)
    og_desc = ('%s (%s) share price %s (%s) at the %s close. 7-day change %s, market cap %s. '
               'Daily-close NGX data on Nairaview.' % (sym, name, fmt_price(price), day_chg, trade_date, w_chg, mcap))
    title = '%s Share Price Today (%s) | Nairaview' % (sym, name)
    meta_desc = ('%s (%s) share price is %s (%s) as of the %s NGX close. 7-day change %s, '
                 'market cap %s, %s sector. Updated daily on Nairaview.' % (
                     sym, name, fmt_price(price), day_chg, trade_date, w_chg, mcap, sector))

    faq = [
        ('What is the current %s share price?' % sym,
         '%s (%s) last closed at %s (%s on the day) on %s.' % (name, sym, fmt_price(price), day_chg, trade_date)),
        ('What sector is %s in?' % sym,
         '%s is listed on the NGX %s under the %s sector.' % (sym, board, sector)),
        ('Where can I see %s\u2019s recent price trend?' % sym, trend_answer),
        ('Is %s a good investment?' % sym,
         'Nairaview provides market data, not investment advice. Speak to a licensed adviser before deciding.'),
    ]
    jsonld = json.dumps({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        'mainEntity': [{'question': {'@type': 'Question', 'name': q},
                        'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in faq],
    }, ensure_ascii=False, indent=2)

    vals = {'SYM': esc(sym), 'V': ASSET_V,
            'TRADE_DATE': trade_date, 'TRADE_DATE_UC': trade_date.upper(),
            'SECTOR': esc(sector), 'BOARD': esc(board), 'BADGE': badge(sym),
            'H1': '%s &mdash; %s' % (esc(sym), esc(name)),
            'PRICE': fmt_price(price),
            'DAY_CHG': esc(day_chg), 'CHG_CLASS': 'up' if cp > 0 else ('down' if cp < 0 else ''),
            'W_CHG': esc(w_chg), 'W_CLASS': 'up' if w > 0 else ('down' if w < 0 else ''),
            'VOLUME': volume, 'MCAP': mcap, 'SHARES': shares,
            'NAME': esc(name), 'PEERS': peer_lis, 'CURATED': curated_lis,
            'KSTATS': kstats, 'CHARTMOUNT': chart_mount, 'PRANGE': prange, 'HISTTABLE': hist_table,
            'TREND_ANSWER': trend_answer,
            'OG_TITLE': esc(og_title), 'OG_DESC': esc(og_desc),
            'TITLE': esc(title), 'META_DESC': esc(meta_desc), 'JSONLD': jsonld,
            'FOOTER': footer()}
    page = TEMPLATE
    for kk, vv in vals.items():
        page = page.replace('@@' + kk + '@@', vv)
    assert '@@' not in page, 'unreplaced placeholder in ' + sym
    with open(out, 'w') as fh:
        fh.write(page)
    made.append(sym)

print('generated:', len(made))
print('skipped (alias stubs):', skipped)
print('no chart data:', nochart)
