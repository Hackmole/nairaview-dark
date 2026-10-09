#!/usr/bin/env python3
"""Dividend page automation for nairaviewV2.

1. Generates the current month's dividend archive page
   (dividends-{month}-{year}.html) from the curated assets/dividends.json —
   declarations with a payment or qualification date in that month. Months
   that already have a hand-built page are left alone.
2. Scans /api/news for fresh dividend declarations and appends candidates
   to the review file (hidden_files/dividend-candidates.md). Candidates are
   NEVER auto-published to dividends.json — amounts and dates must be
   verified against NGX filings first.
3. Reports whether dividends.json changed since the last run so the caller
   can bump the ?v= cache version in the Dividends island.

Run standalone or from scripts/v2_refresh.py after the market pull.
"""
import hashlib
import html as htmlmod
import json
import os
import re
import sys
from datetime import datetime

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://nairaview-api.meetomidiora.workers.dev"
JSON_PATH = os.path.join(REPO, "assets", "dividends.json")
HIDDEN = os.path.expanduser("~/workspace/goals/nairaview-ngx-website-build/hidden_files")
CANDIDATES = os.path.join(HIDDEN, "dividend-candidates.md")
WATERMARK = os.path.join(HIDDEN, "dividends-json-hash.txt")

MONTHS = ["january", "february", "march", "april", "may", "june", "july",
          "august", "september", "october", "november", "december"]
MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def log(msg):
    print(f"[gen_dividends] {msg}", flush=True)


