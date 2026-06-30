#!/usr/bin/env python3
"""
pull_cama_columbus.py — fill Columbus year_built (+ clear height) from the Auditor bulk CAMA.

  Franklin County Auditor "Appraisal" bulk download -> Build.xlsx (commercial-building table)
    -> properties.year_built, properties.clear_height_est

THE BACKSTORY (BUILD_LOG §16 said year_built was "unavailable in any open feed" — that was
WRONG, corrected §17). Franklin County's open GIS publishes commercial SF + value but not
commercial year-built. That attribute DOES live in a free, parcel-keyed bulk file: the Auditor's
monthly CAMA "Appraisal" export. The earlier 403 was a stale FTP path + a missing User-Agent —
the real file at apps.franklincountyauditor.com/Outside_User_Files/<YYYY>/<date> Appraisal/Build.xlsx
returns 200 to any browser UA, no auth, no key. Verified: 10/10 sample industrial APNs got a real
YRBLT (cross-checked against the live Auditor commercial datalet).

Build.xlsx is one row PER BUILDING CARD (~66k rows); we aggregate to one row per parcel by taking
the LARGEST card (by AREA) that has a valid year — matching Charlotte's "year of the largest
building" rule. That card's WALLHGT (recorded wall height, feet) is a clear-height value — more
authoritative than Nashville's LiDAR estimate — stored as clear_height_est / clear_height_source
='auditor'. Join: the file's "PARCEL ID" ('010-000005-00') drops the '-00' card suffix to our apn.

    MARKET=columbus python ingest/pull_cama_columbus.py
"""
from __future__ import annotations

import re
import sys
from datetime import date
from pathlib import Path

import psycopg2.extras
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib.db import JobRun, cursor  # noqa: E402
from lib.market import load_market  # noqa: E402

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124 Safari/537.36")
CACHE_DIR = Path(__file__).resolve().parent.parent / "image_cache" / "cama_columbus"
YEAR_MIN, YEAR_MAX = 1850, date.today().year + 1
WALLHGT_MIN, WALLHGT_MAX = 5, 200          # sane feet bounds for a clear-height value
_APPRAISAL_RE = re.compile(r'href="([^"]*?(\d{4}-\d{2}-\d{2})[^"]*?Appraisal[^"]*/)"', re.I)


def _base() -> str:
    src = load_market("columbus")["sources"]
    base = src.get("auditor_cama_base")
    if not base:
        raise RuntimeError("markets/columbus.yaml sources.auditor_cama_base is not set")
    return base.rstrip("/")


def discover_build_url() -> tuple[str, str]:
    """Find the latest '<date> Appraisal' folder and return (Build.xlsx URL, folder tag)."""
    base = _base()
    for yr in (date.today().year, date.today().year - 1):
        r = requests.get(f"{base}/{yr}/", headers={"User-Agent": UA}, timeout=60)
        if r.status_code != 200:
            continue
        folders = _APPRAISAL_RE.findall(r.text)          # [(href, 'YYYY-MM-DD'), ...]
        if not folders:
            continue
        href, tag = max(folders, key=lambda f: f[1])      # latest by date prefix
        href = href if href.startswith("http") else base.split("/Outside_User_Files")[0] + href
        return href.rstrip("/") + "/Build.xlsx", f"{yr}_{tag}"
    raise RuntimeError(f"no 'Appraisal' folder found under {base}/<year>/ — check the source URL")


def fetch_xlsx() -> Path:
    """Download Build.xlsx for the latest Appraisal folder (cached by folder tag)."""
    url, tag = discover_build_url()
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    dest = CACHE_DIR / f"{tag}_Build.xlsx"
    if dest.exists() and dest.stat().st_size > 100_000:
        print(f"  using cached CAMA file: {dest.name}")
        return dest
    print(f"  downloading {url}")
    r = requests.get(url, headers={"User-Agent": UA}, timeout=180)
    r.raise_for_status()
    dest.write_bytes(r.content)
    print(f"  saved {dest.name} ({len(r.content)//1024} KB)")
    return dest


def _apn(raw) -> str | None:
    """File 'PARCEL ID' ('010-000005-00') -> our dashed apn ('010-000005')."""
    d = re.sub(r"\D", "", str(raw or ""))
    return f"{d[:3]}-{d[3:9]}" if len(d) >= 9 else None


