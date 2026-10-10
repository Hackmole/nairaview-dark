#!/usr/bin/env python3
"""Generate a weekly NGX market recap edition from the Nairaview API.

Usage: gen_recap.py [--date YYYY-MM-DD]
  --date: the Friday the week ends on (default: most recent Friday).

Idempotent: exits quietly if the edition already exists. Only publishes
numbers computable from the API (ASI history, Friday prices/breadth,
sector averages) -- never invented narratives.

Run Saturdays ~08:00 WAT via the nairaview-weekly-recap cron.
"""
import argparse
import datetime as dt
import html
import json
import re
import sys
import urllib.request

API = "https://nairaview-api.meetomidiora.workers.dev"
SITE = "https://nairaview.com"
REPO = "/home/hatch/workspace/nairaview"

MONTHS = ["jan", "feb", "mar", "apr", "may", "jun",
          "jul", "aug", "sep", "oct", "nov", "dec"]


def get(path, tries=3):
    import subprocess
    import time
    last = None
    for _ in range(tries):
        try:
            out = subprocess.run(
                ["curl", "-s", "-m", "40", "-A", "nairaview-recap/1.0", API + path],
                capture_output=True, timeout=60, check=True)
            return json.loads(out.stdout.decode("utf-8"))
        except Exception as e:  # flaky large payloads: retry
            last = e
            time.sleep(2)
    raise last


def fmt_num(x, dec=2):
    return "{:,.{}f}".format(x, dec)


def fmt_pct(x):
    sign = "+" if x >= 0 else "\u2212"
    return "{}{:.2f}%".format(sign, abs(x))


def fmt_naira_short(x):
    if x >= 1e12:
        return "\u20a6{:.2f}tn".format(x / 1e12)
    if x >= 1e9:
        return "\u20a6{:.1f}bn".format(x / 1e9)
    return "\u20a6{:,.0f}".format(x)


def fri_label(d):
    return "{} {} {}".format(d.day, MONTHS[d.month - 1].upper(), d.year)


