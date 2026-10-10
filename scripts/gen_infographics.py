#!/usr/bin/env python3
"""Nairaview market infographic engine.

Fetches /api/prices and /api/market, renders a square (1080x1080) and a wide
(1200x675) "NGX Market Snapshot" PNG for X (@Naira_view) and WhatsApp sharing.

Safety: if fewer than 50 tickers resolve (and --test is not given), prints
"insufficient data, skipping" and exits 0 writing nothing.

Usage:
    python3 gen_infographics.py            # live data
    python3 gen_infographics.py --test     # embedded sample data
"""

import copy
import json
import os
import shutil
import sys
import urllib.request
from datetime import datetime

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

API = "https://nairaview-api.meetomidiora.workers.dev"
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "..", "assets", "img", "infographics")

GREEN = "#77FC49"
GOLD = "#c9a227"
UP = "#77FC49"
DOWN = "#f87171"
MUTED = "#9db3a4"
WHITE = "#ffffff"

plt.rcParams["font.family"] = "DejaVu Sans"


# ---------------------------------------------------------------- data

def fetch_json(path, tries=3):
    """Fetch via curl (urllib intermittently hits truncated reads on this API)."""
    import subprocess
    import time
    last = None
    for i in range(tries):
        try:
            out = subprocess.run(
                ["curl", "-s", "--max-time", "40", "-H",
                 "User-Agent: nairaview-infographics/1.0", API + path],
                capture_output=True, timeout=60)
            if out.returncode != 0 or not out.stdout:
                raise RuntimeError(f"curl rc={out.returncode}")
            return json.loads(out.stdout.decode("utf-8"))
        except Exception as e:
            last = e
            if i < tries - 1:
                time.sleep(5 * (i + 1))
    raise last


def unwrap_stocks(payload):
    s = payload.get("stocks", payload) if isinstance(payload, dict) else payload
    while isinstance(s, dict) and "stocks" in s:
        s = s["stocks"]
    return s if isinstance(s, list) else []


def change_of(t):
    c = t.get("official_change_percent")
    return c if c is not None else t.get("change_percent")


SAMPLE = {
    "overview": {
        "asi": 252007.72, "pct_change": -0.22,
        "advancers": 25, "decliners": 31, "unchanged": 6,
        "trade_date": "2026-09-29T00:00:00", "market_status": "open",
    },
    "tickers": [
        {"symbol": "NPFMCRFBK", "current_price": 4.40, "official_change_percent": 10.0},
        {"symbol": "LIVINGTRUST", "current_price": 2.86, "official_change_percent": 10.0},
        {"symbol": "ZICHIS", "current_price": 21.09, "official_change_percent": 9.96},
        {"symbol": "CUTIX", "current_price": 3.95, "official_change_percent": 9.72},
        {"symbol": "RTBRISCOE", "current_price": 2.10, "official_change_percent": 9.38},
        {"symbol": "AIRTELAFRI", "current_price": 6300, "official_change_percent": 0.0},
        {"symbol": "MTNN", "current_price": 863, "official_change_percent": 0.0},
        {"symbol": "DANGCEM", "current_price": 512.5, "official_change_percent": -1.44},
        {"symbol": "GTCO", "current_price": 58.2, "official_change_percent": -2.10},
        {"symbol": "SEPLAT", "current_price": 4120, "official_change_percent": -3.85},
        {"symbol": "ACCESSCORP", "current_price": 24.75, "official_change_percent": -5.20},
        {"symbol": "TRANSCORP", "current_price": 12.30, "official_change_percent": -6.11},
        {"symbol": "FIDELITYBK", "current_price": 9.85, "official_change_percent": -7.94},
        {"symbol": "UBA", "current_price": 31.40, "official_change_percent": -9.77},
    ],
}


# ---------------------------------------------------------------- format helpers

def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def spaced(s):
    return " ".join(s)  # hair spaces for letterspaced kickers


def fmt_price(p):
    if p is None:
        return "—"
    if abs(p) >= 100:
        return "₦" + f"{p:,.0f}"
    return "₦" + f"{p:,.2f}"


def fmt_pct(v):
    if v is None:
        return "—"
    return ("+" if v >= 0 else "") + f"{v:.2f}%"


def fmt_date(iso):
    try:
        d = datetime.fromisoformat(iso)
    except Exception:
        return iso or "", "", ""
    return (d.strftime("%A, %d %B %Y"), d.strftime("%d %b %Y"),
            d.strftime("%Y%m%d"))


# ---------------------------------------------------------------- canvas

def new_canvas(w, h):
    fig = plt.figure(figsize=(w / 100.0, h / 100.0), dpi=100)
    # vertical gradient background: deep green -> near black-green
    top, bot = np.array(hex_to_rgb("#0d4229")), np.array(hex_to_rgb("#03130b"))
    t = np.linspace(0, 1, h)[:, None, None]
    img = top[None, None, :] * (1 - t) + bot[None, None, :] * t
    img = np.repeat(img, w, axis=1)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.imshow(img, extent=[0, 1, 0, 1], aspect="auto", zorder=0)
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")
    # gold top accent bar
    ax.plot([0, 1], [0.996, 0.996], color=GOLD, lw=7, transform=ax.transAxes,
            clip_on=False, zorder=3, solid_capstyle="butt")
    return fig, ax


