#!/usr/bin/env python3
"""Validate a deal-index.csv against the Stage 0 quality bar.

The chatbot and the F4 dedupe spine are only as good as this file. A fabricated
cap rate or a thin row poisons every answer downstream, and the failure is
silent — the bot sounds confident and is wrong. This script makes the
"Quality bar" section of claude-project/deal-archive-spec.md mechanical:

  * the header matches the canonical schema exactly (INSTRUCTIONS.md assumes it),
  * controlled-vocab columns only contain allowed values,
  * the dedupe-critical columns are populated on every row,
  * every LOI'd / under-contract / closed deal carries a source document,
  * deal_ids are unique, well-formed slugs,
  * numbers parse and dates are real, ordered ISO dates,
  * cross-field rules hold (why_passed_tag iff the deal was passed, etc.).

Stdlib only — no venv required. Run it before every Claude Project re-upload:

    python3 tools/validate_index.py data/deal-index.csv

Exit code 0 = clean (warnings allowed), 1 = errors found (or warnings under
--strict), 2 = the file could not be read/parsed at all.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import re
import sys
from dataclasses import dataclass

# --- canonical schema -------------------------------------------------------
# Order matters: INSTRUCTIONS.md and the dedupe lookup both assume this exact
# header. Keep in sync with docs/ARCHITECTURE.md and deal-archive-spec.md.
CANONICAL_HEADER = [
    "deal_id", "address", "city", "state", "submarket", "asset_type",
    "sqft_or_units", "owner_entity", "owner_principals", "broker",
    "listing_source", "stage", "first_touch", "last_touch",
    "relationship_owner", "ask_price", "our_offer", "cap_rate",
    "price_per_sqft", "key_terms", "outcome_status", "why_passed_tag",
    "why_passed_notes", "source_docs", "pipedrive_id",
]

# --- controlled vocabularies (from deal-archive-spec.md field notes) --------
ASSET_TYPES = {
    "industrial", "multifamily", "retail", "office", "hospitality",
    "IOS", "carwash", "other",
}
STAGES = {
    "sourced", "contacted", "LOI", "under_contract", "passed", "closed", "dead",
}
OUTCOME_STATUSES = {"active", "passed", "closed_won", "dead"}
WHY_PASSED_TAGS = {
    "price", "cap_rate", "location", "condition", "financing",
    "seller_terms", "competition", "timing", "other",
}

# Stages that, per the quality bar, must have produced a document.
DOC_REQUIRED_STAGES = {"LOI", "under_contract", "closed"}

# Columns that power dedupe — must be present on every row (quality bar).
REQUIRED_NONEMPTY = ["deal_id", "address", "owner_entity", "stage", "outcome_status"]

DEAL_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
US_STATES = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID",
    "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS",
    "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
    "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
    "WI", "WY", "DC", "PR",
}

ERROR, WARN = "ERROR", "WARN"


@dataclass
class Issue:
    level: str          # ERROR | WARN
    line: int           # 1-based line number in the file (header is line 1); 0 = file-level
    column: str         # column name or "" for row/file-level issues
    message: str

    def __str__(self) -> str:
        where = f"line {self.line}" if self.line else "file"
        col = f" [{self.column}]" if self.column else ""
        return f"  {self.level:5} {where}{col}: {self.message}"


def _num(raw: str):
    """Parse a money/number cell, tolerating $ , and surrounding space. None on failure."""
    cleaned = raw.strip().lstrip("$").replace(",", "").replace("%", "")
    if cleaned == "":
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _date(raw: str):
    """Parse an ISO date (YYYY-MM-DD). None if blank or malformed."""
    s = raw.strip()
    if s == "":
        return None
    try:
        return dt.date.fromisoformat(s)
    except ValueError:
        return None


def validate_rows(header: list[str], rows: list[list[str]]) -> list[Issue]:
    """Core validation over already-parsed data. File-agnostic so tests can drive it."""
    issues: list[Issue] = []

    # --- header ---
    if header != CANONICAL_HEADER:
        missing = [c for c in CANONICAL_HEADER if c not in header]
        extra = [c for c in header if c not in CANONICAL_HEADER]
        if missing:
            issues.append(Issue(ERROR, 1, "", f"missing column(s): {', '.join(missing)}"))
        if extra:
            issues.append(Issue(ERROR, 1, "", f"unexpected column(s): {', '.join(extra)}"))
        if not missing and not extra:
            issues.append(Issue(ERROR, 1, "",
                                "columns are out of order — must match the canonical schema exactly"))
        # Can't reliably map cells to fields if the header is wrong; stop here.
        return issues

    seen_ids: dict[str, int] = {}

    for i, row in enumerate(rows):
        line = i + 2  # +1 for header, +1 for 1-based

        # normalise row width
        if len(row) != len(CANONICAL_HEADER):
            issues.append(Issue(ERROR, line, "",
                                f"has {len(row)} fields, expected {len(CANONICAL_HEADER)}"))
            # pad/trim so downstream column access doesn't crash
            row = (row + [""] * len(CANONICAL_HEADER))[:len(CANONICAL_HEADER)]

        cell = dict(zip(CANONICAL_HEADER, (c.strip() for c in row)))

        # skip a fully blank line silently
        if not any(cell.values()):
            continue

        # --- required-for-dedupe columns ---
        for col in REQUIRED_NONEMPTY:
            if cell[col] == "":
                issues.append(Issue(ERROR, line, col, "required (powers dedupe) but empty"))

        # --- deal_id shape + uniqueness ---
        did = cell["deal_id"]
        if did:
            if not DEAL_ID_RE.match(did):
                issues.append(Issue(ERROR, line, "deal_id",
                                    f"'{did}' is not a lowercase-hyphenated slug "
                                    "(e.g. park-ave-bayharbor-2022)"))
            if did in seen_ids:
                issues.append(Issue(ERROR, line, "deal_id",
                                    f"duplicate of line {seen_ids[did]} — merge the rows"))
            else:
                seen_ids[did] = line

        # --- controlled vocabularies ---
        if cell["asset_type"] and cell["asset_type"] not in ASSET_TYPES:
            issues.append(Issue(ERROR, line, "asset_type",
                                f"'{cell['asset_type']}' not in {sorted(ASSET_TYPES)}"))
        stage = cell["stage"]
        if stage and stage not in STAGES:
            issues.append(Issue(ERROR, line, "stage", f"'{stage}' not in {sorted(STAGES)}"))
        outcome = cell["outcome_status"]
        if outcome and outcome not in OUTCOME_STATUSES:
            issues.append(Issue(ERROR, line, "outcome_status",
                                f"'{outcome}' not in {sorted(OUTCOME_STATUSES)}"))
        wpt = cell["why_passed_tag"]
        if wpt and wpt not in WHY_PASSED_TAGS:
            issues.append(Issue(ERROR, line, "why_passed_tag",
                                f"'{wpt}' not in {sorted(WHY_PASSED_TAGS)}"))

        # --- source-doc coverage (quality bar) ---
        needs_doc = stage in DOC_REQUIRED_STAGES or outcome == "closed_won"
        if needs_doc and cell["source_docs"] == "":
            issues.append(Issue(ERROR, line, "source_docs",
                                f"{stage or outcome} deal must cite a source document"))

        # --- cross-field consistency ---
        if outcome == "passed" and wpt == "":
            issues.append(Issue(WARN, line, "why_passed_tag",
                                "deal was passed but no reason tagged — the bot's best column"))
        if wpt and outcome != "passed":
            issues.append(Issue(WARN, line, "why_passed_tag",
                                f"set on a '{outcome or 'blank'}' deal — only passed deals pass for a reason"))

        # --- numbers ---
        for col in ("ask_price", "our_offer", "price_per_sqft", "sqft_or_units"):
            if cell[col] and _num(cell[col]) is None:
                issues.append(Issue(ERROR, line, col, f"'{cell[col]}' is not a number"))
        cap_raw = cell["cap_rate"]
        if cap_raw:
            cap = _num(cap_raw)
            if cap is None:
                issues.append(Issue(ERROR, line, "cap_rate", f"'{cap_raw}' is not a number"))
            elif not (1.0 <= cap <= 20.0):
                issues.append(Issue(WARN, line, "cap_rate",
                                    f"{cap} is outside the plausible 1–20% range — typo?"))
        ask, offer = _num(cell["ask_price"]), _num(cell["our_offer"])
        if ask is not None and offer is not None and offer > ask:
            issues.append(Issue(WARN, line, "our_offer",
                                f"our_offer ({offer:g}) exceeds ask_price ({ask:g}) — verify"))
        pid = cell["pipedrive_id"]
        if pid and not pid.isdigit():
            issues.append(Issue(WARN, line, "pipedrive_id", f"'{pid}' is not an integer id"))

        # --- dates ---
        ft_raw, lt_raw = cell["first_touch"], cell["last_touch"]
        ft = lt = None
        for col, raw in (("first_touch", ft_raw), ("last_touch", lt_raw)):
            if raw:
                parsed = _date(raw)
                if parsed is None:
                    issues.append(Issue(ERROR, line, col, f"'{raw}' is not an ISO date (YYYY-MM-DD)"))
                elif col == "first_touch":
                    ft = parsed
                else:
                    lt = parsed
        if ft and lt and lt < ft:
            issues.append(Issue(WARN, line, "last_touch",
                                f"last_touch ({lt}) precedes first_touch ({ft})"))

        # --- state code (soft) ---
        st = cell["state"]
        if st and st not in US_STATES:
            issues.append(Issue(WARN, line, "state",
                                f"'{st}' is not a 2-letter US state code"))

    return issues


def validate_file(path: str) -> tuple[int, list[Issue]]:
    """Read and validate a CSV file. Returns (data_row_count, issues)."""
    try:
        with open(path, newline="", encoding="utf-8-sig") as fh:
            reader = list(csv.reader(fh))
    except FileNotFoundError:
        return 0, [Issue(ERROR, 0, "", f"file not found: {path}")]
    except OSError as exc:
        return 0, [Issue(ERROR, 0, "", f"could not read {path}: {exc}")]
    except UnicodeDecodeError as exc:
        return 0, [Issue(ERROR, 0, "", f"{path} is not valid UTF-8: {exc}")]

    if not reader:
        return 0, [Issue(ERROR, 0, "", "file is empty — expected a header row")]

    header, rows = reader[0], reader[1:]
    return len(rows), validate_rows(header, rows)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("path", help="path to deal-index.csv")
    parser.add_argument("--strict", action="store_true",
                        help="treat warnings as errors (nonzero exit if any warning)")
    args = parser.parse_args(argv)

    count, issues = validate_file(args.path)
    errors = [x for x in issues if x.level == ERROR]
    warns = [x for x in issues if x.level == WARN]

    for issue in issues:
        print(issue)

    print()
    print(f"{args.path}: {count} data row(s), {len(errors)} error(s), {len(warns)} warning(s)")

    if errors:
        print("FAILED — fix the input (the index/docs), not the bot's prompt.")
        return 1
    if warns and args.strict:
        print("FAILED (--strict) — warnings present.")
        return 1
    print("OK — meets the Stage 0 quality bar." if not warns
          else "OK with warnings — review the lines above.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
