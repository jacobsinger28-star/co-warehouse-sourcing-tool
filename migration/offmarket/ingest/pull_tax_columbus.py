#!/usr/bin/env python3
"""
pull_tax_columbus.py — Columbus / Franklin County tax delinquency -> staging_tax_delinquency.

Franklin County, unlike Cuyahoga/Hamilton (whose parcel layers carry a native delinquent balance),
publishes tax delinquency ONLY through the Auditor's per-parcel "taxpayments" datalet — there is no
bulk file (the parcel-layer tax-owed fields are NULL; the Auditor TaxDetail.xlsx is empty; the
Treasurer site is WAF-blocked; the full delinquent PDF list is WAF-blocked too). So we SCRAPE the
datalet for each gated parcel and read the Auditor's own **CDQ ("Currently DelinQuent") flag**.

Recipe (verified live, session-based ASP.NET WebForms, no key/auth, not WAF-blocked):
  1. GET  _web/search/commonsearch.aspx?mode=parid          -> session cookie + viewstate
  2. POST same w/ viewstate + inpParid=<undashed apn>        -> 302 selects the parcel
  3. GET  _web/Datalets/Datalet.aspx?mode=taxpayments...     -> CDQ flag + tax-year balances

Mirrors Cuyahoga's load_tax_delinquency: one staging_tax_delinquency row per delinquent parcel,
years_delinquent=1 (honest floor — CDQ tells us there IS unpaid tax, not how many years; score.py's
tax CTE scores it the "one_year" tier). amount_owed carries the prior/total balance when parseable.
Scope: gated parcels only (in_universe OR manual_review) to bound the ~1.5s/parcel scrape.

    MARKET=columbus python ingest/pull_tax_columbus.py [--limit N]
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
import time
from pathlib import Path

import psycopg2.extras
import requests
from tenacity import retry, stop_after_attempt, wait_fixed, retry_if_exception_type

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib.db import JobRun, cursor  # noqa: E402

BASE = "https://property.franklincountyauditor.com/_web"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124 Safari/537.36")
SEARCH = f"{BASE}/search/commonsearch.aspx?mode=parid"
DATALET = f"{BASE}/Datalets/Datalet.aspx?mode=taxpayments&sIndex=0&idx=1"
SLEEP = 0.2                       # polite delay between parcels
SOURCE = BASE + "/Datalets/Datalet.aspx?mode=taxpayments#CDQ"
# Resumable cache: one row per scraped parcel, flushed immediately. A killed run loses nothing;
# the next run skips cached parcels and finishes. staging_tax_delinquency is rebuilt from the cache.
CACHE = Path(__file__).resolve().parent.parent / "image_cache" / "cama_columbus" / "tax_cdq_cache.csv"


def _hidden(html: str, name: str) -> str:
    m = re.search(r'id="%s"\s+value="([^"]*)"' % re.escape(name), html)
    return m.group(1) if m else ""


def _amount(html: str) -> float | None:
    """Best-effort: the largest 'Prior' / unpaid-balance dollar figure on the page."""
    vals = []
    for m in re.finditer(r'(?:Prior|Total\s*Due|Delinquent)[^$]{0,80}\$([\d,]+\.\d{2})', html, re.I):
        try:
            vals.append(float(m.group(1).replace(",", "")))
        except ValueError:
            pass
    return max(vals) if vals else None


@retry(retry=retry_if_exception_type(requests.RequestException),
       wait=wait_fixed(2), stop=stop_after_attempt(3), reraise=True)
def scrape_parcel(sess: requests.Session, apn: str) -> tuple[str, float | None]:
    """Return (cdq, amount_owed) for one dashed apn. cdq is 'Yes'/'No'/'?'."""
    parid = apn.replace("-", "")
    h = sess.get(SEARCH, timeout=30).text
    sess.post(SEARCH, timeout=30, allow_redirects=True, data={
        "__VIEWSTATE": _hidden(h, "__VIEWSTATE"),
        "__VIEWSTATEGENERATOR": _hidden(h, "__VIEWSTATEGENERATOR"),
        "__EVENTVALIDATION": _hidden(h, "__EVENTVALIDATION"),
        "mode": "parid", "inpParid": parid, "btSearch": "Search"})
    d = sess.get(DATALET, timeout=30).text
    m = (re.search(r'CDQ[^<]*</td>\s*<td[^>]*>\s*([A-Za-z]+)', d)
         or re.search(r'Currently\s*Delinquent[^<]*</td>\s*<td[^>]*>\s*([A-Za-z]+)', d, re.I))
    cdq = m.group(1).strip() if m else "?"
    return cdq, (_amount(d) if cdq.lower() == "yes" else None)


def gated_apns() -> list[str]:
    with cursor(commit=False) as cur:
        cur.execute("SELECT apn FROM parcels WHERE in_universe OR manual_review ORDER BY apn")
        return [r[0] for r in cur.fetchall()]


def _load_cache() -> dict[str, str]:
    """apn -> cdq from the resumable cache (so a re-run skips already-scraped parcels)."""
    if not CACHE.exists():
        return {}
    with open(CACHE, newline="") as fh:
        return {r["apn"]: r["cdq"] for r in csv.DictReader(fh) if r.get("apn")}


def _load_staging_from_cache() -> int:
    """Rebuild staging_tax_delinquency from the cache: a row per CDQ=Yes parcel. The cache is
    append-only, so a re-scraped parcel appears twice — keep the LAST (corrected) value per apn."""
    latest: dict[str, dict] = {}
    if CACHE.exists():
        with open(CACHE, newline="") as fh:
            for r in csv.DictReader(fh):
                if r.get("apn"):
                    latest[r["apn"]] = r
    rows = []
    for apn, r in latest.items():
        if (r.get("cdq") or "").lower() == "yes":
            amt = float(r["amount"]) if r.get("amount") else None
            rows.append((apn, re.sub(r"\D", "", apn), amt, 1, SOURCE,
                         psycopg2.extras.Json({"cdq": r["cdq"], "amount": amt})))
    with cursor() as cur:
        cur.execute("TRUNCATE staging_tax_delinquency")
        if rows:
            psycopg2.extras.execute_values(
                cur,
                "INSERT INTO staging_tax_delinquency "
                "(apn_raw, apn_norm, amount_owed, years_delinquent, source_file, raw) VALUES %s",
                rows, page_size=500)
    return len(rows)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None,
                    help="scrape at most N NEW (uncached) parcels this run, then stop (for chunking)")
    args = ap.parse_args()

    all_apns = gated_apns()
    if not all_apns:
        raise RuntimeError("no gated parcels — run pull_parcels_columbus + build_universe first")
    cache = _load_cache()
    # Re-scrape anything not yet cached OR that came back "?" (a stale-session miss — a FRESH
    # session per parcel fixes those; verified the reused session degrades after a few hundred hits).
    todo = [a for a in all_apns if cache.get(a) in (None, "?")]
    if args.limit:
        todo = todo[:args.limit]
    done_clean = sum(1 for v in cache.values() if v not in (None, "?"))
    print(f"pull_tax_columbus: {done_clean}/{len(all_apns)} clean-cached; scraping {len(todo)} "
          f"(incl. {sum(1 for a in todo if cache.get(a)=='?')} '?' retries) this run ...")

    CACHE.parent.mkdir(parents=True, exist_ok=True)
    new = not CACHE.exists()
    done, errors = 0, 0
    with JobRun("pull_tax_columbus") as job, open(CACHE, "a", newline="") as fh:
        w = csv.writer(fh)
        if new:
            w.writerow(["apn", "cdq", "amount"]); fh.flush()
        for apn in todo:
            sess = requests.Session()                    # FRESH session per parcel (avoids degradation)
            sess.headers["User-Agent"] = UA
            try:
                cdq, amt = scrape_parcel(sess, apn)
            except Exception as e:                       # noqa: BLE001
                errors += 1
                job.fail(f"scrape failed: {e}", ref=apn)
                if errors > max(20, len(todo) // 5):
                    print(f"  aborting: too many failures ({errors}); progress is cached, re-run to resume")
                    break
                continue
            w.writerow([apn, cdq, amt if amt is not None else ""]); fh.flush()   # never lose progress
            done += 1
            if done % 50 == 0:
                print(f"    {done}/{len(todo)} scraped this run ({errors} errors)")
            time.sleep(SLEEP)

    n = _load_staging_from_cache()
    remaining = len(all_apns) - len(_load_cache())
    print(f"  scraped {done} this run; staging_tax_delinquency rebuilt: {n} delinquent. "
          f"{remaining} parcels still to scrape (re-run to finish).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
