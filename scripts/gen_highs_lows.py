#!/usr/bin/env python3
"""Generate assets/highs-lows.json: per-symbol tracked highs/lows.

Fetches /api/history for every symbol in the baked directory and records
the highest high / lowest low over the tracked window, plus the latest
close and how far it sits from each extreme. Re-run after the daily pull
to keep the board fresh:

    python3 scripts/gen_highs_lows.py

Output: assets/highs-lows.json  { as_of, window_start, symbols: { SYM: {...} } }
"""
import json
import re
import sys
from pathlib import Path

import requests

API = "https://nairaview-api.meetomidiora.workers.dev"
ROOT = Path(__file__).resolve().parent.parent


def load_symbols():
    data_js = (ROOT / "assets" / "data.js").read_text()
    syms = re.findall(r'"s":\s*"([A-Z0-9]+)"', data_js)
    # preserve order, dedupe
    seen, out = set(), []
    for s in syms:
        if s not in seen:
            seen.add(s)
            out.append(s)
    return out


def main():
    symbols = load_symbols()
    print(f"{len(symbols)} symbols", flush=True)
    out = {}
    for i, sym in enumerate(symbols):
        try:
            r = requests.get(f"{API}/api/history", params={"symbol": sym}, timeout=25)
            r.raise_for_status()
            prices = r.json().get("prices") or []
        except Exception as e:  # noqa: BLE001 - one bad symbol must not kill the run
            print(f"  {sym}: fetch failed ({e})", flush=True)
            continue
        pts = [p for p in prices if p.get("close")]
        if not pts:
            continue
        closes = [float(p["close"]) for p in pts]
        highs = [float(p["high"]) for p in pts if p.get("high")]
        lows = [float(p["low"]) for p in pts if p.get("low")]
        hi = max(highs) if highs else max(closes)
        lo = min(lows) if lows else min(closes)
        last = closes[-1]
        out[sym] = {
            "sessions": len(pts),
            "start": pts[0]["date"][:10],
            "end": pts[-1]["date"][:10],
            "high": round(hi, 2),
            "low": round(lo, 2),
            "close": round(last, 2),
            "off_high_pct": round((last / hi - 1) * 100, 2) if hi else 0,
            "off_low_pct": round((last / lo - 1) * 100, 2) if lo else 0,
        }
        if (i + 1) % 25 == 0:
            print(f"  {i + 1}/{len(symbols)}", flush=True)

    starts = [v["start"] for v in out.values()]
    ends = [v["end"] for v in out.values()]
    doc = {
        "as_of": max(ends) if ends else None,
        "window_start": min(starts) if starts else None,
        "symbols": out,
    }
    dest = ROOT / "assets" / "highs-lows.json"
    dest.write_text(json.dumps(doc, indent=1))
    print(f"wrote {dest} ({len(out)} symbols, {doc['window_start']} -> {doc['as_of']})")


if __name__ == "__main__":
    sys.exit(main())
