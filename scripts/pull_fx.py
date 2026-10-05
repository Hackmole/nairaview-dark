#!/usr/bin/env python3
"""Pull USD/NGN exchange rates into Cloudflare KV for nairaview.com.

Sources:
  - Official rate: Frankfurter API (free, no key) -> https://api.frankfurter.dev/v2/rate/USD/NGN
  - Parallel (street) rate: Monierate API when MONIERATE_TOKEN is set,
    otherwise scraped from abokiforex.app (static HTML, no JS needed).

Usage:
    pull_fx.py pull     # fetch both rates -> KV (fx:latest, fx:hist)
    pull_fx.py latest   # print what /api/fx would serve (from KV)

KV keys read by the API worker:
    fx:latest  - {"official": 1329.04, "official_date": "2026-10-04",
                  "parallel": 1365, "parallel_updated_at": "2026-10-04T22:06:25Z",
                  "parallel_source": "abokiforex.app" | "monierate",
                  "pulled_at": "2026-10-04T22:10:00Z"}
    fx:hist    - [{"date": "2026-10-04", "official": 1329.04, "parallel": 1365}, ...]
                 one point per day, newest last, capped at 120.

Never invents numbers: if a source fails or parses to nothing, that leg is
left out and the failure is reported (the page renders "—" for missing legs).
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
from dynamic_credentials import (
    add_surrogate_to_request,
    ensure_allowed_url,
    read_json_response,
    DynamicCredentialError,
)

CF_API = "https://api.cloudflare.com/client/v4"
CF_HOSTS = ["api.cloudflare.com"]
CF_CRED = "custom.cloudflare"
CF_ACCOUNT = "78f7403e4711bd80041a4100bf94ca3b"
CF_KV_NS = "dce1bca7fcd34b3485791a2b3762974f"

# Major currencies tracked (vs NGN). USD is the headline pair; EUR/GBP follow.
CURRENCIES = ["USD", "EUR", "GBP"]
CURRENCY_NAMES = {"USD": "US dollar", "EUR": "Euro", "GBP": "British pound"}

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

FRANKFURTER_URL = "https://api.frankfurter.dev/v2/rate/{base}/NGN"
FRANKFURTER_HOSTS = ["api.frankfurter.dev"]
ABOKI_URL = ("https://abokiforex.app/currency-converter/"
             "black-market-usd-dollars-to-naira-rate")
ABOKI_HOSTS = ["abokiforex.app"]
MONIERATE_URL = ("https://api.monierate.com/core/rates/latest.json"
                 "?base={base}&market=parallel")
MONIERATE_HOSTS = ["api.monierate.com"]
MONIERATE_CRED = "custom.monierate"


def http_get(url, hosts, headers=None, timeout=40):
    ensure_allowed_url(url, hosts)
    merged = {"User-Agent": UA}
    merged.update(headers or {})
    req = urllib.request.Request(url, headers=merged)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def fetch_official(base):
    """Official {base}/NGN from Frankfurter. Returns (rate, date) or (None, None)."""
    try:
        data = json.loads(http_get(FRANKFURTER_URL.format(base=base),
                                   FRANKFURTER_HOSTS,
                                   {"Accept": "application/json"}))
        rate = float(data["rate"])
        if rate > 0:
            return rate, data.get("date")
    except Exception as exc:  # noqa: BLE001 - never invent, just report
        print(f"official fetch failed ({base}): {exc}", file=sys.stderr)
    return None, None


def fetch_parallel_monierate(base):
    """Parallel {base}/NGN from Monierate (market=parallel aggregate).
    Returns (rate, updated_at_iso) or (None, None)."""
    try:
        url = MONIERATE_URL.format(base=base)
        ensure_allowed_url(url, MONIERATE_HOSTS)
        req = urllib.request.Request(
            url,
            headers={"Accept": "application/json", "User-Agent": UA})
        add_surrogate_to_request(req, MONIERATE_CRED,
                                 allowed_hosts=MONIERATE_HOSTS)
        with urllib.request.urlopen(req, timeout=40) as resp:
            data = read_json_response(resp)
        d = data.get("data", {})
        rate = float(d.get("rates", {}).get("NGN") or 0)
        ts_ms = d.get("timestamp")
        updated = None
        if ts_ms:
            updated = (datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc)
                       .strftime("%Y-%m-%dT%H:%M:%SZ"))
        if rate > 0:
            return rate, updated
        print(f"monierate: no NGN rate in response ({base}, market={d.get('market')})",
              file=sys.stderr)
    except Exception as exc:  # noqa: BLE001
        print(f"monierate fetch failed ({base}): {exc}", file=sys.stderr)
    return None, None


def fetch_parallel_aboki():
    """Parallel USD/NGN scraped from abokiforex.app. Returns (rate, updated_at)."""
    try:
        html = http_get(ABOKI_URL, ABOKI_HOSTS)
        m = re.search(r"1 US Dollar equals <strong>([\d,]+) Naira</strong>", html)
        if not m:
            print("aboki parse: rate pattern not found", file=sys.stderr)
            return None, None
        rate = float(m.group(1).replace(",", ""))
        tm = re.search(r'<time datetime="([^"]+)"', html)
        updated = tm.group(1) if tm else None
        if rate > 0:
            return rate, updated
    except Exception as exc:  # noqa: BLE001
        print(f"aboki fetch failed: {exc}", file=sys.stderr)
    return None, None


def kv_put(key: str, value: str, ttl: int = 172800) -> None:
    url = (f"{CF_API}/accounts/{CF_ACCOUNT}/storage/kv/namespaces/"
           f"{CF_KV_NS}/values/{key}?expiration_ttl={ttl}")
    ensure_allowed_url(url, CF_HOSTS)
    req = urllib.request.Request(url, data=value.encode("utf-8"), method="PUT",
                                 headers={"Content-Type": "text/plain"})
    add_surrogate_to_request(req, CF_CRED, allowed_hosts=CF_HOSTS)
    with urllib.request.urlopen(req, timeout=40) as resp:
        payload = read_json_response(resp)
    if not payload.get("success"):
        raise DynamicCredentialError(f"KV put {key} failed: {payload.get('errors')}")


def kv_get(key: str):
    url = (f"{CF_API}/accounts/{CF_ACCOUNT}/storage/kv/namespaces/"
           f"{CF_KV_NS}/values/{key}")
    ensure_allowed_url(url, CF_HOSTS)
    req = urllib.request.Request(url, method="GET")
    add_surrogate_to_request(req, CF_CRED, allowed_hosts=CF_HOSTS)
    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise


def cmd_pull():
    now = datetime.now(timezone.utc)
    now_iso = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    today = now.strftime("%Y-%m-%d")

    latest = {}
    for base in CURRENCIES:
        official, official_date = fetch_official(base)

        # Parallel: Monierate first (structured, aggregated); abokiforex.app
        # scrape as fallback for USD only.
        parallel, parallel_updated = fetch_parallel_monierate(base)
        parallel_source = "monierate"
        if parallel is None and base == "USD":
            parallel, parallel_updated = fetch_parallel_aboki()
            parallel_source = "abokiforex.app"

        if official is None and parallel is None:
            print(f"{base}: both sources failed; skipped", file=sys.stderr)
            continue

        latest[base] = {
            "official": round(official, 2) if official else None,
            "official_date": official_date,
            "parallel": round(parallel, 2) if parallel else None,
            "parallel_updated_at": parallel_updated,
            "parallel_source": parallel_source,
        }

    if not latest:
        print("all currencies failed; nothing written", file=sys.stderr)
        sys.exit(1)

    latest["pulled_at"] = now_iso
    kv_put("fx:latest", json.dumps(latest), ttl=172800)

    # accumulate one point per day, per currency
    hist = {}
    raw = kv_get("fx:hist")
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                # migrate legacy flat-list format (USD only)
                hist = {"USD": parsed}
            elif isinstance(parsed, dict):
                hist = parsed
        except json.JSONDecodeError:
            hist = {}
    for base, legs in latest.items():
        if base == "pulled_at":
            continue
        points = hist.get(base, [])
        point = {"date": today,
                 "official": legs["official"],
                 "parallel": legs["parallel"]}
        if points and points[-1].get("date") == today:
            prev = points[-1]
            for leg in ("official", "parallel"):
                if point[leg] is None:
                    point[leg] = prev.get(leg)
            points[-1] = point
        else:
            points.append(point)
        hist[base] = points[-120:]
    kv_put("fx:hist", json.dumps(hist), ttl=10368000)

    print(json.dumps(latest))


def cmd_latest():
    raw = kv_get("fx:latest")
    hist_raw = kv_get("fx:hist")
    hist = json.loads(hist_raw) if hist_raw else {}
    if isinstance(hist, list):  # legacy flat format
        hist = {"USD": hist}
    print(json.dumps({
        "latest": json.loads(raw) if raw else None,
        "history_points": {k: len(v) for k, v in hist.items()},
    }, indent=2))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "pull"
    if cmd == "pull":
        cmd_pull()
    elif cmd == "latest":
        cmd_latest()
    else:
        print(f"unknown command: {cmd}", file=sys.stderr)
        sys.exit(2)
