# Deal Archive — Consolidation Spec (Stage 0)

> How to get every past deal into one place, in one shape, so the chatbot (and later the dedupe
> spine) actually work. The bot is only as good as this. Last updated June 16, 2026.

The hard part of this project isn't the AI — it's that deal history is scattered. This spec is the
fix. It's worth doing even if the bot never ships, because it also gives the team a single source of
truth for "have we seen this."

## One folder, one structure

Pick **one** home (shared Google Drive / SharePoint / Dropbox — decide with Aaron). Inside it:

```
/Deal Archive
  deal-index.csv                      <- the master table (one row per deal)
  /deals
    /park-ave-bayharbor-2022          <- one folder per deal, named = deal_id
      LOI.pdf
      pipedrive-export.pdf            (optional)
      notes.md                        (optional)
    /miami-industrial-portfolio-2025
      LOI.pdf
      ...
```

### Naming convention

- **deal_id** = `property-or-owner` + `city` + `year`, lowercase, hyphenated.
  e.g. `park-ave-bayharbor-2022`, `266-unit-multifamily-ga-2023`.
- Keep original filenames human-readable: `LOI.pdf`, not `scan_004_final_v3.pdf`. Rename on intake.
- One deal = one folder. Multiple LOIs / rounds for the same deal go in the same folder, suffixed
  `LOI-round1.pdf`, `LOI-round2.pdf`.

## The master index — `deal-index.csv`

One row per deal. This is what makes the bot fast and the dedupe lookup possible. Columns map 1:1 to
the canonical record in [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md):

```csv
deal_id,address,city,state,submarket,asset_type,sqft_or_units,owner_entity,owner_principals,broker,listing_source,stage,first_touch,last_touch,relationship_owner,ask_price,our_offer,cap_rate,price_per_sqft,key_terms,outcome_status,why_passed_tag,why_passed_notes,source_docs,pipedrive_id
```

Field notes:

- **asset_type** — controlled vocab: `industrial | multifamily | retail | office | hospitality | IOS | carwash | other`.
- **stage** — `sourced | contacted | LOI | under_contract | passed | closed | dead`.
- **outcome_status** — `active | passed | closed_won | dead`.
- **why_passed_tag** — controlled vocab so "what did we pass on for X" works: `price | cap_rate | location | condition | financing | seller_terms | competition | timing | other`.
- **relationship_owner** — which teammate owns it (the "don't step on a colleague" signal).
- **source_docs** — semicolon-separated filenames inside the deal folder.
- Leave a cell blank if unknown. **Never guess** — a blank is honest; a fabricated cap rate poisons
  the bot.

A starter file with the header row + one example lives at
[`../data/deal-index.example.csv`](../data/deal-index.example.csv).

## How to fill it (realistic intake order)

1. **Pull the Pipedrive export first** — it already has many of these fields. One row per deal,
   mapped into the CSV. This gets you 60–80% of structured columns with zero reading.
2. **Walk the LOI docs** — for each, find/create the matching folder, drop the PDF, fill the
   economics columns (ask, our_offer, cap_rate, terms) the export doesn't have.
3. **Backfill outcomes** — `why_passed_tag` + notes is the highest-value, lowest-coverage column.
   Worth a 15-min pass with whoever remembers. This is the column that makes the bot say something
   no spreadsheet can.
4. **De-dupe the index itself** — same property under two owners / two folders gets merged.

> **Shortcut for the `deal_id` + `source_docs` columns:** once the `/deals/<deal_id>/` folders
> exist, don't hand-type those two columns. Run
> `python3 tools/scaffold_index.py "/path/to/Deal Archive"` to print a skeleton index with
> `deal_id` (from each folder name) and `source_docs` (from the files in it) already filled and
> every other column blank — then paste the Pipedrive/economics data into the blanks. Nothing is
> invented; blanks stay blank.

## Quality bar (what "done enough for Stage 1" means)

- Every closed and every LOI'd deal is in the index with a source doc.
- `owner_entity`, `address`, `stage`, `outcome_status` populated for every row (these power dedupe).
- No invented numbers anywhere.

Passed-but-never-LOI'd sourcing leads can come later — start with deals that have a document.

**Don't eyeball this — run the linter.** Every bullet above is enforced by
[`../tools/validate_index.py`](../tools/validate_index.py) (controlled-vocab fields,
required columns, source-doc coverage, duplicate `deal_id`s, real numbers/dates):

```bash
python3 tools/validate_index.py data/deal-index.csv
```

A clean exit is the gate for Stage 1, and the same check before every monthly
re-upload keeps a bad row from silently poisoning the bot. The validator checks
the CSV in isolation; to also confirm it still matches the **folders on disk**
(every documented deal indexed, every cited doc present, no new LOI left
un-indexed), run the reconcile pass right after it:

```bash
python3 tools/scaffold_index.py "/path/to/Deal Archive" --check data/deal-index.csv
```

See [`../tools/README.md`](../tools/README.md).
