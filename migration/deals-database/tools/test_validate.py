#!/usr/bin/env python3
"""Tests for validate_index.py. Stdlib only:  python3 tools/test_validate.py

Drives the importable core (validate_rows) with in-memory data for determinism,
and runs the CLI path against the checked-in fixtures.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import validate_index as v

HEADER = v.CANONICAL_HEADER

# A clean baseline row keyed by column, so each test mutates one field.
GOOD = {
    "deal_id": "park-ave-bayharbor-2022", "address": "1100 Park Ave",
    "city": "Bay Harbor Islands", "state": "FL", "submarket": "North Beaches",
    "asset_type": "retail", "sqft_or_units": "12000",
    "owner_entity": "Park Ave Holdings LLC", "owner_principals": "J. Example",
    "broker": "", "listing_source": "reonomy", "stage": "LOI",
    "first_touch": "2022-03-10", "last_touch": "2022-05-02",
    "relationship_owner": "Aaron", "ask_price": "4800000", "our_offer": "4200000",
    "cap_rate": "5.8", "price_per_sqft": "350", "key_terms": "60-day DD",
    "outcome_status": "passed", "why_passed_tag": "price",
    "why_passed_notes": "seller held firm", "source_docs": "LOI.pdf",
    "pipedrive_id": "10231",
}


def row(**overrides):
    cell = dict(GOOD, **overrides)
    return [cell[c] for c in HEADER]


def check(rows, header=HEADER):
    issues = v.validate_rows(header, rows)
    errs = [i for i in issues if i.level == v.ERROR]
    warns = [i for i in issues if i.level == v.WARN]
    return errs, warns


PASSED = FAILED = 0


def expect(name, cond):
    global PASSED, FAILED
    if cond:
        PASSED += 1
    else:
        FAILED += 1
        print(f"  FAIL: {name}")


# --- the clean row is clean -------------------------------------------------
errs, warns = check([row()])
expect("clean row -> no errors", not errs)
expect("clean row -> no warnings", not warns)

# --- header checks ----------------------------------------------------------
errs, _ = check([row()], header=HEADER[:-1])
expect("missing column -> error", any("missing column" in e.message for e in errs))

errs, _ = check([row() + ["x"]], header=HEADER + ["x"])
expect("extra column -> error", any("unexpected column" in e.message for e in errs))

reordered = [HEADER[1], HEADER[0]] + HEADER[2:]
errs, _ = check([row()], header=reordered)
expect("reordered header -> error", any("out of order" in e.message for e in errs))

# --- required-for-dedupe ----------------------------------------------------
errs, _ = check([row(owner_entity="")])
expect("blank owner_entity -> error", any(e.column == "owner_entity" for e in errs))

errs, _ = check([row(address="")])
expect("blank address -> error", any(e.column == "address" for e in errs))

# --- deal_id shape + uniqueness --------------------------------------------
errs, _ = check([row(deal_id="Bad_ID_2021")])
expect("bad slug -> error", any(e.column == "deal_id" and "slug" in e.message for e in errs))

errs, _ = check([row(), row()])
expect("duplicate deal_id -> error", any("duplicate" in e.message for e in errs))

# --- controlled vocab -------------------------------------------------------
errs, _ = check([row(asset_type="warehouse")])
expect("bad asset_type -> error", any(e.column == "asset_type" for e in errs))

errs, _ = check([row(stage="negotiating")])
expect("bad stage -> error", any(e.column == "stage" for e in errs))

errs, _ = check([row(outcome_status="won")])
expect("bad outcome_status -> error", any(e.column == "outcome_status" for e in errs))

errs, _ = check([row(why_passed_tag="too_expensive")])
expect("bad why_passed_tag -> error", any(e.column == "why_passed_tag" for e in errs))

# --- source-doc coverage ----------------------------------------------------
errs, _ = check([row(source_docs="")])
expect("LOI without source_doc -> error", any(e.column == "source_docs" for e in errs))

errs, _ = check([row(stage="closed", outcome_status="closed_won",
                     why_passed_tag="", source_docs="")])
expect("closed without source_doc -> error", any(e.column == "source_docs" for e in errs))

errs, _ = check([row(stage="sourced", outcome_status="active", why_passed_tag="",
                     source_docs="", first_touch="", last_touch="",
                     ask_price="", our_offer="", cap_rate="", price_per_sqft="")])
expect("sourced lead without doc -> no error", not errs)

# --- cross-field ------------------------------------------------------------
_, warns = check([row(outcome_status="passed", why_passed_tag="")])
expect("passed w/o reason -> warn", any(w.column == "why_passed_tag" for w in warns))

_, warns = check([row(stage="closed", outcome_status="closed_won", why_passed_tag="price")])
expect("why_passed on non-passed -> warn", any(w.column == "why_passed_tag" for w in warns))

# --- numbers ----------------------------------------------------------------
errs, _ = check([row(ask_price="abc")])
expect("non-numeric ask_price -> error", any(e.column == "ask_price" for e in errs))

_, warns = check([row(cap_rate="58")])
expect("cap_rate 58 -> warn", any(w.column == "cap_rate" for w in warns))

errs, _ = check([row(ask_price="$4,800,000", our_offer="$4,200,000")])
expect("money with $ and commas parses", not errs)

_, warns = check([row(ask_price="4000000", our_offer="5000000")])
expect("offer > ask -> warn", any(w.column == "our_offer" for w in warns))

# --- dates ------------------------------------------------------------------
errs, _ = check([row(first_touch="03/10/2022")])
expect("non-ISO date -> error", any(e.column == "first_touch" for e in errs))

_, warns = check([row(first_touch="2022-05-02", last_touch="2022-03-10")])
expect("last before first -> warn", any(w.column == "last_touch" for w in warns))

# --- state ------------------------------------------------------------------
_, warns = check([row(state="ZZ")])
expect("bad state -> warn", any(w.column == "state" for w in warns))

# --- fixture round-trips via the file path ----------------------------------
here = os.path.dirname(os.path.abspath(__file__))
example = os.path.join(here, "..", "data", "deal-index.example.csv")
_, ex_issues = v.validate_file(example)
expect("example CSV has no errors",
       not [i for i in ex_issues if i.level == v.ERROR])

invalid = os.path.join(here, "testdata", "invalid.csv")
_, inv_issues = v.validate_file(invalid)
expect("invalid fixture has errors",
       any(i.level == v.ERROR for i in inv_issues))

# --- summary ----------------------------------------------------------------
print(f"\n{PASSED} passed, {FAILED} failed")
sys.exit(1 if FAILED else 0)
