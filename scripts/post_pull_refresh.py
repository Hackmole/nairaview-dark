#!/usr/bin/env python3
"""Post-pull static refresh for nairaview.com.

Runs after the weekday market pull (scheduled ~16:45 UTC). Refreshes every
hardcoded fallback (dates, prices, market wrap) so the site never shows a
stale trade date, then regenerates stock pages, bumps the asset cache
version if needed, commits, pushes, and verifies the production deploy.

Idempotent: if the trade date hasn't changed since the last run (failed
pull, holiday), it exits quietly after logging.
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone

REPO = os.path.expanduser("~/workspace/nairaview")
API = "https://nairaview-api.meetomidiora.workers.dev"
SITE = "https://nairaview.com"
HIDDEN = os.path.join(REPO, "..", "goals", "nairaview-ngx-website-build", "hidden_files")
WATERMARK = os.path.join(HIDDEN, "refresh-watermark.txt")
LOG = os.path.join(HIDDEN, "refresh.log")

WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
WEEKDAYS_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTHS_UP = [m.upper() for m in MONTHS]


def log(msg):
    line = f"{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')}Z {msg}"
    print(line, flush=True)
    os.makedirs(HIDDEN, exist_ok=True)
    with open(LOG, "a") as fh:
        fh.write(line + "\n")


def get_json(path, timeout=30):
    req = urllib.request.Request(API + path, headers={"User-Agent": "nairaview-refresh/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def run(cmd, **kw):
    return subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, timeout=kw.get("timeout", 120))


def fmt_naira_short(v):
    return f"\u20a6{v:,.2f}"


def main():
    # ---- 1. Fetch market data ----
    try:
        market = get_json("/api/market")["overview"]["data"]
        prices = get_json("/api/prices")["stocks"]["stocks"]
        asi_hist = get_json("/api/asi-history")
    except Exception as e:
        log(f"ABORT: could not fetch API data: {e}")
        return 1

    trade_date = market["trade_date"][:10]  # YYYY-MM-DD
    last_wm = open(WATERMARK).read().strip() if os.path.exists(WATERMARK) else ""
    if trade_date == last_wm:
        log(f"SKIP: trade date {trade_date} unchanged since last refresh")
        return 0

    dt = datetime.strptime(trade_date, "%Y-%m-%d")
    wd, wd_long = WEEKDAYS[dt.weekday()], WEEKDAYS_LONG[dt.weekday()]
    d, mon, mon_up, yyyy = dt.day, MONTHS[dt.month - 1], MONTHS_UP[dt.month - 1], dt.year

    asi = market["asi"]
    day_chg = market.get("pct_change") or 0.0
    adv, dec = market.get("advancers", 0), market.get("decliners", 0)
    mcap_tn = (market.get("market_cap") or 0) / 1e12
    ytd_base = (asi_hist.get("ytd_base") or {}).get("value") or 0
    ytd = (asi - ytd_base) / ytd_base * 100 if ytd_base else 0
    hist = asi_hist.get("history") or []
    # week change: first trading session of the trade date's week -> latest close
    wk_chg = 0.0
    if hist:
        yw = dt.isocalendar()[:2]
        week_pts = [p for p in hist
                    if datetime.strptime(p["date"][:10], "%Y-%m-%d").isocalendar()[:2] == yw]
        if len(week_pts) >= 2:
            wk_chg = (week_pts[-1]["value"] - week_pts[0]["value"]) / week_pts[0]["value"] * 100
        elif len(hist) >= 6:
            wk_chg = (hist[-1]["value"] - hist[-6]["value"]) / hist[-6]["value"] * 100

    pmap = {s["symbol"]: s for s in prices}
    gainers = sorted([s for s in prices if (s.get("pct_change") or 0) > 0],
                     key=lambda s: s["pct_change"], reverse=True)
    g1 = gainers[0]["symbol"] if len(gainers) > 0 else ""
    g2 = gainers[1]["symbol"] if len(gainers) > 1 else ""

    log(f"refreshing to trade date {trade_date} (ASI {asi:,.2f}, day {day_chg:+.2f}%, week {wk_chg:+.2f}%)")

    # ---- 2. Date labels across root HTML (site chrome only) ----
    topline_re = re.compile(r"DAILY CLOSE (?:\u00b7|&middot;) [A-Z]{3} \d{1,2} [A-Z]{3} \d{4} (?:\u00b7|&middot;) WAT")
    topline_new = f"DAILY CLOSE \u00b7 {wd} {d} {mon_up} {yyyy} \u00b7 WAT"
    modal_re = re.compile(r"Snapshot (?:\u00b7|&middot;) \d{1,2} [A-Z][a-z]{2} \d{4}")
    modal_new = f"Snapshot \u00b7 {d} {mon} {yyyy}"

    changed_files = set()
    for root, _dirs, files in os.walk(REPO):
        if "stocks" in root.split(os.sep):
            continue  # stock pages regenerated separately
        for fn in files:
            if not fn.endswith(".html"):
                continue
            # dated articles keep their historical dates
            if fn.startswith("ngx-weekly-recap-") or fn.startswith("ngx-market-"):
                continue
            p = os.path.join(root, fn)
            s = open(p, encoding="utf-8").read()
            s2 = topline_re.sub(topline_new, s)
            # only modal eyebrows (id="modalList"), not article content
            s2 = re.sub(r'(id="modalList">)' + modal_re.pattern, r"\1" + modal_new, s2)
            if s2 != s:
                open(p, "w", encoding="utf-8").write(s2)
                changed_files.add(os.path.relpath(p, REPO))

    # ---- 3. index.html hero / chart / heatmap / market wrap ----
    idx = os.path.join(REPO, "index.html")
    s = open(idx, encoding="utf-8").read()

    s = re.sub(r'(<h1 id="market-heading">)[\d,\.]+(</h1>)', rf"\g<1>{asi:,.2f}\g<2>", s)
    s = re.sub(r'(<div class="chart-value" id="chartValue">)[\d,\.]+(</div>)', rf"\g<1>{asi:,.2f}\g<2>", s)
    s = re.sub(r'(<div class="chart-change" id="chartChange">)[^<]*(</div>)',
               rf"\g<1>+{ytd:.2f}% since 31 Dec 2025\g<2>", s)
    s = re.sub(r'(<p class="hero-meta" id="heroNote">)As of the \d{1,2} [A-Z][a-z]{2} \d{4} close(</p>)',
               rf"\g<1>As of the {d} {mon} {yyyy} close\g<2>", s)
    s = re.sub(r'(<span id="periodLabel">)31 Dec 2025 \u2014 \d{1,2} [A-Z][a-z]{2} \d{4}(</span>)',
               rf"\g<1>31 Dec 2025 — {d} {mon} {yyyy}\g<2>", s)
    s = re.sub(r'(<span class="noteDate">)\d{1,2} [A-Z][a-z]{2} \d{4}(</span>)',
               rf"\g<1>{d} {mon} {yyyy}\g<2>", s)

    # market wrap (templated from data)
    s = re.sub(r'(<div class="date" id="wrapDate">)MARKET WRAP \u00b7 \d{1,2} [A-Z]{3}(</div>)',
               rf"\g<1>MARKET WRAP · {d} {mon_up}\g<2>", s)
    w_word = "rises" if wk_chg >= 0 else "slips"
    h3 = (f"ASI {w_word} {abs(wk_chg):.2f}% on the week to {asi:,.2f}; "
          f"market cap \u20a6{mcap_tn:.2f}tn")
    if abs(day_chg) < 0.1:
        day_word = "closed nearly flat"
    elif day_chg > 0:
        day_word = "closed higher"
    else:
        day_word = "closed lower"
    lead = f" {g1} and {g2} led the gainers." if g1 and g2 else ""
    body = (f"{wd_long} {day_word} at {day_chg:+.2f}% with {adv} advancers against "
            f"{dec} decliners.{lead}")
    s = re.sub(r'(<div class="date" id="wrapDate">.*?</div>\s*<h3>).*?(</h3>)',
               lambda m: m.group(1) + h3 + m.group(2), s, flags=re.S)
    s = re.sub(r'(<div class="date" id="wrapDate">.*?</h3>\s*<p>).*?(</p>)',
               lambda m: m.group(1) + body + m.group(2), s, flags=re.S)
    # CTA -> latest weekly recap, else market recap page
    recaps = sorted([f for f in os.listdir(REPO)
                     if f.startswith("ngx-weekly-recap-") and f.endswith(".html")],
                    reverse=True)
    cta_href = recaps[0][:-5] if recaps else "market-recap"
    cta_text = "Read the weekly recap" if recaps else "See the market recap"
    s = re.sub(r'(<a class="btn-gold wrap-cta" href=")[^"]*(">).*?(</a>)',
               lambda m: m.group(1) + cta_href + m.group(2) + cta_text + ' <span aria-hidden="true">&rarr;</span>' + m.group(3),
               s, flags=re.S)
    open(idx, "w", encoding="utf-8").write(s)
    changed_files.add("index.html")

    # ---- 4. sector-banking.html prices ----
    sb = os.path.join(REPO, "sector-banking.html")
    if os.path.exists(sb):
        s = open(sb, encoding="utf-8").read()
        banks = {"GTCO": None, "ZENITHBANK": None, "FIRSTHOLDCO": None, "UBA": None,
                 "ACCESSCORP": None, "STANBIC": None}
        for sym in banks:
            if sym in pmap and pmap[sym].get("current_price"):
                banks[sym] = pmap[sym]["current_price"]
        s = re.sub(r"(<em>Figures as of the )\d{1,2} [A-Z][a-z]{2} \d{4}( close\.)",
                   rf"\g<1>{d} {mon} {yyyy}\g<2>", s)
        for sym, price in banks.items():
            if price:
                s = re.sub(r"(\b" + sym + r"\b[^<\n]{0,80}?)₦[\d,\.]+",
                           rf"\g<1>₦{price:,.2f}", s)
        open(sb, "w", encoding="utf-8").write(s)
        changed_files.add("sector-banking.html")

    # ---- 5. portfolio.html snapshot prices ----
    pf = os.path.join(REPO, "portfolio.html")
    if os.path.exists(pf):
        s = open(pf, encoding="utf-8").read()
        s = re.sub(r"Nairaview&rsquo;s \d{1,2} [A-Z][a-z]{2} \d{4} snapshot prices",
                   f"Nairaview&rsquo;s {d} {mon} {yyyy} snapshot prices", s)
        m = re.search(r"var PRICES = \{([^}]*)\};", s)
        if m:
            parts = []
            for sym, price in [("DANGCEM", None), ("SEPLAT", None), ("GTCO", None),
                               ("ZENITHBANK", None), ("FIRSTHOLDCO", None), ("UBA", None),
                               ("ACCESSCORP", None), ("STANBIC", None), ("TRANSCORP", None),
                               ("NESTLE", None), ("NB", None)]:
                old = re.search(sym + r": ([\d\.]+)", m.group(1))
                new_price = pmap.get(sym, {}).get("current_price") or (float(old.group(1)) if old else 0)
                parts.append(f"{sym}: {new_price}")
            s = s.replace(m.group(0), "var PRICES = { " + ", ".join(parts) + " };")
            s = s.replace(f"// Snapshot prices, {d} {mon} {yyyy} close",
                          f"// Snapshot prices, {d} {mon} {yyyy} close")
            s = re.sub(r"// Snapshot prices, \d{1,2} [A-Z][a-z]{2} \d{4} close \(verified research\)\.",
                       f"// Snapshot prices, {d} {mon} {yyyy} close (verified research).", s)
        open(pf, "w", encoding="utf-8").write(s)
        changed_files.add("portfolio.html")

    # ---- 6. Regenerate stock pages ----
    log("regenerating stock pages...")
    r = run([sys.executable, "scripts/gen_stock_pages.py"], timeout=600)
    log("generator: " + (r.stdout.strip().splitlines()[-1] if r.stdout.strip() else "no output"))
    if r.returncode != 0:
        log(f"ABORT: generator failed: {r.stderr[:300]}")
        return 1

    # ---- 7. Cache version bump (only if an asset changed) ----
    r = run(["git", "status", "--porcelain", "assets/"])
    new_v = None
    if r.stdout.strip():
        today = datetime.now(timezone.utc).strftime("%Y%m%d")
        existing = set(re.findall(r"\?v=" + today + r"([a-z])", run(["git", "grep", "-h", "?v=", "--", "*.html"]).stdout or ""))
        letter = chr(ord("a") + len(existing)) if len(existing) < 26 else "z"
        new_v = today + letter
        files = run(["git", "status", "--porcelain"]).stdout.splitlines()
        html_files = [l[3:] for l in files if l.strip().endswith(".html")]
        for f in html_files:
            p = os.path.join(REPO, f)
            if os.path.exists(p):
                s = open(p, encoding="utf-8").read()
                s2 = re.sub(r"\?v=\d{8}[a-z]", f"?v={new_v}", s)
                if s2 != s:
                    open(p, "w", encoding="utf-8").write(s2)
        log(f"asset version bumped to {new_v}")

    # ---- 8. Commit + push ----
    r = run(["git", "add", "-A"])
    r = run(["git", "status", "--porcelain"])
    if not r.stdout.strip():
        log("nothing changed after refresh; skipping commit")
    else:
        n = len(r.stdout.strip().splitlines())
        r = run(["git", "commit", "-m",
                 f"auto: post-pull refresh to {trade_date} close ({n} files)"])
        log("committed: " + r.stdout.strip().splitlines()[0] if r.stdout.strip() else "commit done")
        r = run(["git", "push", "origin", "main"], timeout=180)
        if r.returncode != 0:
            log(f"ABORT: push failed: {r.stderr[:300]}")
            return 1
        log("pushed to main")

        # ---- 9. Verify production picked it up ----
        deadline = time.time() + 240
        ok = False
        while time.time() < deadline:
            time.sleep(20)
            try:
                req = urllib.request.Request(SITE + "/", headers={"User-Agent": "nairaview-refresh/1.0"})
                html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
                if f"{d} {mon_up} {yyyy}" in html and (new_v is None or f"?v={new_v}" in html):
                    ok = True
                    break
            except Exception as e:
                log(f"verify probe failed: {e}")
        log("production verified" if ok else "WARNING: production did not show new content within 4 min")

    with open(WATERMARK, "w") as fh:
        fh.write(trade_date)
    log(f"done: refreshed to {trade_date}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
