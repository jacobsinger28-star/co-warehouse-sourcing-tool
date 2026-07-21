# Methodology — the Off-Market Operating System playbook

The sourcing methodology the console implements: the four-stage engine (Find →
Score → Resolve → Reach), the signal library, the scoring model, owner
resolution, outreach templates, and SimiCapital's own deal box.

## Provenance

Copied verbatim (byte-identical) from the root of the sibling scraper repo
`../../off-market-operating-system/` on 2026-07-21, to consolidate the operation's
reference material into this console repo.

| File | What |
|---|---|
| `00-start-here.md` … `09-from-list-to-deals.md` | The "Off-Market Operating System" kit (a Claude Project drop-in). Attributed to **NextAutomation** (nextautomation.us). |
| `README.txt` | The kit's own index/how-to. |
| `deal-box-simicapital.md` | SimiCapital's mandate: asset class, geography, owner profile. The scraper reads this as its filter spec. |

**No PII, no licensed data.** Per the kit's own README, "All examples use
synthetic demo data, not live client results." Verified: the only `owner_*`
strings are schema column-headers and `{merge_slot}` placeholders; the only
"licensed" mentions are the kit *advising* when to route to a licensed
parcel-data provider (`05-county-data-and-the-law.md`), not reproducing any.

## Copied, not moved — and what stayed behind

These are **copies**; the originals remain in the sibling repo on purpose:

- `off-market-operating-system/service/dealbox.py` and `service/README.md` cite
  `deal-box-simicapital.md` and `03-the-four-stage-engine.md` as the scraper's
  spec. The sibling is the PII-vault repo (no git remote, this-laptop-only), so
  it keeps its own methodology.
- Because `deal-box-simicapital.md` now exists in two places, treat the scraper's
  copy as the source of truth for the buy-box (it's what actually filters). Keep
  the two in sync if the mandate changes.

## Deliberately NOT brought over (stays in the sibling, off GitHub)

Per the SimiCap data policy — this console repo has a public GitHub remote and
auto-deploys — none of the following was moved:

- `off-market-operating-system/runs/*/stage1_find*.csv` — Stage-1 kept-lists with
  `owner_of_record` + `owner_mailing_address` (**owner PII**). The console reads
  these live from the scraper's token-gated `/results` endpoint; its fallback
  still points at the sibling path.
- `runs/*/raw/*` — raw county pulls (~35M).
- `service/` — the Off-Market OS scraper itself (its own Railway app; deploys via
  `railway up`, never git) and `service/.results-token.local` (deploy secret).