def _int(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def aggregate(xlsx: Path) -> list[tuple]:
    """One row per parcel: the largest valid-year card's (year_built, clear_height)."""
    import openpyxl
    wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)
    ws = wb.active
    it = ws.iter_rows(values_only=True)
    hdr = [str(h).strip() if h is not None else "" for h in next(it)]
    col = {h: i for i, h in enumerate(hdr)}
    for need in ("PARCEL ID", "YRBLT", "AREA", "WALLHGT"):
        if need not in col:
            raise RuntimeError(f"Build.xlsx missing expected column '{need}' (cols: {hdr})")
    ip, iy, ia, iw = col["PARCEL ID"], col["YRBLT"], col["AREA"], col["WALLHGT"]
    ipc, ifu = col.get("PHYCOND"), col.get("FUNCUTIL")   # condition + functional obsolescence (optional)
    SEV = {"P": 2, "F": 1}                                # Poor > Fair; A(verage)/G(ood) -> 0

    best: dict[str, tuple] = {}     # apn -> (area, year, wallhgt) for the largest valid-year card
    worst: dict[str, int] = {}      # apn -> worst condition severity across ALL its cards
    rows = 0
    for r in it:
        rows += 1
        apn = _apn(r[ip])
        if apn is None:
            continue
        # condition: take the WORST severity across all cards (any poor building flags the parcel),
        # independent of whether the year is valid.
        if ipc is not None or ifu is not None:
            pc = str(r[ipc] or "").strip().upper() if ipc is not None else ""
            fu = str(r[ifu] or "").strip().upper() if ifu is not None else ""
            sev = max(SEV.get(pc, 0), SEV.get(fu, 0))
            if sev > worst.get(apn, 0):
                worst[apn] = sev
        # year/clear-height: largest valid-year card
        yr = _int(r[iy])
        if yr is None or not (YEAR_MIN <= yr <= YEAR_MAX):
            continue
        area = _int(r[ia]) or 0
        wall = _int(r[iw])
        wall = wall if (wall and WALLHGT_MIN <= wall <= WALLHGT_MAX) else None
        cur = best.get(apn)
        if cur is None or area > cur[0]:
            best[apn] = (area, yr, wall)
    wb.close()
    year_records = [(apn, yr, wall) for apn, (_, yr, wall) in best.items()]
    condition = {apn: ("poor" if s == 2 else "fair") for apn, s in worst.items() if s > 0}
    print(f"  parsed {rows} card rows -> {len(year_records)} parcels with a valid year; "
          f"{len(condition)} with poor/fair condition")
    return year_records, condition


def apply(records: list[tuple], job: JobRun) -> None:
    """Update year_built + clear_height_est for parcels we actually have (UPDATE..FROM joins)."""
    with cursor() as cur:
        cur.execute("""
            CREATE TEMP TABLE _cama (apn text PRIMARY KEY, year_built int, clear_ft numeric)
            ON COMMIT DROP
        """)
        psycopg2.extras.execute_values(
            cur, "INSERT INTO _cama (apn, year_built, clear_ft) VALUES %s "
                 "ON CONFLICT (apn) DO NOTHING", records, page_size=1000)
        cur.execute("""
            UPDATE properties p SET
              year_built = c.year_built,
              clear_height_est = COALESCE(c.clear_ft, p.clear_height_est),
              clear_height_source = CASE WHEN c.clear_ft IS NOT NULL THEN 'auditor'
                                         ELSE p.clear_height_source END
            FROM _cama c WHERE c.apn = p.apn
        """)
        n_props = cur.rowcount
        cur.execute("SELECT count(*) FROM properties pr JOIN parcels pa USING(apn) "
                    "WHERE (pa.in_universe OR pa.manual_review) AND pr.year_built IS NOT NULL")
        n_univ = cur.fetchone()[0]
        cur.execute("SELECT count(*) FROM properties pr JOIN parcels pa USING(apn) "
                    "WHERE (pa.in_universe OR pa.manual_review) AND pr.clear_height_source='auditor'")
        n_clr = cur.fetchone()[0]
    job.ok(n_props)
    print(f"  year_built set on {n_props} properties "
          f"({n_univ} in universe/manual); clear height on {n_clr} universe/manual parcels")


def emit_condition_signals(condition: dict[str, str]) -> None:
    """Poor/fair assessor condition -> distress_signals(type='poor_condition') for gated parcels.
    Surfaces on call sheets/dashboard AND feeds the condition_distress score component (score.py
    reads the severity from the detail prefix). Delete-stale + upsert so improvements clear."""
    from lib.market import sources
    src = (sources().get("auditor_cama_base") or "auditor_cama") + "#condition"
    with cursor() as cur:
        cur.execute("SELECT apn FROM parcels WHERE in_universe OR manual_review")
        gated = {r[0] for r in cur.fetchall()}
        rows = [(apn, "poor_condition",
                 f"{sev} — assessor CAMA physical condition / functional obsolescence", None, src)
                for apn, sev in condition.items() if apn in gated]
        keep = [r[0] for r in rows] or [""]
        cur.execute("DELETE FROM distress_signals WHERE type='poor_condition' "
                    "AND source_ref=%s AND apn <> ALL(%s)", (src, keep))
        n_del = cur.rowcount
        psycopg2.extras.execute_values(
            cur,
            "INSERT INTO distress_signals (apn, type, detail, event_date, source_ref) VALUES %s "
            "ON CONFLICT (apn, type, source_ref) DO UPDATE SET detail = EXCLUDED.detail",
            rows, page_size=500)
    n_poor = sum(1 for apn, sev in condition.items() if apn in gated and sev == "poor")
    print(f"  poor_condition signals: {len(rows)} gated ({n_poor} poor, {len(rows)-n_poor} fair), "
          f"{n_del} stale removed")


def main() -> int:
    print("pull_cama_columbus: Auditor bulk CAMA -> year_built + clear height + condition ...")
    with cursor(commit=False) as cur:
        cur.execute("SELECT count(*) FROM parcels")
        if cur.fetchone()[0] == 0:
            raise RuntimeError("parcels table is empty — run pull_parcels_columbus first")
    with JobRun("pull_cama_columbus") as job:
        xlsx = fetch_xlsx()
        year_records, condition = aggregate(xlsx)
        if not year_records:
            raise RuntimeError("no year-built records parsed — Build.xlsx schema may have changed")
        apply(year_records, job)
        emit_condition_signals(condition)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