def kicker(ax, x, y, text, size, ha="center", color=GOLD):
    ax.text(x, y, spaced(text.upper()), ha=ha, va="center", fontsize=size,
            fontweight="bold", color=color, transform=ax.transAxes, zorder=4)


def label(ax, x, y, text, size, ha="center", color=MUTED, weight="normal"):
    ax.text(x, y, text, ha=ha, va="center", fontsize=size, fontweight=weight,
            color=color, transform=ax.transAxes, zorder=4)


def hline(ax, y, x0=0.07, x1=0.93, color=GOLD, alpha=0.35, lw=1.5):
    ax.plot([x0, x1], [y, y], color=color, alpha=alpha, lw=lw,
            transform=ax.transAxes, zorder=3)


def mover_row(ax, y, x_sym, x_price, x_pct, sym, price, pct,
               sym_size=20, pct_size=20):
    c = UP if (pct or 0) >= 0 else DOWN
    ax.text(x_sym, y, sym, ha="left", va="center", fontsize=sym_size,
            fontweight="bold", color=WHITE, transform=ax.transAxes, zorder=4)
    ax.text(x_price, y, fmt_price(price), ha="right", va="center",
            fontsize=sym_size - 3, color="#d7e2da", transform=ax.transAxes,
            zorder=4)
    ax.text(x_pct, y, fmt_pct(pct), ha="right", va="center", fontsize=pct_size,
            fontweight="bold", color=c, transform=ax.transAxes, zorder=4)


# ---------------------------------------------------------------- square 1080x1080

def render_square(ov, tickers, stamp):
    fig, ax = new_canvas(1080, 1080)

    date_long, _, _ = fmt_date(ov.get("trade_date", ""))
    session = ov.get("market_status") == "open" or ov.get("session")
    dateline = ("Session · ~30-min delayed" if session else "Daily close") + " · " + date_long

    kicker(ax, 0.5, 0.945, "NGX Market Snapshot", 27)
    label(ax, 0.5, 0.905, dateline, 19)

    label(ax, 0.5, 0.845, "ALL-SHARE INDEX", 19, weight="bold")
    asi = ov.get("asi")
    ax.text(0.5, 0.762, f"{asi:,.2f}" if asi is not None else "—",
            ha="center", va="center", fontsize=96, fontweight="bold",
            color=WHITE, transform=ax.transAxes, zorder=4)
    pc = ov.get("pct_change")
    arrow = "▲" if (pc or 0) >= 0 else "▼"
    ax.text(0.5, 0.658, f"{arrow} {fmt_pct(pc)} today", ha="center", va="center",
            fontsize=34, fontweight="bold",
            color=UP if (pc or 0) >= 0 else DOWN,
            bbox=dict(boxstyle="round,pad=0.45", facecolor="#ffffff14",
                      edgecolor="none"),
            transform=ax.transAxes, zorder=4)

    # breadth
    for x, val, name, color in ((0.24, ov.get("advancers"), "ADVANCERS", UP),
                               (0.50, ov.get("unchanged"), "UNCHANGED", MUTED),
                               (0.76, ov.get("decliners"), "DECLINERS", DOWN)):
        ax.text(x, 0.565, str(val if val is not None else "—"), ha="center",
                va="center", fontsize=54, fontweight="bold", color=color,
                transform=ax.transAxes, zorder=4)
        label(ax, x, 0.515, name, 17, weight="bold")

    hline(ax, 0.475)

    gainers = sorted([t for t in tickers if change_of(t) is not None],
                     key=lambda t: change_of(t), reverse=True)[:5]
    losers = sorted([t for t in tickers if change_of(t) is not None],
                    key=lambda t: change_of(t))[:5]

    kicker(ax, 0.265, 0.425, "Top Gainers", 21)
    kicker(ax, 0.755, 0.425, "Top Losers", 21)
    for i in range(5):
        y = 0.365 - i * 0.058
        if i < len(gainers):
            g = gainers[i]
            mover_row(ax, y, 0.06, 0.335, 0.465, g["symbol"],
                      g.get("current_price"), change_of(g))
        if i < len(losers):
            l = losers[i]
            mover_row(ax, y, 0.55, 0.83, 0.955, l["symbol"],
                      l.get("current_price"), change_of(l))

    hline(ax, 0.095)
    label(ax, 0.5, 0.055, "nairaview.com · Delayed data · Not investment advice", 18)

    fig.savefig(stamp["square"], dpi=100)
    plt.close(fig)


# ---------------------------------------------------------------- wide 1200x675

