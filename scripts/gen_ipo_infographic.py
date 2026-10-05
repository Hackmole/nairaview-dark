#!/usr/bin/env python3
"""Dangote Refinery IPO closing-week infographic.

Renders a square (1080x1080) and wide (1200x675) "IPO closing week" PNG in the
site's green/gold treatment, reusing only sourced facts from the IPO cluster:
  - Offer price ₦525 per share, ₦5,250 minimum subscription
  - Offer closes 13 October 2026, ~55 subscription channels
  - November allotment, early-December NGX listing target
No day-count is baked in (it would rot); the close date is the honest anchor.

Usage:
    python3 gen_ipo_infographic.py            # writes dated + -latest copies
Output:
    assets/img/infographics/dangote-ipo-closing-YYYYMMDD{-square,-wide}.png
"""
import os
import shutil
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_infographics import (  # noqa: E402
    new_canvas, kicker, label, hline, GREEN, GOLD, WHITE, MUTED, hex_to_rgb,
)

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "..", "assets", "img", "infographics")

FACTS = [
    ("₦525", "per share offer price"),
    ("₦5,250", "minimum subscription"),
    ("~55", "subscription channels"),
    ("November", "allotment expected"),
    ("Early December", "NGX listing target"),
]


def draw(ax, wide):
    # kicker + headline
    kicker(ax, 0.5, 0.90, "Dangote Refinery IPO · Closing week", 26 if not wide else 22)
    ax.text(0.5, 0.80, "Offer closes", ha="center", va="center", fontsize=34,
            color=MUTED, transform=ax.transAxes, zorder=4)
    ax.text(0.5, 0.71, "13 October 2026", ha="center", va="center", fontsize=64 if not wide else 56,
            fontweight="bold", color=WHITE, transform=ax.transAxes, zorder=4)
    hline(ax, 0.62)
    # facts
    n = len(FACTS)
    if wide:
        # two columns: 3 + 2
        cols = [(0.30, FACTS[:3]), (0.72, FACTS[3:])]
        for x, items in cols:
            y = 0.50
            for val, cap in items:
                ax.text(x, y, val, ha="center", va="center", fontsize=40,
                        fontweight="bold", color=GOLD, transform=ax.transAxes, zorder=4)
                label(ax, x, y - 0.055, cap, 17)
                y -= 0.16
    else:
        y = 0.545
        for val, cap in FACTS:
            ax.text(0.5, y, val, ha="center", va="center", fontsize=42,
                    fontweight="bold", color=GOLD, transform=ax.transAxes, zorder=4)
            label(ax, 0.5, y - 0.038, cap, 19)
            y -= 0.088
    hline(ax, 0.085 if not wide else 0.13)
    label(ax, 0.5, 0.04 if not wide else 0.07, "nairaview.com", 20, color=WHITE, weight="bold")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d")
    for name, w, h in [("square", 1080, 1080), ("wide", 1200, 675)]:
        fig, ax = new_canvas(w, h)
        draw(ax, wide=(name == "wide"))
        dated = os.path.join(OUT_DIR, f"dangote-ipo-closing-{stamp}-{name}.png")
        latest = os.path.join(OUT_DIR, f"dangote-ipo-closing-latest-{name}.png")
        fig.savefig(dated, dpi=100, bbox_inches="tight", pad_inches=0)
        plt.close(fig)
        shutil.copy(dated, latest)
        print("wrote", dated, os.path.getsize(dated), "bytes")


if __name__ == "__main__":
    main()
