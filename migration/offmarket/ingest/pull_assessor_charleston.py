#!/usr/bin/env python3
"""
pull_assessor_charleston.py — enrich Charleston parcels with the assessor's FULL sales history.

  Charleston County Property Record Card app (prcweb)
    ──> staging_assessor_sales (every deed/sale per parcel)
    ──> corrected properties.last_sale_date / last_sale_price / hold_years

Why this exists
---------------
The Charleston GIS parcel feed (energov layer 12) exposes only ONE sale — a single
RECORDED_DATE / SALE_PRICE — and ~1 in 5 of those is a recent NOMINAL intra-entity transfer
($1-$10 quitclaim). That collapses the apparent hold period, which is the STRONGEST signal this
market has (Charleston has no year_built, no value, no distress feed — see markets/charleston.yaml).
A real example: PID 4060000051 shows a GIS sale of "$10 in 2023" (hold ~2yr), but the assessor's
deed history shows the last arm's-length sale was "$1,525,000 in 1996" — true hold ~30yr. That
long-held, out-of-state-owned warehouse is a prime call target the GIS data was burying.

The county Property Record Card app publishes the full deed history per parcel:
  https://prcweb.charlestoncounty.org/Home/SearchByParcelID?ParcelID=<TMS>
    -> 302 -> /Home/ViewParcelData?parcelId=<token>  (HTML; <table id="myTable"> = deed history).
We stage every sale, then recompute hold from the most-recent ARM'S-LENGTH (> nominal) sale.

Honest limits
-------------
* This is an HTML scrape, not an ArcGIS feed — fragile by nature. Every fetch/parse failure is
  logged and SKIPPED; the parcel keeps its GIS sale (graceful degradation, never worse than before).
* The card's COMMERCIAL building schedule (year_built / heated SF / value) is a SCANNED IMAGE only
  ("Card Image" link) — NOT machine-readable. So this adds sales history ONLY; the year/value/SF
  gaps remain (they are not public for Charleston commercial parcels — verified 2026-06-19).

    MARKET=charleston python ingest/pull_assessor_charleston.py
"""
from __future__ import annotations

import html
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

import psycopg2.extras
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib.db import JobRun, cursor  # noqa: E402

PRC_SEARCH = "https://prcweb.charlestoncounty.org/Home/SearchByParcelID"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")
NOMINAL_MAX = 1000          # sales <= $1,000 are nominal/intra-entity transfers, not acquisitions
WORKERS = 6                 # polite concurrency against a county server
TIMEOUT = 25

# ---------------------------------------------------------------- pure parsing (unit-tested)
_TABLE_RE = re.compile(r'<table id="myTable".*?</table>', re.S | re.I)
_ROW_RE = re.compile(r"<tr>(.*?)</tr>", re.S | re.I)
_CELL_RE = re.compile(r"<td[^>]*>(.*?)</td>", re.S | re.I)
_TAG_RE = re.compile(r"<[^>]+>")
_NONDIGIT_RE = re.compile(r"[^\d]")


def _price(s) -> int | None:
    """'$54,850,000' -> 54850000 ; '$1' -> 1 ; '-'/''/None -> None."""
    if s is None:
        return None
    s = str(s).strip()
    if not s or s == "-":
        return None
    digits = _NONDIGIT_RE.sub("", s)
    return int(digits) if digits else None


def _date(s):
    """'11/01/2007' -> date(2007, 11, 1) ; '-'/''/garbage -> None."""
    if not s:
        return None
    s = str(s).strip()
    if not s or s == "-":
        return None
    try:
        return datetime.strptime(s, "%m/%d/%Y").date()
    except ValueError:
        return None


def parse_sales(html_text: str) -> list[dict]:
    """Extract the deed-history rows from a ViewParcelData page. Columns (8 <td>):
    [Owner1, Owner2, Owner1-as-of-Jan1, Owner2-as-of-Jan1, Deed, Deed Date, Sale Date, Sale Price].
    We keep deed + sale_date + sale_price (the owner-name cells are fixed-width split + unreliable).
    Rows without a parseable sale_date are dropped (can't anchor a hold period)."""
    m = _TABLE_RE.search(html_text)
    if not m:
        return []
    out = []
    for row in _ROW_RE.findall(m.group(0)):
        cells = [html.unescape(_TAG_RE.sub("", c)).strip() for c in _CELL_RE.findall(row)]
        if len(cells) != 8:                 # header is <th> (skipped); data rows have 8 <td>
            continue
        sd = _date(cells[6])
        if sd is None:
            continue
        price = _price(cells[7])
        out.append({
            "deed": cells[4] if cells[4] and cells[4] != "-" else "",
            "sale_date": sd,
            "sale_price": price,
            "is_nominal": price is None or price <= NOMINAL_MAX,
        })
    return out


def pick_arms_length(sales: list[dict], nominal_max: int = NOMINAL_MAX) -> dict | None:
    """The effective acquisition = most-recent sale whose price exceeds the nominal threshold.
    Returns None when the parcel has only nominal / unknown-price transfers -> keep the GIS sale."""
    arms = [s for s in sales if (s["sale_price"] or 0) > nominal_max]
    return max(arms, key=lambda s: s["sale_date"]) if arms else None