def render_wide(ov, tickers, stamp):
    fig, ax = new_canvas(1200, 675)

    _, date_short, _ = fmt_date(ov.get("trade_date", ""))
    session = ov.get("market_status") == "open" or ov.get("session")
    dateline = ("Session · ~30-min delayed" if session else "Daily close") + \
        " · " + date_short

    kicker(ax, 0.045, 0.905, "NGX Market Snapshot", 24, ha="left")
    label(ax, 0.045, 0.845, dateline, 17, ha="left")

    label(ax, 0.045, 0.745, "ALL-SHARE INDEX", 17, ha="left", weight="bold")
    asi = ov.get("asi")
    ax.text(0.045, 0.60, f"{asi:,.2f}" if asi is not None else "—",
            ha="left", va="center", fontsize=52, fontweight="bold",
            color=WHITE, transform=ax.transAxes, zorder=4)
    pc = ov.get("pct_change")
    arrow = "▲" if (pc or 0) >= 0 else "▼"
    ax.text(0.045, 0.465, f"{arrow} {fmt_pct(pc)} today", ha="left", va="center",
            fontsize=26, fontweight="bold",
            color=UP if (pc or 0) >= 0 else DOWN,
            bbox=dict(boxstyle="round,pad=0.45", facecolor="#ffffff14",
                      edgecolor="none"),
            transform=ax.transAxes, zorder=4)

    for x, val, name, color in ((0.05, ov.get("advancers"), "ADVANCERS", UP),
                               (0.18, ov.get("unchanged"), "UNCHANGED", MUTED),
                               (0.31, ov.get("decliners"), "DECLINERS", DOWN)):
        ax.text(x, 0.30, str(val if val is not None else "—"), ha="left",
                va="center", fontsize=40, fontweight="bold", color=color,
                transform=ax.transAxes, zorder=4)
        label(ax, x, 0.225, name, 14, ha="left", weight="bold")

    label(ax, 0.045, 0.09,
          "nairaview.com · Delayed data · Not investment advice", 15, ha="left")

    # vertical divider
    ax.plot([0.42, 0.42], [0.10, 0.90], color=GOLD, alpha=0.35, lw=1.5,
            transform=ax.transAxes, zorder=3)

    gainers = sorted([t for t in tickers if change_of(t) is not None],
                     key=lambda t: change_of(t), reverse=True)[:5]
    losers = sorted([t for t in tickers if change_of(t) is not None],
                    key=lambda t: change_of(t))[:5]

    for (x0, x1, title, rows) in ((0.455, 0.715, "TOP GAINERS", gainers),
                                 (0.745, 0.975, "TOP LOSERS", losers)):
        kicker(ax, (x0 + x1) / 2, 0.83, title, 19)
        for i, r in enumerate(rows):
            y = 0.74 - i * 0.125
            c = UP if (change_of(r) or 0) >= 0 else DOWN
            sym_size = 18 if len(r["symbol"]) <= 8 else 16
            ax.text(x0, y, r["symbol"], ha="left", va="center", fontsize=sym_size,
                    fontweight="bold", color=WHITE, transform=ax.transAxes,
                    zorder=4)
            ax.text(x1, y, fmt_pct(change_of(r)), ha="right", va="center",
                    fontsize=18, fontweight="bold", color=c,
                    transform=ax.transAxes, zorder=4)
            ax.text(x0, y - 0.05, fmt_price(r.get("current_price")),
                    ha="left", va="center", fontsize=15, color="#d7e2da",
                    transform=ax.transAxes, zorder=4)

    fig.savefig(stamp["wide"], dpi=100)
    plt.close(fig)


# ---------------------------------------------------------------- main

def main():
    test = "--test" in sys.argv

    if test:
        ov = copy.deepcopy(SAMPLE["overview"])
        tickers = SAMPLE["tickers"]
    else:
        try:
            prices = fetch_json("/api/prices")
            market = fetch_json("/api/market")
        except Exception as e:
            print(f"fetch failed: {e}; skipping")
            return 0
        tickers = unwrap_stocks(prices)
        if len(tickers) < 50:
            print("insufficient data, skipping")
            return 0
        mdata = market.get("overview", {}).get("data", {}) if isinstance(market, dict) else {}
        ov = {
            "asi": mdata.get("asi"),
            "pct_change": mdata.get("pct_change"),
            "advancers": mdata.get("advancers"),
            "decliners": mdata.get("decliners"),
            "unchanged": mdata.get("unchanged"),
            "trade_date": mdata.get("trade_date"),
            "market_status": mdata.get("market_status"),
            "session": mdata.get("session"),
        }

    _, _, ymd = fmt_date(ov.get("trade_date", ""))
    if not ymd:
        ymd = datetime.now().strftime("%Y%m%d")

    os.makedirs(OUT_DIR, exist_ok=True)
    stamp = {
        "square": os.path.join(OUT_DIR, f"market-snapshot-{ymd}.png"),
        "wide": os.path.join(OUT_DIR, f"market-snapshot-wide-{ymd}.png"),
    }
    render_square(ov, tickers, stamp)
    render_wide(ov, tickers, stamp)
    for key, latest in (("square", "market-snapshot-latest.png"),
                        ("wide", "market-snapshot-wide-latest.png")):
        shutil.copyfile(stamp[key], os.path.join(OUT_DIR, latest))
    print("wrote:")
    print(" ", stamp["square"])
    print(" ", stamp["wide"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
