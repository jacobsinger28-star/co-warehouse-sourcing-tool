# FOUNDER_INPUTS.md — what the founder owes the engineer, and when

The engineer cannot ship without these. Each has a deadline tied to the 10-day plan.
If one slips, the dependent day slips.

## Day 1–2
1. **Submarket polygons.** Draw the target infill boundaries on geojson.io
   (Wedgewood-Houston, Berry Hill, The Nations/West Nashville, East Nashville,
   North Nashville/MetroCenter, Airport/Donelson, Nolensville Pike corridor, Madison —
   adjust to taste). Export as `submarkets.geojson` into /imports.
   Blocks: the submarket gate (day 2).

## Day 2–3
2. **Land-use code validation** (non-blocking — pre-solved).
   A starting list of industrial/warehouse/flex codes is already in
   `imports/land_use_codes.yaml`. The engineer will run a 10-minute query on Day 1
   to surface actual distinct values, then flag anything unexpected.
   Founder review is 10 minutes, not a blocking dependency.

## By Day 4
3. **Trustee delinquent-tax file.** Source the current delinquent property-tax list
   from the Davidson County Trustee (download or request). Drop as
   `trustee_delinquent.csv` into /imports. Blocks: the strongest distress signal (day 4).

## Day 5 (4-hour block — protect it)
4. **Grade the top 100.** One sitting, A/B/C on each, with a one-line reason wherever
   your grade disagrees with the score. This calibrates the weights. Blocks: score v0.1.

## Days 6–7 (1 hour with engineer)
5. **VLM audit.** Review 25 model outputs against the images with the engineer.
   Blocks: trusting the physical-fit scores.

## Day 9 (2 hours, delegable after the first few)
6. **TN SOS lookups.** Using the engineer's SOP, resolve the top 25 owner entities to
   humans via tnbear.tn.gov. Blocks: skip tracing, and therefore phone numbers.
   While you're in each record: also search recdsonline.com (Davidson County Register
   of Deeds) for the owner name — any lis pendens (pre-foreclosure) is a top-priority flag.

## Day 10+ (founder only — not delegable)
7. **Dial.** The system's output is a call queue. Log a disposition on every call in
   the Airtable board — this is the dataset that makes the score smarter every week.

## Standing decisions already made (don't reopen during the sprint)
- Davidson County only. No second market until checkpoint.
- No mailed letters in this phase. Calls only.
- Off-market only. No listing data ingested. Anything on Crexi/LoopNet is already broker-controlled.
- Weights change once (after the day-5 grading), then freeze until day 14.
