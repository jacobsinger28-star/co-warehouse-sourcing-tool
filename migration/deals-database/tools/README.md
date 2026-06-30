# tools/

Stage 0 data-hygiene tooling. Not part of the "zero-code" Stage 1 chatbot — these
guard the **input** that the chatbot and the F4 dedupe spine read. Stdlib Python
only; no venv, no installs.

## `validate_index.py` — deal-index.csv linter

Makes the "Quality bar" in [`../claude-project/deal-archive-spec.md`](../claude-project/deal-archive-spec.md)
mechanical. A fabricated cap rate or a thin row poisons every answer the bot gives,
silently — this catches it before upload.

```bash
python3 tools/validate_index.py data/deal-index.csv      # validate
python3 tools/validate_index.py data/deal-index.csv --strict   # warnings fail too
```

Exit `0` = clean (warnings allowed), `1` = errors (or warnings under `--strict`),
`2` = file unreadable.

**Errors (must fix — these break dedupe or are fabrications):**
- header doesn't match the canonical schema exactly
- a dedupe-critical column is empty (`deal_id`, `address`, `owner_entity`, `stage`, `outcome_status`)
- `deal_id` isn't a lowercase-hyphenated slug, or is duplicated
- a controlled-vocab cell holds an off-list value (`asset_type`, `stage`, `outcome_status`, `why_passed_tag`)
- an LOI'd / under-contract / closed (or `closed_won`) deal cites no `source_docs`
- a number cell isn't a number, or a date isn't `YYYY-MM-DD`

**Warnings (review — likely typos or omissions):**
- a passed deal has no `why_passed_tag` (the bot's highest-value column)
- `why_passed_tag` set on a deal that wasn't passed
- `cap_rate` outside 1–20%, `our_offer` above `ask_price`, `last_touch` before `first_touch`
- a non-US-state `state` code, a non-integer `pipedrive_id`

When the bot gives a wrong answer, fix the input here first — the prompt already
forbids guessing; the usual cause is a bad index row.

## `scaffold_index.py` — folder ⇄ index sync

`validate_index.py` checks the CSV is internally well-formed. `scaffold_index.py`
checks it against **reality on disk** — the `/deals/<deal_id>/` folders the
[archive spec](../claude-project/deal-archive-spec.md) tells you to keep — and
bootstraps the index from them. Two faces of one folder walk:

```bash
# scaffold: print a skeleton index straight from the folder tree
python3 tools/scaffold_index.py "/path/to/Deal Archive" > data/deal-index.skeleton.csv

# check: reconcile an existing index against the folders
python3 tools/scaffold_index.py "/path/to/Deal Archive" --check data/deal-index.csv
```

**Scaffold mode** fills only `deal_id` (from each folder name) and `source_docs`
(from the files in it); every other column is left blank — the most tedious
columns typed for you, with nothing invented. Fill the blanks, then gate with
`validate_index.py`. The two tools bookend intake.

**`--check` mode** reports drift between the index and the archive — run it before
every re-upload, right after the validator:

- **Errors:** a deal folder with no index row (undocumented deal); `source_docs`
  citing a file that isn't in the folder (dangling citation).
- **Warnings:** an index row whose `deal_id` has no folder (fine if Pipedrive-only);
  a file in a folder not listed in `source_docs` (a new LOI that wasn't indexed);
  a folder name that isn't a slug, or a folder with no documents.

Exit `0` = clean, `1` = errors (or warnings under `--strict`), `2` = archive
unreadable. The archive root is the folder that contains `deals/` (pointing
straight at a `deals/` dir also works). It only reads the archive — never writes
to it — so it's safe to run against the live shared drive.

## tests

```bash
python3 tools/test_validate.py     # 27 tests
python3 tools/test_scaffold.py     # 23 tests
```

`test_validate.py` covers every validator check plus the checked-in fixtures: the
clean example ([`../data/deal-index.example.csv`](../data/deal-index.example.csv))
must pass, and [`testdata/invalid.csv`](testdata/invalid.csv) — a deliberately
broken row set — must fail; it doubles as a worked example of what gets caught.
`test_scaffold.py` drives the scaffold/reconcile core with in-memory dicts and
builds a throwaway archive on disk to exercise the folder walk + CLI end-to-end.