# ---------------------------------------------------------------- network
def _session() -> requests.Session:
    s = requests.Session()
    s.headers["User-Agent"] = UA
    retry = Retry(total=2, backoff_factor=0.4, status_forcelist=(429, 500, 502, 503, 504))
    s.mount("https://", HTTPAdapter(max_retries=retry))
    return s


def fetch_sales(apn: str, session: requests.Session) -> list[dict] | None:
    """Scrape one parcel's deed history. Returns the parsed rows, or None on a fetch error
    (caller logs + skips — the GIS sale stays as the fallback)."""
    try:
        r = session.get(PRC_SEARCH, params={"ParcelID": apn}, timeout=TIMEOUT)
        if r.status_code != 200:
            return None
        return parse_sales(r.text)
    except requests.RequestException:
        return None


# ---------------------------------------------------------------- DB
SALES_COLS = "apn,sale_date,sale_price,deed,is_nominal"


def stage(rows: list[tuple]) -> None:
    with cursor() as cur:
        cur.execute("TRUNCATE staging_assessor_sales")
        psycopg2.extras.execute_values(
            cur,
            f"INSERT INTO staging_assessor_sales ({SALES_COLS}) VALUES %s "
            "ON CONFLICT (apn, sale_date, deed) DO NOTHING",
            rows, page_size=500,
        )


def promote() -> int:
    """Set last_sale_* + hold_years to the most-recent ARM'S-LENGTH sale across BOTH sources:
    the GIS sale (staging_parcels) and the scraped deed history. We only override the GIS sale
    when the deed history is a genuine improvement — i.e. the GIS sale is nominal/missing, or the
    deed history has a NEWER real sale than the GIS one. (Sometimes the GIS feed carries a recent
    real sale the card's table doesn't list; in that case we keep the GIS sale and don't regress.)

    The decision is made against the GIS BASELINE in staging_parcels, not the live properties row,
    so this is idempotent — re-running can't drift. Returns the number of parcels actually changed."""
    with cursor() as cur:
        cur.execute("""
            WITH al AS (                                    -- deed-history arm's-length sale / parcel
              SELECT DISTINCT ON (apn) apn, sale_date, sale_price
              FROM staging_assessor_sales
              WHERE NOT is_nominal AND sale_date IS NOT NULL
              ORDER BY apn, sale_date DESC
            ), baseline AS (                                -- the GIS (energov) sale we're judging against
              SELECT apn,
                     CASE WHEN own_date_ms IS NOT NULL
                          THEN to_timestamp(own_date_ms/1000.0)::date END AS gis_date,
                     NULLIF(sale_price, 0) AS gis_price
              FROM staging_parcels
            ), chosen AS (
              SELECT al.apn, al.sale_date, al.sale_price
              FROM al JOIN baseline b USING (apn)
              WHERE b.gis_price IS NULL                     -- no GIS sale
                 OR b.gis_price <= %(nom)s                  -- GIS sale is a nominal/intra-entity transfer
                 OR b.gis_date IS NULL
                 OR al.sale_date > b.gis_date               -- deed history has a NEWER real sale
            ), upd AS (
              UPDATE properties pr SET
                last_sale_date  = c.sale_date,
                last_sale_price = c.sale_price,
                hold_years = ROUND(((extract(epoch from now())
                                     - extract(epoch from c.sale_date))
                                    / 31557600.0)::numeric, 1)
              FROM chosen c
              WHERE pr.apn = c.apn
                AND (pr.last_sale_date IS DISTINCT FROM c.sale_date
                     OR pr.last_sale_price IS DISTINCT FROM c.sale_price)
              RETURNING pr.apn
            )
            SELECT count(*) FROM upd
        """, {"nom": NOMINAL_MAX})
        return cur.fetchone()[0]


def main() -> int:
    print("pull_assessor_charleston: scraping assessor deed history (prcweb) ...")
    with cursor(commit=False) as cur:
        cur.execute("SELECT apn FROM parcels ORDER BY apn")
        apns = [r[0] for r in cur.fetchall()]
    if not apns:
        print("  no parcels — run pull_parcels_charleston first."); return 0

    rows: list[tuple] = []
    # max_fail_rate 0.35: a handful of parcels (11-digit sub-parcels, not-on-portal) legitimately
    # don't resolve and just keep their GIS sale; >1/3 failing means the portal moved/broke -> abort.
    with JobRun("pull_assessor_charleston", max_fail_rate=0.35) as job:
        session = _session()
        n_with_sales = 0
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futs = {pool.submit(fetch_sales, apn, session): apn for apn in apns}
            for fut in as_completed(futs):
                apn = futs[fut]
                sales = fut.result()
                if sales is None:               # fetch error -> skip (GIS sale stays)
                    job.fail("fetch/parse failed", ref=apn); continue
                job.ok()
                if sales:
                    n_with_sales += 1
                for s in sales:
                    rows.append((apn, s["sale_date"], s["sale_price"], s["deed"], s["is_nominal"]))
        print(f"  scraped {job.ok_count} parcels ok ({job.fail_count} failed); "
              f"{n_with_sales} have deed history, {len(rows)} sale rows total")
        stage(rows)
        changed = promote()
        print(f"  hold_years / last_sale corrected on {changed} parcels "
              f"(most-recent > ${NOMINAL_MAX:,} sale; nominal-only parcels keep the GIS sale)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
