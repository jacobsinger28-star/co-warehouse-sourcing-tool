#!/usr/bin/env python3
"""Scaffold and reconcile deal-index.csv against the deal-archive folder tree.

`validate_index.py` checks that the index is internally well-formed. This tool
checks the index against *reality on disk* — the `/deals/<deal_id>/` folders the
archive spec tells you to keep — and bootstraps the index from them. Two faces of
one folder walk:

  scaffold (default)
      Walk the archive and print a skeleton deal-index.csv: `deal_id` from each
      folder name, `source_docs` from the files actually in it, every other column
      left blank. Saves typing the two most tedious columns by hand for hundreds of
      folders — and never invents a number (blanks are honest; see the spec).

  --check INDEX
      Reconcile an existing index against the folders and report drift:
        * a deal folder with no matching index row  (ERROR — undocumented deal)
        * an index row whose deal_id has no folder   (WARN  — likely Pipedrive-only)
        * source_docs citing a file not on disk      (ERROR — dangling citation)
        * a file in a folder not listed in source_docs(WARN  — new LOI not indexed)

Run --check before every Claude Project re-upload, right after validate_index:
the validator proves the CSV is clean; this proves it still matches the archive.

Stdlib only — no venv. The archive root is the folder that contains `deals/`
(per claude-project/deal-archive-spec.md); pointing straight at a `deals/` dir
also works.

    python3 tools/scaffold_index.py "/path/to/Deal Archive" > data/deal-index.skeleton.csv
    python3 tools/scaffold_index.py "/path/to/Deal Archive" --check data/deal-index.csv

Exit code 0 = clean (warnings allowed), 1 = errors found (or warnings under
--strict), 2 = the archive folder could not be read.
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
from dataclasses import dataclass

# Single source of truth for the schema + slug shape — keep this tool honest
# against the same canon the validator enforces.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from validate_index import CANONICAL_HEADER, DEAL_ID_RE  # noqa: E402

ERROR, WARN = "ERROR", "WARN"

# Files that are never a deal's source document — editor/OS noise to skip.
IGNORED_FILES = {".DS_Store", "Thumbs.db", ".gitkeep"}


@dataclass
class Finding:
    level: str          # ERROR | WARN
    deal_id: str        # the deal the finding is about ("" for archive-level)
    message: str

    def __str__(self) -> str:
        where = self.deal_id or "archive"
        return f"  {self.level:5} {where}: {self.message}"


def _docs_in(folder: str) -> list[str]:
    """Source-doc filenames directly inside a deal folder, sorted. Skips hidden
    files, known junk, and subdirectories — source_docs is a flat filename list."""
    out = []
    for name in os.listdir(folder):
        if name.startswith(".") or name in IGNORED_FILES:
            continue
        if os.path.isfile(os.path.join(folder, name)):
            out.append(name)
    return sorted(out)


def scan_deals(deals_dir: str) -> dict[str, list[str]]:
    """Map each deal folder name -> its source-doc filenames. Ordered by deal_id
    so output is deterministic. Raises OSError if the directory can't be read."""
    disk: dict[str, list[str]] = {}
    for name in sorted(os.listdir(deals_dir)):
        path = os.path.join(deals_dir, name)
        if name.startswith(".") or not os.path.isdir(path):
            continue
        disk[name] = _docs_in(path)
    return disk


def resolve_deals_dir(archive_root: str) -> str:
    """Accept either the archive root (contains deals/) or the deals/ dir itself."""
    nested = os.path.join(archive_root, "deals")
    return nested if os.path.isdir(nested) else archive_root


def read_index(path: str) -> dict[str, list[str]]:
    """Map deal_id -> listed source_docs from an existing index. Last row wins on
    a duplicate id (the validator is what flags the duplicate; we just don't crash)."""
    index: dict[str, list[str]] = {}
    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        for raw in reader:
            did = (raw.get("deal_id") or "").strip()
            if not did:
                continue
            docs = [d.strip() for d in (raw.get("source_docs") or "").split(";") if d.strip()]
            index[did] = docs
    return index


def skeleton_rows(disk: dict[str, list[str]]) -> list[list[str]]:
    """Build skeleton CSV rows (header order) from the scanned archive. Only
    deal_id and source_docs are filled; every other column is blank by design."""
    di, sd = CANONICAL_HEADER.index("deal_id"), CANONICAL_HEADER.index("source_docs")
    rows = []
    for deal_id, docs in disk.items():
        row = [""] * len(CANONICAL_HEADER)
        row[di] = deal_id
        row[sd] = ";".join(docs)
        rows.append(row)
    return rows


