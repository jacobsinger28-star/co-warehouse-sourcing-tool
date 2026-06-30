# Hand-source 25 real leads in an hour

**Purpose:** produce the one number that gates this entire project —
*what % of real leads do we actually get a deliverable email for, and from
which source?* You do not need Reonomy, parcel-data licensing, or any new
tooling to get it. You need ~25 real leads in a spreadsheet and an Apollo key.

This is deliberately manual. One hour of clicking beats two weeks of building a
nationwide assessor scraper *just to find out whether the hypothesis holds at
all.* If the coverage number is good, you build the automation with confidence.
If it's bad, you just saved yourself the build.

---

## The end state (what you're filling in)

A CSV in the exact shape the engine reads. Get a blank one:

```bash
cd co-warehouse-sourcing-tool-main/backend
./.venv/bin/python -m scripts.run_outreach_csv --template my_leads.csv
```

Or just copy `co-warehouse-sourcing-tool-main/backend/scripts/sample_leads.csv`
and overwrite the rows. One row = one contactable person.

**Target mix for the sample (~25 rows):**
- **~15 attorneys** — Apollo's sweet spot, fastest to find, highest expected
  hit-rate. Do these first; they alone may answer the gating question for the
  attorney channel.
- **~10 owners** — the harder, more valuable channel. A mix of *business-like*
  owners (named operating company) and *private* owners (bare name behind an
  LLC). This is where you'll see Apollo's miss-rate — exactly the thing that
  tells you whether you need a skip-trace vendor.

Pick **2–3 counties Simi actually targets** and pull everything from those, so
the sample reflects your real buy-box, not random geography.

---

## One directory to bookmark first

**NETR Online → `publicrecords.netronline.com`.** It's a free directory that,
for every US county, links straight to that county's **Assessor / Property
Appraiser** (owner + mailing address) and **Recorder / Register of Deeds**
(deeds → closing attorney). Start every county here instead of guessing URLs.
Search portals vary county to county; the field names below are what you're
hunting for regardless of layout.

---

## Channel A — Attorneys (do these first, ~25 min)