def asset_versions():
    s = open(REPO + "/index.html", encoding="utf-8").read()
    out = {}
    for name in ("styles.css", "site.js", "data.js", "live.js"):
        m = re.search(re.escape(name) + r"\?v=([^\"']+)", s)
        out[name] = m.group(1) if m else "1"
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=None)
    args = ap.parse_args()

    today = dt.date.today()
    if args.date:
        friday = dt.date.fromisoformat(args.date)
    else:
        # most recent Friday (today if today is Friday)
        friday = today - dt.timedelta(days=(today.weekday() - 4) % 7)
    saturday = friday + dt.timedelta(days=1)
    slug = "ngx-weekly-recap-{:02d}-{}-{}".format(
        friday.day, MONTHS[friday.month - 1], friday.year)
    path = REPO + "/" + slug + ".html"
    if __import__("os").path.exists(path):
        print("exists, skipping:", slug)
        return 0

    # ---- data ----
    asi = get("/api/asi-history")["history"]
    week = [p for p in asi
            if friday - dt.timedelta(days=7) < dt.date.fromisoformat(p["date"]) <= friday]
    if len(week) < 3:
        print("not enough sessions for week ending", friday, "-- aborting")
        return 1
    week.sort(key=lambda p: p["date"])
    o, c = week[0]["value"], week[-1]["value"]
    chg, pct = c - o, (100.0 * (c - o) / o) if o else 0.0

    day_moves = []
    for i in range(1, len(week)):
        pv, cv = week[i - 1]["value"], week[i]["value"]
        day_moves.append((week[i]["date"], 100.0 * (cv - pv) / pv if pv else 0.0))
    best_day = max(day_moves, key=lambda x: x[1])
    worst_day = min(day_moves, key=lambda x: x[1])

    market = get("/api/market")
    ov = market["overview"]["data"]
    prices = get("/api/prices")["stocks"]["stocks"]

    # Guard: the movers/sector tables describe the *latest* session in /api/prices.
    # Only publish when that session is the requested Friday (true for Saturday runs).
    latest_td = max((s.get("trade_date") or "")[:10] for s in prices)
    if latest_td != friday.isoformat():
        print("prices are for {}, not the requested Friday {} -- aborting".format(
            latest_td, friday.isoformat()))
        return 1

    movers = [s for s in prices if s.get("change_percent") is not None]
    gainers = sorted(movers, key=lambda s: s["change_percent"], reverse=True)[:5]
    losers = sorted(movers, key=lambda s: s["change_percent"])[:5]

    sectors = {}
    for s in prices:
        cp = s.get("change_percent")
        if cp is None:
            continue
        sectors.setdefault(s.get("sector") or "Other", []).append(cp)
    sec_avg = sorted(((k, sum(v) / len(v), len(v)) for k, v in sectors.items()
                      if len(v) >= 3), key=lambda x: x[1])
    best_sec, worst_sec = sec_avg[-1], sec_avg[0]

    # ---- copy ----
    direction = "up" if pct > 0.049 else ("down" if pct < -0.049 else "flat")
    mag = "{:.2f}%".format(abs(pct))
    h1 = ("ASI {} {} on the week to {}".format(direction, mag, fmt_num(c))
          if direction != "flat" else "ASI flat on the week at {}".format(fmt_num(c)))
    tldr = ("The NGX All-Share Index closed the week at <strong>{}</strong>, "
            "{} <strong>{}</strong> from {} a week earlier. "
            "{} stocks advanced on the final session, {} declined, and {} were unchanged.".format(
                fmt_num(c), direction, mag, fmt_num(o),
                ov.get("advancers", "?"), ov.get("decliners", "?"), ov.get("unchanged", "?")))

    def mover_row(s):
        cls = "up" if s["change_percent"] >= 0 else "down"
        return ('<tr><td>{} ({})</td><td class="num {}">\u20a6{:,.2f} &middot; {}</td></tr>'.format(
            html.escape(s["name"].replace(" Plc", "")), s["symbol"], cls,
            s["current_price"], fmt_pct(s["change_percent"])))

    summary_items = [
        "<strong>ASI:</strong> {} on {}, {} on the week (from {} on {}).".format(
            fmt_num(c), fri_label(friday), fmt_pct(pct), fmt_num(o),
            fri_label(dt.date.fromisoformat(week[0]["date"]))),
        "<strong>Best session:</strong> {} ({}); <strong>weakest:</strong> {} ({}).".format(
            fri_label(dt.date.fromisoformat(best_day[0])), fmt_pct(best_day[1]),
            fri_label(dt.date.fromisoformat(worst_day[0])), fmt_pct(worst_day[1])),
        "<strong>Friday breadth:</strong> {} advancers, {} decliners, {} unchanged.".format(
            ov.get("advancers", "?"), ov.get("decliners", "?"), ov.get("unchanged", "?")),
    ]
    if ov.get("market_cap"):
        summary_items.append("<strong>Market cap:</strong> {} at the Friday close.".format(
            fmt_naira_short(ov["market_cap"])))
    if ov.get("volume"):
        summary_items.append("<strong>Volume:</strong> {:,.0f} shares changed hands on Friday.".format(
            ov["volume"]))

    sector_items = [
        "<strong>Strongest sector on Friday:</strong> {} (average {} across {} stocks).".format(
            html.escape(best_sec[0].title()), fmt_pct(best_sec[1]), best_sec[2]),
        "<strong>Weakest sector on Friday:</strong> {} (average {} across {} stocks).".format(
            html.escape(worst_sec[0].title()), fmt_pct(worst_sec[1]), worst_sec[2]),
        "<p class=\"guide-p\"><em>Sector averages are computed from Friday's day-change across all listed stocks with data. See the <a href=\"screener\">screener</a> for the full picture.</em></p>",
    ]

    quick = [
        "ASI {} on the week to {}; Friday breadth {} up / {} down.".format(
            fmt_pct(pct), fmt_num(c), ov.get("advancers", "?"), ov.get("decliners", "?")),
        "{} ({}) topped Friday's gainers; {} ({}) led losers.".format(
            gainers[0]["symbol"], fmt_pct(gainers[0]["change_percent"]),
            losers[0]["symbol"], fmt_pct(losers[0]["change_percent"])),
        "Watch next week on the <a href=\"calendar\">market calendar</a> for dividends, listings and corporate actions.",
    ]

    v = asset_versions()
    pub = saturday.isoformat()
    title = "NGX Weekly Recap: ASI {} (W/E {}) | Nairaview".format(fmt_pct(pct), fri_label(friday))
    desc = ("NGX weekly recap for the week ended {}: ASI {} to {}, "
            "top gainers and losers, sector watch and the week ahead.".format(
                fri_label(friday), direction, fmt_num(c)))

    page = """<!doctype html>
<html lang="en">
<head>
<script>try{{var t=localStorage.getItem("nv-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t);}}catch(e){{}}</script>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="color-scheme" content="light dark" />
  <meta name="theme-color" content="#022126" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Nairaview" />
<meta property="og:title" content="{title}" />
<meta property="og:description" content="{desc}" />
<meta property="og:url" content="{site}/{slug}" />
<meta property="og:image" content="{site}/assets/og-default.png" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="{title}" />
<meta name="twitter:description" content="{desc}" />
<meta name="twitter:image" content="{site}/assets/og-default.png" />
<link rel="canonical" href="{site}/{slug}" />
  <meta name="description" content="{desc}" />
  <link rel="icon" href="assets/logo-icon.svg" type="image/svg+xml">
  <link rel="icon" href="assets/favicon-32.png" sizes="32x32" type="image/png">
  <link rel="apple-touch-icon" href="assets/apple-touch-icon.png">
  <title>{title}</title>
<script type="application/ld+json">
{{
  "@context": "https://schema.org",
  "@type": "NewsArticle",
  "headline": "{h1}",
  "description": "{desc}",
  "datePublished": "{pub}",
  "author": {{"@type": "Organization", "name": "Nairaview"}},
  "publisher": {{"@type": "Organization", "name": "Nairaview"}},
  "mainEntityOfPage": "{site}/{slug}"
}}
</script>
  <link rel="stylesheet" href="assets/styles.css?v={css}" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Newsreader:opsz,wght@6..72,500;6..72,650&family=Public+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  </head>
<body>
  <header class="site-header">
    <div class="header-inner">
      <a class="brand" href="./" aria-label="Nairaview home"><picture><source srcset="assets/logo-dark.svg" media="(prefers-color-scheme: dark)"><img src="assets/logo.svg" alt="Nairaview" height="34"></picture></a>
      <nav class="site-nav" aria-label="Primary">
          <a href="./">Home</a>
          <a href="stocks">Stocks</a>
          <a href="screener">Screener</a>
          <a href="offers">Offers</a>
          <a href="calendar">Calendar</a>
          <a href="news">News</a>
          <a href="learn">Learn</a>
          <a href="market-recap" class="active">Recap</a>
      </nav>
    </div>
  </header>
  <div class="shell">
    <div class="live-ticker" role="region" aria-label="Live NGX price ticker">
          <iframe src="https://ngnmarket.com/widget/marquee" width="100%" height="60" frameborder="0" scrolling="no" style="border:none;" title="Live NGX market ticker"></iframe>
        </div>
    <div class="topline">
          <span class="status"><i class="status-dot" aria-hidden="true"></i> MARKET CLOSED</span>
          <span class="topline-date">DAILY CLOSE &middot; {frilabel} &middot; WAT</span>
        </div>
    <main>
      <section class="section">
        <div class="section-heading">
          <p class="kicker">WEEKLY RECAP &middot; WEEK ENDED {satlabel}</p>
          <h1>{h1}</h1>
          <div class="tldr">
            <span class="tldr-label">In short</span>
            <p>{tldr}</p>
          </div>
        </div>
        <h2 class="guide-h2">Market summary</h2>
        <ul class="guide-list">
          {summary}
        </ul>
        <div class="ad-slot ad-leaderboard" aria-hidden="true">
          <div class="ad-label">Advertisement</div>
          <script>
  atOptions = {{
    'key' : '66835af5f63b0f5a7059b9333d8d655e',
    'format' : 'iframe',
    'height' : 90,
    'width' : 728,
    'params' : {{}}
  }};
</script>
<script src="https://www.highrevenueformat.com/66835af5f63b0f5a7059b9333d8d655e/invoke.js"></script>
        </div>
        <h2 class="guide-h2">Top movers of the week&rsquo;s final session ({frilabel})</h2>
        <div class="movers-duo">
          <div class="movers-col">
            <h3>Top gainers</h3>
            <table class="movers-table">
              {gainers}
            </table>
          </div>
          <div class="movers-col">
            <h3>Top losers</h3>
            <table class="movers-table">
              {losers}
            </table>
          </div>
        </div>
        <p class="guide-p"><em>Session figures for {frilabel}. See the <a href="screener">screener</a> for the full mover tables.</em></p>
        <h2 class="guide-h2">Sector watch</h2>
        <ul class="guide-list">
          {sectors}
        </ul>
        <h2 class="guide-h2">Corporate actions</h2>
        <p class="guide-p">Dividends, listings, delistings and offers due in the coming sessions are tracked on our <a href="calendar">market calendar</a> &mdash; check qualification dates before acting.</p>
        <h2 class="guide-h2">Quick summary</h2>
        <ul class="guide-list">
          {quick}
        </ul>
        <p class="guide-p">Figures compiled from NGX session data for the week ended {satlabel}. Not investment advice. <a href="market-recap">All weekly recaps &rarr;</a></p>
      </section>
    </main>
    <footer class="footer"><strong>Data fixed at market close &middot; {frilabel}</strong><span>Prices may have changed. Confirm before acting.</span></footer>
  </div>
  <div class="modal-backdrop" id="modalBackdrop" hidden>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalSymbol">
      <button class="modal-close" id="modalClose" aria-label="Close stock details">&times;</button>
      <div class="modal-eyebrow" id="modalEyebrow">Snapshot</div>
      <div class="modal-symbol" id="modalSymbol"></div>
      <div class="modal-company" id="modalCompany"></div>
      <div class="modal-grid">
        <div class="modal-cell"><span>Price</span><strong id="modalPrice"></strong></div>
        <div class="modal-cell"><span id="modalMoveLabel">Day change</span><strong id="modalMove"></strong></div>
      </div>
      <p class="modal-note" id="modalNote">Figures are snapshots, not live prices. <a href="https://ngxgroup.com/" target="_blank" rel="noopener noreferrer">Check official NGX data &#8599;</a></p>
      <a class="modal-live" id="modalLive" href="#" target="_blank" rel="noopener noreferrer">Live chart &amp; full quote &#8599;</a>
      <a class="modal-live" id="modalPage" href="#" hidden>Full stock page on Nairaview &rarr;</a>
      <button class="modal-star" id="modalStar" type="button"></button>
    </div>
  </div>
  <div class="ad-slot ad-sticky-mobile" id="adSticky" aria-hidden="true">
    <button class="ad-close" id="adStickyClose" type="button" aria-label="Close advertisement">&times;</button>
    <div class="ad-label">Advertisement</div>
<script>
  atOptions = {{
    'key' : '2c91ae62a5b6daf76d6821ebc779a810',
    'format' : 'iframe',
    'height' : 50,
    'width' : 320,
    'params' : {{}}
  }};
</script>
<script src="https://www.highrevenueformat.com/2c91ae62a5b6daf76d6821ebc779a810/invoke.js"></script>
  </div>
  <script src="assets/data.js?v={datajs}"></script>
  <script src="assets/logos.js"></script>
  <script src="assets/stock-pages.js"></script>
  <script src="assets/site.js?v={sitejs}"></script>
  <script src="assets/live.js?v={livejs}"></script>
    <!-- Cloudflare Web Analytics --><script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{{"token": "a9f4136dd40547a7b1acca41e62cc7a5"}}'></script><!-- End Cloudflare Web Analytics -->
</body>
</html>
""".format(
        title=html.escape(title), desc=html.escape(desc), site=SITE, slug=slug,
        h1=html.escape(h1), pub=pub,
        css=v["styles.css"], datajs=v["data.js"], sitejs=v["site.js"], livejs=v["live.js"],
        frilabel=fri_label(friday), satlabel=fri_label(saturday),
        tldr=tldr,
        summary="\n          ".join("<li>" + x + "</li>" for x in summary_items),
        gainers="\n              ".join(mover_row(s) for s in gainers),
        losers="\n              ".join(mover_row(s) for s in losers),
        sectors="\n          ".join(("<li>" + x + "</li>") if x.startswith("<strong>")
                                 else x for x in sector_items),
        quick="\n          ".join("<li>" + x + "</li>" for x in quick),
    )

    with open(path, "w", encoding="utf-8") as f:
        f.write(page)

    # hub: prepend edition card
    hub = REPO + "/market-recap.html"
    hs = open(hub, encoding="utf-8").read()
    card = ('<a class="news-card" href="{slug}">\n'
            '                  <div class="news-meta"><span>NAIRAVIEW</span><span>{sat}</span>'
            '<span class="news-sector">Weekly recap</span></div>\n'
            '                  <h3>{h1}</h3>\n'
            '                  <p>Week ended {sat}: ASI {direction} {mag} to {close}; '
            'top gainers and losers, sector watch and the week ahead.</p>\n'
            '                </a>\n                ').format(
                slug=slug, sat=fri_label(saturday), h1=html.escape(h1),
                direction=direction, mag=mag, close=fmt_num(c))
    hs = hs.replace("<!-- EDITIONS -->", "<!-- EDITIONS -->\n                " + card, 1)
    open(hub, "w", encoding="utf-8").write(hs)

    # sitemap
    sm = REPO + "/sitemap.xml"
    ss = open(sm, encoding="utf-8").read()
    ss = ss.replace("</urlset>",
                    '  <url><loc>{}/{}</loc><priority>0.8</priority></url>\n</urlset>'.format(SITE, slug), 1)
    open(sm, "w", encoding="utf-8").write(ss)

    print("wrote", slug + ".html")
    return 0


if __name__ == "__main__":
    sys.exit(main())
