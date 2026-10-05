#!/usr/bin/env python3
"""One-time backfill: fetch 7-session history for tickers missing it.

Usage: python3 backfill_history.py [max_calls]
Respects the free-tier quota: defaults to 40 calls, 7s apart.
Merges into mkt:histlong:<SYM> using the same logic as pull_market.py.
"""
import json
import sys
import time
import urllib.request

sys.path.insert(0, "/home/hatch/workspace/skills/ngxpulse/bin")
import importlib.util

spec = importlib.util.spec_from_file_location(
    "pull_market", "/home/hatch/workspace/skills/ngxpulse/bin/pull_market.py")
pm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pm)

API = "https://nairaview-api.meetomidiora.workers.dev"


def api_get(path):
    req = urllib.request.Request(API + path, headers={"User-Agent": "nairaview-backfill/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def main():
    max_calls = int(sys.argv[1]) if len(sys.argv) > 1 else 40
    # all symbols from the prices feed
    d = api_get("/api/prices")
    inner = d["stocks"] if isinstance(d.get("stocks"), dict) else {}
    stocks = inner.get("stocks", []) if isinstance(inner, dict) else []
    syms = [s["symbol"] for s in stocks if s.get("symbol")]
    print(f"total symbols: {len(syms)}", flush=True)

    # find those missing long history (check KV directly: no API cost)
    missing = []
    for sym in syms:
        raw = pm.kv_get(f"mkt:histlong:{sym}")
        try:
            doc = json.loads(raw) if raw else {}
            n = len(doc.get("prices") or [])
        except Exception:
            n = 0
        if n < 2:
            missing.append(sym)
    print(f"missing history: {len(missing)}", flush=True)

    done, failed = 0, []
    for sym in missing[:max_calls]:
        try:
            h = pm.pulse_get(f"/ngxdata/prices/{sym}?days=7")
            new_prices = h.get("prices") if isinstance(h, dict) else None
            if new_prices:
                old_raw = pm.kv_get(f"mkt:histlong:{sym}")
                old_doc = json.loads(old_raw) if old_raw else {}
                old_prices = old_doc.get("prices") or []
                seen = {p.get("trade_date") for p in old_prices
                        if isinstance(p, dict) and p.get("trade_date")}
                merged = [p for p in old_prices if isinstance(p, dict)]
                merged += [p for p in new_prices
                           if isinstance(p, dict) and p.get("trade_date")
                           and p["trade_date"] not in seen]
                merged.sort(key=lambda p: p.get("trade_date") or "")
                merged = merged[-120:]
                pm.kv_put(f"mkt:histlong:{sym}",
                          json.dumps({"symbol": sym, "prices": merged}),
                          ttl=120 * 86400)
                done += 1
                print(f"  {sym}: {len(merged)} sessions", flush=True)
            else:
                failed.append(sym)
        except Exception as e:
            print(f"  {sym}: FAILED {e}", flush=True)
            failed.append(sym)
        time.sleep(7)
    print(f"done: {done}, failed: {len(failed)}")
    if failed:
        print("failed:", ",".join(failed))


if __name__ == "__main__":
    main()
