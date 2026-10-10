#!/usr/bin/env python3
"""Nairaview FX rates infographic.

Fetches /api/fx and renders a square (1080x1080) "Naira FX Rates" PNG for
X (@Naira_view) and WhatsApp sharing: USD/EUR/GBP official + street rates.

Saves fx-rates-YYYYMMDD.png and fx-rates-latest.png under
assets/img/infographics/.

Usage:
    python3 gen_fx_infographic.py            # live data
    python3 gen_fx_infographic.py --test     # embedded sample data
"""

import json
import os
import subprocess
import sys
import time
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
MUTED = "#9db3a4"
WHITE = "#ffffff"

plt.rcParams["font.family"] = "DejaVu Sans"

SAMPLE = {
    "latest": {
        "USD": {"official": 1329.04, "parallel": 1361.04},
        "EUR": {"official": 1500.16, "parallel": 1518.00},
        "GBP": {"official": 1759.07, "parallel": 1787.02},
        "pulled_at": "2026-10-04T22:33:34Z",
    }
}

CCYS = [("USD", "US DOLLAR"), ("EUR", "EURO"), ("GBP", "BRITISH POUND")]


def fetch_json(path, tries=3):
    last = None
    for i in range(tries):
        try:
            out = subprocess.run(
                ["curl", "-s", "--max-time", "40", "-H",
                 "User-Agent: nairaview-fx-infographic/1.0", API + path],
                capture_output=True, timeout=60)
            if out.returncode != 0 or not out.stdout:
                raise RuntimeError(f"curl rc={out.returncode}")
            return json.loads(out.stdout.decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            last = e
            if i < tries - 1:
                time.sleep(5 * (i + 1))
    raise last


def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def spaced(s):
    return " ".join(s)


def fmt_rate(v):
    return "₦" + f"{v:,.2f}" if v else "—"


def new_canvas(w, h):
    fig = plt.figure(figsize=(w / 100.0, h / 100.0), dpi=100)
    top, bot = np.array(hex_to_rgb("#0d4229")), np.array(hex_to_rgb("#03130b"))
    t = np.linspace(0, 1, h)[:, None, None]
    img = top[None, None, :] * (1 - t) + bot[None, None, :] * t
    img = np.repeat(img, w, axis=1)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.imshow(img, extent=[0, 1, 0, 1], aspect="auto", zorder=0)
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")
    ax.plot([0, 1], [0.996, 0.996], color=GOLD, lw=7,
            transform=ax.transAxes, clip_on=False, zorder=3,
            solid_capstyle="butt")
    return fig, ax


def render(latest, stamp):
    fig, ax = new_canvas(1080, 1080)

    try:
        d = datetime.fromisoformat(latest.get("pulled_at", "").replace("Z", "+00:00"))
        dateline = d.strftime("%A, %d %B %Y")
    except Exception:  # noqa: BLE001
        dateline = ""

    ax.text(0.5, 0.93, spaced("NAIRA FX RATES"), ha="center", va="center",
            fontsize=30, fontweight="bold", color=GOLD,
            transform=ax.transAxes, zorder=4)
    ax.text(0.5, 0.885, dateline, ha="center", va="center", fontsize=21,
            color=MUTED, transform=ax.transAxes, zorder=4)

    y = 0.76
    for code, label in CCYS:
        legs = latest.get(code, {}) or {}
        off, par = legs.get("official"), legs.get("parallel")
        ax.text(0.08, y, label, ha="left", va="center", fontsize=22,
                fontweight="bold", color=WHITE, transform=ax.transAxes, zorder=4)
        ax.text(0.08, y - 0.055, fmt_rate(off), ha="left", va="center",
                fontsize=44, fontweight="bold", color=WHITE,
                transform=ax.transAxes, zorder=4)
        ax.text(0.08, y - 0.105, "OFFICIAL", ha="left", va="center",
                fontsize=16, color=MUTED, transform=ax.transAxes, zorder=4)
        ax.text(0.92, y - 0.055, fmt_rate(par), ha="right", va="center",
                fontsize=44, fontweight="bold", color=GOLD,
                transform=ax.transAxes, zorder=4)
        ax.text(0.92, y - 0.105, "STREET · INDICATIVE", ha="right", va="center",
                fontsize=16, color=MUTED, transform=ax.transAxes, zorder=4)
        if code != "GBP":
            ax.plot([0.08, 0.92], [y - 0.155, y - 0.155], color=GOLD,
                    alpha=0.35, lw=1.5, transform=ax.transAxes, zorder=3)
        y -= 0.21

    ax.text(0.5, 0.075, "nairaview.com/fx", ha="center", va="center",
            fontsize=24, fontweight="bold", color=WHITE,
            transform=ax.transAxes, zorder=4)
    ax.text(0.5, 0.04, "Official NFEM rate · street rate indicative",
            ha="center", va="center", fontsize=16, color=MUTED,
            transform=ax.transAxes, zorder=4)

    os.makedirs(OUT_DIR, exist_ok=True)
    dated = os.path.join(OUT_DIR, f"fx-rates-{stamp}.png")
    latest_p = os.path.join(OUT_DIR, "fx-rates-latest.png")
    fig.savefig(dated, dpi=100, bbox_inches="tight", pad_inches=0)
    fig.savefig(latest_p, dpi=100, bbox_inches="tight", pad_inches=0)
    plt.close(fig)
    print(f"wrote {dated}")
    print(f"wrote {latest_p}")


def main():
    test = "--test" in sys.argv
    if test:
        doc = SAMPLE
    else:
        doc = fetch_json("/api/fx")
    latest = doc.get("latest") or {}
    if not latest.get("USD"):
        print("insufficient data, skipping")
        return
    try:
        d = datetime.fromisoformat(latest.get("pulled_at", "").replace("Z", "+00:00"))
        stamp = d.strftime("%Y%m%d")
    except Exception:  # noqa: BLE001
        stamp = datetime.now().strftime("%Y%m%d")
    render(latest, stamp)


if __name__ == "__main__":
    main()