def lint_folders(disk: dict[str, list[str]]) -> list[Finding]:
    """Folder-hygiene findings independent of any index: bad slugs, empty folders."""
    findings: list[Finding] = []
    for deal_id, docs in disk.items():
        if not DEAL_ID_RE.match(deal_id):
            findings.append(Finding(WARN, deal_id,
                                    "folder name is not a lowercase-hyphenated slug "
                                    "(rename it; e.g. park-ave-bayharbor-2022)"))
        if not docs:
            findings.append(Finding(WARN, deal_id,
                                    "deal folder has no documents — a folder with no LOI/export "
                                    "is suspicious; add the doc or remove the folder"))
    return findings


def reconcile(disk: dict[str, list[str]], index: dict[str, list[str]]) -> list[Finding]:
    """Compare folders-on-disk against an existing index. Pure: dicts in, findings
    out, so tests can drive it without a filesystem."""
    findings = lint_folders(disk)

    for deal_id in disk:
        if deal_id not in index:
            findings.append(Finding(ERROR, deal_id,
                                    "deal folder has no row in the index — every documented deal "
                                    "must be indexed (quality bar)"))

    for deal_id in index:
        if deal_id not in disk:
            findings.append(Finding(WARN, deal_id,
                                    "index row has no deal folder — fine if Pipedrive-only, "
                                    "else the folder is missing or misnamed"))

    # source_docs drift, only where we can compare both sides.
    for deal_id in disk:
        if deal_id not in index:
            continue
        on_disk = set(disk[deal_id])
        listed = set(index[deal_id])
        for missing in sorted(listed - on_disk):
            findings.append(Finding(ERROR, deal_id,
                                    f"source_docs cites '{missing}' but it is not in the folder "
                                    "— dangling citation"))
        for untracked in sorted(on_disk - listed):
            findings.append(Finding(WARN, deal_id,
                                    f"'{untracked}' is in the folder but not in source_docs "
                                    "— index the new doc"))
    return findings


def _print_skeleton(disk: dict[str, list[str]], out) -> None:
    writer = csv.writer(out)
    writer.writerow(CANONICAL_HEADER)
    writer.writerows(skeleton_rows(disk))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("archive_root",
                        help="the Deal Archive folder (contains deals/), or a deals/ dir directly")
    parser.add_argument("--check", metavar="INDEX",
                        help="reconcile this existing deal-index.csv against the folders "
                             "instead of printing a skeleton")
    parser.add_argument("--strict", action="store_true",
                        help="treat warnings as errors (nonzero exit if any warning)")
    args = parser.parse_args(argv)

    deals_dir = resolve_deals_dir(args.archive_root)
    try:
        disk = scan_deals(deals_dir)
    except OSError as exc:
        print(f"  ERROR archive: could not read {deals_dir}: {exc}", file=sys.stderr)
        return 2

    if not disk:
        print(f"  WARN  archive: no deal folders found under {deals_dir}", file=sys.stderr)

    # --- scaffold mode: emit the skeleton, warn about folder hygiene on stderr ---
    if not args.check:
        for f in lint_folders(disk):
            print(f, file=sys.stderr)
        _print_skeleton(disk, sys.stdout)
        print(f"\n# {len(disk)} deal folder(s) scaffolded. Fill the blank columns, "
              f"then gate with validate_index.py.", file=sys.stderr)
        return 0

    # --- check mode: reconcile against the existing index ---
    try:
        index = read_index(args.check)
    except FileNotFoundError:
        print(f"  ERROR archive: index not found: {args.check}", file=sys.stderr)
        return 2
    except OSError as exc:
        print(f"  ERROR archive: could not read {args.check}: {exc}", file=sys.stderr)
        return 2

    findings = reconcile(disk, index)
    errors = [f for f in findings if f.level == ERROR]
    warns = [f for f in findings if f.level == WARN]

    for f in findings:
        print(f)

    print()
    print(f"{deals_dir} vs {args.check}: {len(disk)} folder(s), {len(index)} index row(s), "
          f"{len(errors)} error(s), {len(warns)} warning(s)")

    if errors:
        print("FAILED — the index and the archive disagree. Reconcile them before upload.")
        return 1
    if warns and args.strict:
        print("FAILED (--strict) — warnings present.")
        return 1
    print("OK — index matches the archive." if not warns
          else "OK with warnings — review the lines above.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
