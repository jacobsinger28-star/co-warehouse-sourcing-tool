#!/usr/bin/env python3
"""Tests for scaffold_index.py. Stdlib only:  python3 tools/test_scaffold.py

Drives the pure core (reconcile / skeleton_rows / lint_folders) with in-memory
dicts for determinism, and exercises the filesystem walk + CLI against a temp
archive built on the fly.
"""

import csv
import io
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import scaffold_index as s

PASSED = FAILED = 0


def expect(name, cond):
    global PASSED, FAILED
    if cond:
        PASSED += 1
    else:
        FAILED += 1
        print(f"  FAIL: {name}")


def levels(findings):
    return [f.level for f in findings]


def msgs(findings):
    return " | ".join(f"{f.level}:{f.deal_id}:{f.message}" for f in findings)


# --- skeleton_rows ----------------------------------------------------------
disk = {"park-ave-bayharbor-2022": ["LOI.pdf", "pipedrive-export.pdf"]}
rows = s.skeleton_rows(disk)
hdr = s.CANONICAL_HEADER
expect("skeleton: one row per folder", len(rows) == 1)
expect("skeleton: row width matches header", len(rows[0]) == len(hdr))
expect("skeleton: deal_id filled from folder",
       rows[0][hdr.index("deal_id")] == "park-ave-bayharbor-2022")
expect("skeleton: source_docs semicolon-joined",
       rows[0][hdr.index("source_docs")] == "LOI.pdf;pipedrive-export.pdf")
expect("skeleton: economics left blank (no fabrication)",
       rows[0][hdr.index("cap_rate")] == "" and rows[0][hdr.index("our_offer")] == "")

# --- lint_folders -----------------------------------------------------------
findings = s.lint_folders({"Bad_Folder_Name": ["LOI.pdf"]})
expect("lint: bad slug -> warn", any(f.level == s.WARN and "slug" in f.message for f in findings))

findings = s.lint_folders({"empty-deal-2021": []})
expect("lint: empty folder -> warn", any(f.level == s.WARN and "no documents" in f.message for f in findings))

findings = s.lint_folders({"good-deal-tampa-2022": ["LOI.pdf"]})
expect("lint: clean folder -> nothing", not findings)

# --- reconcile: folder with no index row ------------------------------------
findings = s.reconcile({"new-deal-2025": ["LOI.pdf"]}, {})
expect("reconcile: folder without row -> error",
       any(f.level == s.ERROR and "no row in the index" in f.message for f in findings))

# --- reconcile: index row with no folder ------------------------------------
findings = s.reconcile({}, {"crm-only-2024": ["LOI.pdf"]})
expect("reconcile: row without folder -> warn",
       any(f.level == s.WARN and "no deal folder" in f.message for f in findings))

# --- reconcile: dangling citation (listed but not on disk) ------------------
findings = s.reconcile({"d-2022": ["LOI.pdf"]}, {"d-2022": ["LOI.pdf", "appraisal.pdf"]})
expect("reconcile: cited-but-missing -> error",
       any(f.level == s.ERROR and "dangling citation" in f.message for f in findings))

# --- reconcile: untracked doc (on disk but not listed) ----------------------
findings = s.reconcile({"d-2022": ["LOI.pdf", "LOI-round2.pdf"]}, {"d-2022": ["LOI.pdf"]})
expect("reconcile: on-disk-not-listed -> warn",
       any(f.level == s.WARN and "not in source_docs" in f.message for f in findings))

# --- reconcile: perfect match -> clean --------------------------------------
findings = s.reconcile({"d-2022": ["LOI.pdf"]}, {"d-2022": ["LOI.pdf"]})
expect("reconcile: matching folder+row -> no findings", not findings)

# --- reconcile: order-independent source_docs match -------------------------
findings = s.reconcile({"d-2022": ["a.pdf", "b.pdf"]}, {"d-2022": ["b.pdf", "a.pdf"]})
expect("reconcile: source_docs compared as sets", not findings)

# --- filesystem walk + read_index round-trip --------------------------------
with tempfile.TemporaryDirectory() as root:
    deals = os.path.join(root, "deals")
    os.makedirs(os.path.join(deals, "park-ave-bayharbor-2022"))
    os.makedirs(os.path.join(deals, "miami-industrial-2025"))
    with open(os.path.join(deals, "park-ave-bayharbor-2022", "LOI.pdf"), "w") as fh:
        fh.write("x")
    # a hidden file + junk file must be ignored
    with open(os.path.join(deals, "park-ave-bayharbor-2022", ".DS_Store"), "w") as fh:
        fh.write("x")
    with open(os.path.join(deals, "miami-industrial-2025", "LOI.pdf"), "w") as fh:
        fh.write("x")

    expect("resolve: finds nested deals/ dir", s.resolve_deals_dir(root) == deals)

    scanned = s.scan_deals(deals)
    expect("scan: two folders found", set(scanned) == {"park-ave-bayharbor-2022", "miami-industrial-2025"})
    expect("scan: hidden/junk files skipped",
           scanned["park-ave-bayharbor-2022"] == ["LOI.pdf"])

    # write an index that matches one folder and invents an extra deal
    index_path = os.path.join(root, "deal-index.csv")
    with open(index_path, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(s.CANONICAL_HEADER)
        prow = [""] * len(s.CANONICAL_HEADER)
        prow[s.CANONICAL_HEADER.index("deal_id")] = "park-ave-bayharbor-2022"
        prow[s.CANONICAL_HEADER.index("source_docs")] = "LOI.pdf"
        w.writerow(prow)
        crow = [""] * len(s.CANONICAL_HEADER)
        crow[s.CANONICAL_HEADER.index("deal_id")] = "crm-only-2024"
        w.writerow(crow)

    idx = s.read_index(index_path)
    expect("read_index: parses rows", idx.get("park-ave-bayharbor-2022") == ["LOI.pdf"])

    findings = s.reconcile(scanned, idx)
    # miami folder has no row -> error; crm-only row has no folder -> warn
    expect("integration: miami folder unindexed -> error",
           any(f.level == s.ERROR and f.deal_id == "miami-industrial-2025" for f in findings))
    expect("integration: crm-only row -> warn",
           any(f.level == s.WARN and f.deal_id == "crm-only-2024" for f in findings))

    # CLI scaffold mode prints a valid header to stdout
    out = io.StringIO()
    old = sys.stdout
    sys.stdout = out
    try:
        rc = s.main([root])
    finally:
        sys.stdout = old
    printed = out.getvalue().splitlines()
    expect("cli scaffold: exit 0", rc == 0)
    expect("cli scaffold: first line is canonical header",
           printed[0] == ",".join(s.CANONICAL_HEADER))

    # CLI check mode returns 1 (the miami folder is unindexed -> error)
    rc = s.main([root, "--check", index_path])
    expect("cli check: errors -> exit 1", rc == 1)

# --- summary ----------------------------------------------------------------
print(f"\n{PASSED} passed, {FAILED} failed")
sys.exit(1 if FAILED else 0)
