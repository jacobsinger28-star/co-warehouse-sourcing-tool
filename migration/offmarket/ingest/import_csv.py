#!/usr/bin/env python3
"""
import_csv.py — generic importer for founder-dropped files in /imports (Day 4).

Currently handles the Davidson County Trustee delinquent-tax file
(imports/trustee_delinquent.csv). The file's exact columns are unknown until the
founder sources it, so mapping is heuristic-by-header with the raw row preserved
in JSONB — when the real file arrives, no code change should be needed (brief
requirement); worst case the heuristics get one new alias added.

Pipeline contract: if the file is absent this exits 0 with a note. The
tax_delinquency component simply scores 0 (weights.yaml note) — never blocks.

Idempotent: rows for a given source filename are replaced wholesale on re-import.

    python ingest/import_csv.py --dir ./imports
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from datetime import datetime
from pathlib import Path

import psycopg2.extras

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib.db import JobRun, cursor  # noqa: E402
from lib.normalize_text import norm_apn  # noqa: E402

# Header aliases, lowercased, non-alphanumerics stripped. First match wins.
APN_HEADERS = ("apn", "parcelid", "parcel", "mapparcel", "mapandparcel", "parcelnumber")
OWNER_HEADERS = ("owner", "ownername", "name", "taxpayer", "taxpayername")
AMOUNT_HEADERS = ("amountowed", "amountdue", "totaldue", "balance", "baseamount",
                  "total", "amount", "taxdue")
YEAR_HEADERS = ("taxyear", "year", "taxyears", "yearsdelinquent")


def _norm_header(h: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (h or "").lower())


def _pick(headers: dict[str, str], candidates: tuple[str, ...]) -> str | None:
    for c in candidates:
        if c in headers:
            return headers[c]
    return None


def _money(v: str | None) -> float | None:
    if not v:
        return None
    s = re.sub(r"[^0-9.\-]", "", v)
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _years_delinquent(v: str | None) -> int | None:
    """Best-effort count of delinquent years from the founder file's year cell.

    The file's shape is unknown until it arrives, so handle the plausible forms:
      * a list of 4-digit years ("2019, 2020, 2021")          -> distinct count (3)
      * an explicit range ("2019-2021" / "2019–2021")         -> inclusive span (3)
      * a bare count ("3")                                     -> that integer
      * anything unrecognizable                                -> None (scores 0)
    The SQL side floors a matched-but-uncountable APN at 1 (presence in the Trustee
    file => at least one year delinquent), so None here never under-counts a real
    delinquency to 0 — it just declines to guess the tier. Calibrate when file lands.
    """
    if v is None:
        return None
    s = str(v).strip()
    if not s:
        return None
    found = re.findall(r"(?:19|20)\d{2}", s)
    if found:
        ys = sorted({int(y) for y in found})
        if len(ys) == 2 and re.search(r"\d{4}\s*[-–]\s*\d{4}", s):
            return ys[1] - ys[0] + 1  # explicit "YYYY-YYYY" range
        return len(ys)
    if re.fullmatch(r"\d{1,2}", s):
        return int(s)
    return None


def _parse_date(v: str | None):
    """Parse a founder-supplied date cell. Returns a date or None (column is
    nullable). Tries ISO + the common US formats the Register-of-Deeds export uses."""
    if not v:
        return None
    s = str(v).strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%Y/%m/%d", "%m-%d-%Y", "%d-%b-%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    try:
        return datetime.fromisoformat(s).date()
    except ValueError:
        return None


def import_trustee(path: Path, job: JobRun) -> int:
    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        if not reader.fieldnames:
            raise RuntimeError(f"{path.name}: no header row")
        headers = {_norm_header(h): h for h in reader.fieldnames}
        apn_col = _pick(headers, APN_HEADERS)
        if not apn_col:
            raise RuntimeError(
                f"{path.name}: no APN-like column among {reader.fieldnames} — "
                f"add the header alias to import_csv.py APN_HEADERS")
        owner_col = _pick(headers, OWNER_HEADERS)
        amount_col = _pick(headers, AMOUNT_HEADERS)
        year_col = _pick(headers, YEAR_HEADERS)
        print(f"  column mapping: apn={apn_col!r} owner={owner_col!r} "
              f"amount={amount_col!r} year={year_col!r}")

        rows = []
        for raw in reader:
            apn = norm_apn(raw.get(apn_col))
            if not apn:
                job.fail("row without APN", ref=str(raw)[:60])
                continue
            year_val = raw.get(year_col) if year_col else None
            rows.append((
                raw.get(apn_col), apn,
                raw.get(owner_col) if owner_col else None,
                _money(raw.get(amount_col)) if amount_col else None,
                _years_delinquent(year_val), year_val,
                path.name, json.dumps(raw),
            ))
            job.ok()

    with cursor() as cur:
        cur.execute("DELETE FROM staging_tax_delinquency WHERE source_file = %s",
                    (path.name,))
        psycopg2.extras.execute_values(
            cur,
            """
            INSERT INTO staging_tax_delinquency
              (apn_raw, apn_norm, owner_name, amount_owed, years_delinquent,
               tax_years, source_file, raw)
            VALUES %s
            """,
            rows, page_size=1000,
        )
    print(f"  {path.name}: {len(rows)} rows imported")
    with cursor(dict_rows=True, commit=False) as cur:
        cur.execute(
            """
            SELECT count(DISTINCT t.apn_norm) AS matched
            FROM staging_tax_delinquency t
            JOIN parcels p ON p.apn = t.apn_norm
            WHERE t.source_file = %s
            """, (path.name,))
        print(f"  matched to our parcels: {cur.fetchone()['matched']} APNs")
    return len(rows)


def import_sos_contacts(path: Path, job: JobRun) -> int:
    """imports/sos_contacts.csv -> contacts (source='sos_manual').

    Resolves an owner ENTITY (an LLC/trust/corp you can't skip-trace) to a human
    name + role, so that person joins the next skip-trace upload. No phone yet —
    those arrive later under source 'batchskiptracing'. Idempotent per (entity,
    source). Contract (docs/SOS_SOP.md):
        entity_id, person_name, role, mailing_street, mailing_city, mailing_state, mailing_zip
    """
    with cursor(dict_rows=True, commit=False) as cur:
        cur.execute("SELECT entity_id FROM entities")
        valid_ids = {r["entity_id"] for r in cur.fetchall()}

    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        if not reader.fieldnames:
            raise RuntimeError(f"{path.name}: no header row")
        h = {_norm_header(c): c for c in reader.fieldnames}
        eid_col = _pick(h, ("entityid", "entity"))
        name_col = _pick(h, ("personname", "name", "registeredagent", "agent", "officer"))
        role_col = _pick(h, ("role", "capacity", "type"))
        if not (eid_col and name_col):
            raise RuntimeError(
                f"{path.name}: need an entity_id and a person_name column "
                f"(got {reader.fieldnames}) — see docs/SOS_SOP.md")
        rows = []
        for raw in reader:
            eid = (raw.get(eid_col) or "").strip()
            if not eid.isdigit() or int(eid) not in valid_ids:
                job.fail("entity_id missing/unknown in entities", ref=eid or raw.get(name_col))
                continue
            person = (raw.get(name_col) or "").strip()
            if not person:
                job.fail("no person_name", ref=eid)
                continue
            role = (raw.get(role_col) or "").strip().lower() if role_col else ""
            rows.append((int(eid), person, role or "registered_agent",
                         [], [], "sos_manual", "medium"))
            job.ok()

    with cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            """
            INSERT INTO contacts
              (entity_id, person_name, role, phones, emails, source, confidence)
            VALUES %s
            ON CONFLICT (entity_id, source) DO UPDATE SET
              person_name = EXCLUDED.person_name, role = EXCLUDED.role,
              confidence = EXCLUDED.confidence
            """,
            rows, page_size=500,
        )
    print(f"  {path.name}: {len(rows)} SOS-resolved people upserted into contacts "
          f"(source=sos_manual; they join the next skiptrace-export)")
    return len(rows)


def import_lis_pendens(path: Path, job: JobRun) -> int:
    """imports/lis_pendens.csv -> distress_signals (type='lis_pendens').

    A pre-foreclosure / trustee-sale filing — a strong motivation flag that's
    invisible to the automated feeds. Surfaced on call sheets (NOT scored — there
    is no lis_pendens weights component by design; it's a human priority flag).
    Idempotent per (apn, type, source_ref), the same uniq key the feeds upsert on.
    source_ref is REQUIRED — no unsourced signals, ever. Contract (docs/SOS_SOP.md):
        apn, detail, event_date, source_ref
    """
    with cursor(dict_rows=True, commit=False) as cur:
        cur.execute("SELECT apn FROM parcels")
        valid_apns = {r["apn"] for r in cur.fetchall()}

    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        if not reader.fieldnames:
            raise RuntimeError(f"{path.name}: no header row")
        h = {_norm_header(c): c for c in reader.fieldnames}
        apn_col = _pick(h, ("apn", "parcel", "parcelid", "mapparcel"))
        detail_col = _pick(h, ("detail", "description", "instrument", "instrumenttype",
                               "note", "notes"))
        date_col = _pick(h, ("eventdate", "date", "filingdate", "recordeddate"))
        ref_col = _pick(h, ("sourceref", "source", "documentnumber", "instrumentnumber",
                            "docnumber", "url"))
        if not (apn_col and ref_col):
            raise RuntimeError(
                f"{path.name}: need apn and source_ref columns (got {reader.fieldnames}) "
                f"— every signal needs a source; see docs/SOS_SOP.md")
        rows = []
        for raw in reader:
            apn = norm_apn(raw.get(apn_col))
            ref = (raw.get(ref_col) or "").strip()
            if not apn or apn not in valid_apns:
                job.fail("apn missing or not in parcels", ref=raw.get(apn_col))
                continue
            if not ref:
                job.fail("no source_ref (required)", ref=apn)
                continue
            detail = ((raw.get(detail_col) or "").strip() if detail_col else "")
            rows.append((apn, "lis_pendens", detail or "lis pendens / pre-foreclosure filing",
                         _parse_date(raw.get(date_col) if date_col else None), ref))
            job.ok()

    with cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            """
            INSERT INTO distress_signals (apn, type, detail, event_date, source_ref)
            VALUES %s
            ON CONFLICT (apn, type, source_ref) DO UPDATE SET
              detail = EXCLUDED.detail, event_date = EXCLUDED.event_date
            """,
            rows, page_size=500,
        )
    print(f"  {path.name}: {len(rows)} lis-pendens signals upserted into distress_signals")
    return len(rows)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default="./imports")
    args = ap.parse_args()
    imports_dir = Path(args.dir)

    # Each founder-dropped CSV is optional and independent; a missing file is a
    # logged skip (never an error — the pipeline must stay green before the founder
    # supplies them). Each handled file gets its own job_runs row.
    handlers = [
        ("trustee_delinquent.csv", "import_csv", import_trustee,
         "tax_delinquency scores 0; founder supplies file, see FOUNDER_INPUTS.md"),
        ("sos_contacts.csv", "import_sos_contacts", import_sos_contacts,
         "no SOS-resolved owners yet; run the SOS SOP first, see docs/SOS_SOP.md"),
        ("lis_pendens.csv", "import_lis_pendens", import_lis_pendens,
         "no lis-pendens filings recorded yet, see docs/SOS_SOP.md"),
    ]
    found = False
    for fname, job_name, handler, skip_note in handlers:
        path = imports_dir / fname
        if not path.exists():
            print(f"import_csv: {path} not present — skipping ({skip_note})")
            continue
        found = True
        print(f"import_csv: importing {path} ...")
        with JobRun(job_name) as job:
            handler(path, job)
    if not found:
        print(f"import_csv: no founder CSVs present in {imports_dir} — nothing to do")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