**The play:** for any industrial property sold in the last ~15 years, the deed
names the attorney or title company that handled the closing. Reach that person
with a property hook. (Aaron's attorney-on-past-sales thesis.)

**Where to look, per county (via NETR → Recorder/Register of Deeds):**
1. Open the county's online deed/recorder search.
2. Search recent **deeds** (Warranty Deed / Special Warranty Deed) on
   industrial/commercial parcels — many recorders let you filter by date or
   document type, or you can start from a known sold property.
3. On the deed image, grab the closing contact from one of:
   - **"This instrument prepared by ____"** (top of page) — usually the
     attorney + firm.
   - **"Return to / After recording return to ____"** — often the title or
     law firm.
   - The **title company** named in the body.

**What to put in the row (attorney):**
| Column | Fill with |
|---|---|
| `name` | Attorney's full name |
| `company` | Their firm (e.g. "Nair & Associates") |
| `domain` | Firm's website domain if you can find it in 10 sec (Google the firm) — **this is Apollo's single best key**, worth the extra few seconds |
| `title` | "Real estate attorney" / "Closing attorney" if shown |
| `channel` | `attorney` |
| `property_address` | The property the deed was for (the email hook) |
| `property_context` | e.g. "closing attorney on 2019 sale, 140,000 SF" |
| `source_record` | e.g. "Davidson County recorder deed bk 4821" (so you can trace it back) |

> Don't over-collect. Name + firm + property is enough for Apollo. The domain
> is the one optional field worth chasing because it lifts the hit-rate most.

---

## Channel B — Owners (~30 min)

**The play:** the county assessor lists the owner of record + a mailing address
for every parcel. For a person, that's enough to skip-trace later; for an LLC,
note the LLC and (optionally) chase the principal.

**Where to look, per county (via NETR → Assessor / Property Appraiser):**
1. Open the county's parcel search.
2. Find industrial parcels in your SF range (50–300k). Some appraisers let you
   filter by land-use/property class = Industrial/Warehouse; otherwise search
   by area or by a known address.
3. Grab the **Owner of Record** and the **Mailing Address** (often labeled
   "Owner Mailing Address" — frequently different from the property address,
   which is the useful part).

**Two owner sub-types — collect both:**

- **Business-like owner** (owner name *is* an operating company, or there's an
  obvious company): fill `company` and, if findable, `domain`. Apollo should
  win these.
- **Private owner behind an LLC** (owner of record = "Otto Family Holdings
  LLC", mailing address = a residence/PO box): fill `llc_name` +
  `mailing_address`, leave `company`/`domain` blank. **These are the ones
  Apollo will miss** — and seeing how many miss is the whole point.
  - *Optional, for a few:* resolve the human behind the LLC via the state's
    **Secretary of State business search** (free) — the LLC's registered agent
    / organizer / manager is often a real name. Put that in `name`. Don't do
    this for all 10; do 2–3 so you can see whether a resolved name changes the
    Apollo result.

**What to put in the row (owner):**
| Column | Fill with |
|---|---|
| `name` | Principal's name **if you have it** (else leave blank) |
| `company` | Operating company, if the owner is business-like |
| `domain` | Company domain, if business-like and findable |
| `mailing_address` | **The owner mailing address from the assessor — the skip-trace key. Always grab this.** |
| `channel` | `owner` |
| `llc_name` | The owner-of-record LLC (e.g. "Otto Family Holdings LLC") |
| `property_address` | The industrial property itself |
| `property_context` | e.g. "92,000 SF warehouse, owner-occupied 22 yrs" |
| `source_record` | e.g. "Goodhue County assessor parcel 52-119" |

---

## Run it and read the number

```bash
cd co-warehouse-sourcing-tool-main/backend

# 1. (when you have it) drop your Apollo key in so providers go LIVE
echo 'APOLLO_API_KEY=...' >> .env        # or export it in your shell

# 2. test on a slice first so you don't burn credits on a typo
./.venv/bin/python -m scripts.run_outreach_csv --in my_leads.csv --limit 5

# 3. full run
./.venv/bin/python -m scripts.run_outreach_csv --in my_leads.csv \
    --report coverage.json
```

You get:
- **`coverage.json` / the printed report** — `coverage_pct` overall, **broken
  out by `channel` (owner vs. attorney) and by `source` (apollo vs.
  skiptrace)**. This is the gating answer. Read the per-channel numbers, not
  just the headline.
- **`my_leads.enriched.csv`** — every lead with the email/phone/source it
  found + a drafted email, so you can eyeball quality, not just quantity.

---

## How to read the result (this is the decision, not the number)

- **Attorney coverage high (say >70% via Apollo)** → the attorney channel is
  viable on Apollo alone. That's your fastest end-to-end proof; consider
  building it out first.
- **Business-like owner coverage decent, private-LLC owner coverage low** →
  expected. The size of that gap = how much you need a skip-trace vendor
  (BatchData / REISkip / IDI). Now you can price that decision against real
  numbers instead of guessing.
- **Everything low even for attorneys** → Apollo isn't the right enrichment
  layer for this data, and you've learned that for ~$0 and one hour — *before*
  committing to Reonomy's $20k–95k or a skip-trace contract.

The number you're comparing everything against is still the Reonomy gating
question from the Chris call: *"What % of records have at least one principal
email?"* — you're now answering it with your own stack on your own sample.

---

## Honest caveats

- **25 leads is directional, not statistical.** It tells you "roughly half" vs.
  "almost none," which is enough to make the next decision. For a real go/no-go
  on a vendor contract, re-run at ~100+.
- **Apollo charges per match** when live (`--limit` is your friend; the runner
  warns you before a live run).
- **Skip-trace is still stubbed** — `SKIPTRACE_API_KEY` has no live
  implementation yet (deliberate; vendor unpicked). So in this first run the
  private-LLC long tail shows up as *Apollo misses*, which is exactly the
  signal you want. You pick and wire the skip-trace vendor **after** you see
  how big that miss is.
- **Public-records access is legal and intended for this** — assessor and
  recorder data is public. Cold email at volume later brings CAN-SPAM
  obligations (suppression, opt-out, real sender identity), but that's a
  send-infrastructure concern, not a sourcing one.

---

*Created 2026-06-16. Companion to the outreach engine in
`co-warehouse-sourcing-tool-main/backend/outreach/` and its CSV runner
`scripts/run_outreach_csv.py`.*