def get_json(path, timeout=30):
    try:
        import requests
        r = requests.get(API + path, headers={"User-Agent": "nairaview-dividends/1.0"},
                         timeout=timeout)
        r.raise_for_status()
        return r.json()
    except ImportError:
        import urllib.request
        req = urllib.request.Request(API + path,
                                     headers={"User-Agent": "nairaview-dividends/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)


def fmt_date(iso):
    if not iso:
        return "—"
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", iso)
    if not m:
        return iso
    return f"{int(m.group(3))} {MONTHS_SHORT[int(m.group(2)) - 1]} {m.group(1)}"


def money(n):
    return f"₦{n:,.2f}".replace("₦0.", "₦0.").rstrip("0").rstrip(".")


def page_chrome():
    """Split the October page into (head+header, footer) around <main>."""
    tpl = open(os.path.join(REPO, "dividends-october-2026.html"), encoding="utf-8").read()
    pre = tpl.split("<main>")[0]
    post = "</main>" + tpl.split("</main>", 1)[1]
    # neutralize October-specific head bits
    pre = re.sub(r"<title>.*?</title>",
                 "  <title>@@TITLE@@</title>", pre, flags=re.S)
    pre = re.sub(r'<meta name="description" content=".*?" />',
                 '  <meta name="description" content="@@DESC@@" />', pre)
    pre = re.sub(r'<link rel="canonical" href=".*?" />',
                 '  <link rel="canonical" href="@@CANON@@" />', pre)
    pre = re.sub(r'<meta property="og:title" content=".*?" />',
                 '  <meta property="og:title" content="@@TITLE@@" />', pre, count=1)
    pre = re.sub(r'<meta property="og:description" content=".*?" />',
                 '  <meta property="og:description" content="@@DESC@@" />', pre, count=1)
    return pre, post


def generate_month_page(divs, year, month):
    """Build dividends-{month}-{year}.html from JSON entries in that month."""
    mname = MONTHS[month - 1]
    fname = f"dividends-{mname}-{year}.html"
    fpath = os.path.join(REPO, fname)
    if os.path.exists(fpath):
        log(f"skip {fname}: page already exists (hand-built or generated)")
        return None

    def in_month(iso):
        return iso and iso.startswith(f"{year}-{month:02d}")

    rows = [d for d in divs
            if in_month(d.get("payment_date")) or in_month(d.get("qualification_date"))]
    rows.sort(key=lambda d: d.get("payment_date") or d.get("qualification_date") or "")

    n = len(rows)
    lede = (f"{n} confirmed NGX dividend{'s' if n != 1 else ''} with "
            f"{'a ' if n == 1 else ''}payment or qualification date in "
            f"{mname.capitalize()} {year}, from verified NGX disclosures.")
    if n == 0:
        lede = (f"No NGX dividends with a payment or qualification date in "
                f"{mname.capitalize()} {year} are in the verified list yet. "
                f"Declarations are added here as they are confirmed.")

    if rows:
        trs = "\n".join(
            "              <tr><td style=\"text-align:left\"><strong>{co}</strong><br>"
            "<span style=\"color:var(--muted)\">{tk}</span></td><td>{per}</td>"
            "<td class=\"num\">{amt}</td><td>{q}</td><td>{p}</td>"
            "<td style=\"text-align:left\">{src}</td></tr>".format(
                co=htmlmod.escape(d["company"]), tk=htmlmod.escape(d["ticker"]),
                per=htmlmod.escape(d.get("period") or "—"),
                amt=money(d["amount"]),
                q=fmt_date(d.get("qualification_date")),
                p=fmt_date(d.get("payment_date")),
                src=htmlmod.escape(d.get("source") or "—"))
            for d in rows)
        table = f"""            <div class="movers-col"><table class="movers-table">
              <thead><tr><th style="text-align:left">Company</th><th>Period</th><th>DPS</th><th>Qualifies</th><th>Paid</th><th style="text-align:left">Source</th></tr></thead>
              <tbody>
{trs}
              </tbody>
            </table></div>"""
    else:
        table = ('            <p class="guide-p">Nothing confirmed yet — check the '
                 '<a href="dividends">dividends hub</a> for upcoming payouts.</p>')

    canon = f"https://nairaview.com/{fname[:-5]}"
    title = f"NGX dividends in {mname.capitalize()} {year} | Nairaview"
    desc = (f"Every NGX dividend with a payment or qualification date in "
            f"{mname.capitalize()} {year}: amounts, qualification and payment dates.")

    main = f"""    <main>
      <section class="section">
        <div class="section-heading">
          <p class="kicker">DIVIDEND DATES &middot; {mname.upper()} {year}</p>
          <h1>NGX dividends in {mname.capitalize()} {year}</h1>
          <p class="lede">{lede}</p>
        </div>
        <h2 class="guide-h2">Declared dividends</h2>
{table}
        <h2 class="guide-h2">How to read this</h2>
        <p class="guide-p">Buy and hold through the <strong>qualification date</strong> to receive the payout; it lands on the <strong>payment date</strong>. Figures come from verified NGX corporate disclosures — the <a href="dividends">dividends hub</a> always has the latest list.</p>
        <div class="nextbox">
          <h3>Related</h3>
          <ul>
            <li><a href="dividends">Dividends hub &mdash; upcoming payouts and yield rankings</a></li>
            <li><a href="calendar">Market calendar &mdash; all upcoming dividend and corporate-action dates</a></li>
            <li><a href="learn-how-shares-work">Learn: how dividends work</a></li>
          </ul>
        </div>
        <p class="guide-p"><em>Sources: NGX corporate disclosures via Nigerian business press. Not investment advice.</em></p>
      </section>
"""
    pre, post = page_chrome()
    pre = pre.replace("@@TITLE@@", title).replace("@@DESC@@", desc).replace("@@CANON@@", canon)
    page = pre + main + post
    open(fpath, "w", encoding="utf-8").write(page)
    log(f"generated {fname} ({n} dividend rows)")

    # sitemap
    sm = os.path.join(REPO, "sitemap.xml")
    if os.path.exists(sm):
        s = open(sm).read()
        url = f"  <url><loc>{canon}</loc></url>"
        if canon not in s:
            s = s.replace("</urlset>", url + "\n</urlset>")
            open(sm, "w").write(s)
            log("sitemap updated")
    return fname


DIV_RE = re.compile(r"dividend", re.I)
AMT_RE = re.compile(r"₦[\d,\.]+|kobo|per share", re.I)
ACT_RE = re.compile(r"declar|approv|recommend|propos|announce|pay", re.I)


def scan_news_candidates():
    """Find fresh dividend declarations in /api/news; append to review file."""
    try:
        doc = get_json("/api/news")
    except Exception as e:
        log(f"news scan skipped: {e}")
        return 0
    items = doc.get("items") or []
    os.makedirs(HIDDEN, exist_ok=True)
    seen = set()
    if os.path.exists(CANDIDATES):
        # Links are stored as "- Link: https://..." (not line-leading), so match anywhere.
        seen = set(re.findall(r"https?://\S+", open(CANDIDATES).read()))
    new = 0
    lines = []
    for it in items:
        text = f"{it.get('title', '')} {it.get('description', '')}"
        link = it.get("link", "")
        pub = it.get("published_at", "")
        if isinstance(pub, str):
            pub_s = pub[:10]
        elif isinstance(pub, (int, float)):
            ts = pub / 1000 if pub > 1e12 else pub  # ms vs s timestamps
            pub_s = datetime.fromtimestamp(ts, datetime.now().astimezone().tzinfo).strftime("%Y-%m-%d")
        else:
            pub_s = ""
        if (DIV_RE.search(text) and AMT_RE.search(text) and ACT_RE.search(text)
                and link and link not in seen):
            lines.append(
                f"\n## {pub_s} — {it.get('title', '').strip()}\n"
                f"- Source: {it.get('source', '')}\n- Link: {link}\n"
                f"- Snippet: {it.get('description', '')[:300].strip()}\n"
                f"- Status: UNVERIFIED — confirm amount and dates against the NGX filing before adding to assets/dividends.json\n")
            seen.add(link)
            new += 1
    if lines:
        with open(CANDIDATES, "a", encoding="utf-8") as fh:
            if not os.path.exists(CANDIDATES) or os.path.getsize(CANDIDATES) == 0:
                fh.write("# Dividend declaration candidates\n\nCandidates spotted in market news. Verify each against the NGX filing before adding to assets/dividends.json.\n")
            fh.writelines(lines)
        log(f"{new} new dividend candidate(s) appended to review file")
    else:
        log("news scan: no new dividend candidates")
    return new


def json_changed():
    h = hashlib.sha256(open(JSON_PATH, "rb").read()).hexdigest()
    old = open(WATERMARK).read().strip() if os.path.exists(WATERMARK) else ""
    if h != old:
        os.makedirs(HIDDEN, exist_ok=True)
        open(WATERMARK, "w").write(h)
        return True
    return False


def main():
    doc = json.load(open(JSON_PATH, encoding="utf-8"))
    divs = doc.get("dividends", [])
    now = datetime.now()
    gen = generate_month_page(divs, now.year, now.month)
    scan_news_candidates()
    changed = json_changed()
    log(f"done: {len(divs)} dividends in JSON; page={'generated ' + gen if gen else 'skipped'}; json_changed={changed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
