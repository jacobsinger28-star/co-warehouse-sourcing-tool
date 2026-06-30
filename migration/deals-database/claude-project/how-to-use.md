# How to stand up the Deal Archive Assistant (Stage 1)

> For whoever sets it up (Raz first, then hand to the team). Zero code. ~20 minutes once the archive
> is consolidated.

## Prerequisites

- The consolidated archive exists per [`deal-archive-spec.md`](./deal-archive-spec.md): a `deals/`
  folder of per-deal subfolders + a filled `deal-index.csv`.
- A Claude account with Projects (Team or Pro). We already pay for this.

## Setup

1. In Claude, create a new **Project** named `Simi — Deal Archive`.
2. Open the project's **custom instructions** and paste everything below the line in
   [`INSTRUCTIONS.md`](./INSTRUCTIONS.md).
3. **Validate the index first** — a single bad row silently poisons the bot:
   ```bash
   python3 tools/validate_index.py data/deal-index.csv
   # then confirm the index still matches the folders on disk:
   python3 tools/scaffold_index.py "/path/to/Deal Archive" --check data/deal-index.csv
   ```
   Fix every error before uploading (see [`../tools/README.md`](../tools/README.md)).
4. Add to the project's **knowledge**:
   - `deal-index.csv` (the master table — add this first; it's the bot's map)
   - the LOI PDFs / Word docs from `deals/`
   - any `notes.md` you want it to read
5. Start a chat in the project and run the smoke-test questions below.

> Knowledge size is bounded. If the full archive doesn't fit, prioritize: the index always goes in,
> then the most-referenced / most-recent LOIs. When you outgrow this, that's the trigger for Stage 3
> (real RAG) in [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).

## Smoke test (run these before showing anyone)

These map to the use cases in Andrew's email. Each answer should lead with a direct answer and cite
a source.

| Ask | What a good answer looks like |
|---|---|
| "Have we ever LOI'd [owner LLC / principal / address]?" | yes/no, when, outcome, which teammate — searched by owner, principal, and address |
| "What did we offer on the Park Ave property in 2022?" | the LOI offer + key terms, citing the LOI file |
| "List every deal we passed on, sorted by cap rate." | a table: deal · cap rate · why_passed · source; notes if incomplete |
| "Show me every industrial deal we've looked at in Florida." | filtered table with sources |
| "What's a fair price for a warehouse in Columbus?" | should **decline** — that's market commentary, not archive history |

If the bot invents a number, hedges instead of citing, or says "no record" for a deal you know
exists — fix the **input** (the index / docs), not just the prompt. The prompt already forbids
those; the usual cause is a thin or missing index row.

## Showing Andrew (this week)

- Lead with one real question he'll care about ("have we touched this owner before") answered live.
- Be explicit about the limit: it knows what's in the archive, and the archive is only as complete
  as Stage 0. The pitch is "this gets dramatically better as we consolidate," not "it's done."
- The ask back to Andrew: a single home for deal docs + Pipedrive API access. That's the unlock.

## Keeping it fresh

- Stage 1 has no live sync. Re-upload a fresh `deal-index.csv` + new LOIs when deals change —
  monthly is fine to start. **Re-run both checks before each re-upload** — `validate_index.py`
  (a hand-edited typo or off-list value) and `scaffold_index.py … --check` (a new LOI dropped in a
  folder but never added to the index). That drift is exactly what creeps in between uploads.
- When re-uploading gets annoying or the archive outgrows the project, that's the signal to move to
  Stage 2 (`/ask` page) or Stage 3 (real RAG).
