# The Four-Stage Engine

Find -> Score -> Resolve -> Reach. Four contained stages, not one mega-prompt.
Each is a message you send inside your Claude Project. Each declares its input and
its output contract, and each output table is the next stage's input, unchanged.
When county data breaks, and it will, you know exactly which stage to rerun.

This works for any asset class. The system prompt reads your deal box to know
whether you are screening apartments, retail, industrial, land, or parks, so the
prompts below stay the same regardless.

---

## Stage 1: FIND

**What it does.** Pulls every owner in your submarket that matches the deal box,
then drops the institutions and keeps the private owners who can actually say yes.

**The data you paste.** A parcel or owner export for one submarket from your
county assessor or GIS open-data portal (file 05 shows where, and which are free).
Owner of record and owner mailing address must be in the extract.

**Paste this into the chat, then paste your export below it:**

```
Run Stage 1 FIND against my deal box.

PARCEL DATA:
{paste the county assessor / GIS export for one submarket}

Restate my deal box as explicit filters first, so I can correct you. Then apply
them to every row. Drop REITs, funds, institutions, and national operators; keep
LLCs, trusts, family partnerships, individuals; anything you cannot classify
confidently you KEEP and FLAG. Never silently drop a row.

OUTPUT CONTRACT - one row per kept owner:
| parcel_id | address | asset_match | year_built_or_size | owner_of_record | owner_mailing_address | classification | flag |
Then: kept / excluded-by-reason / flagged counts.
```

**Human checkpoint.** Plausibility check on the count. You know roughly how many
qualifying properties sit in your submarket. If you expected a few hundred and got
30, a filter or a land-use code is wrong. Fix it here, before it propagates.

---

## Stage 2: SCORE

**What it does.** Runs every kept property against your signal library and ranks
the universe so the most motivated owners rise on their own.

**Paste this:**

```
Run Stage 2 SCORE on the Stage 1 kept rows.

SIGNAL LIBRARY: {paste the signals + points for my asset class from file 04,
04-signal-library.md, or the ones I listed in my deal box}

For each property, list which signals fired, sum the points, and assign a band
(file 06: Priority 50+, Watch 25-49, Background under 25). Show the arithmetic so
I can see why each one ranked where it did. Where a signal needs data I have not
given you, mark it NEEDS DATA and name the source, do not assume it.

OUTPUT CONTRACT:
| parcel_id | owner_of_record | signals_fired | score | band | needs_data |
Sorted by score, highest first.
```

**Human checkpoint.** Read the top of the list. The question is "do these look
like owners I would want to reach this quarter." If the top is full of properties
you would never buy, your signal weights or your deal box need a tune.

---

## Stage 3: RESOLVE

**What it does.** Traces each priority entity to the human behind it with an
evidence chain, and stages the contact for your enrichment provider.

**The data you paste.** Secretary of State business-entity results and recorder /
deed history for the entities you want to resolve (free in most states; file 05).

**Paste this:**

```
Run Stage 3 RESOLVE on my Priority and Watch rows.

ENTITY RECORDS:
{paste Secretary of State filings + deed history for these entities}

Apply the evidence-chain rule: assert a human only with a documented chain, each
link citing its record. Distinguish registered agents from principals. Grade each
resolution HIGH / MEDIUM / LOW. Unresolvable -> UNRESOLVED with the record that
would resolve it. Flag common-name collisions.

For contacts: do NOT invent phone or email. Output the resolved human plus the
fields my enrichment provider needs (full name, mailing address, linked entity)
so I can run enrichment myself, and state what corroborating field must match
before I trust a returned contact.

OUTPUT CONTRACT:
| parcel_id | entity | resolved_human | evidence_chain | confidence | enrichment_inputs | flag |
```

**Human checkpoint.** Review every LOW-confidence chain and every common-name
flag before that owner enters outreach. Never let a letter go out on an
undocumented chain.

---

## Stage 4: REACH

**What it does.** Values your top targets against comps you trust and drafts a
letter, email, and call script for each, personalized only on facts the pipeline
established.

**Paste this:**

```
Run Stage 4 REACH on my top targets.

INPUTS: {Stage 3 resolved rows} + {my valuation template} + {my 3-5 trusted comps}
+ {recent market comps for the submarket} + SENDER PROFILE {from my deal box
sponsor-fit paragraph}

For each target:
1. Select 3-6 comps, stating why each was chosen and why near-misses were
   rejected. Build a line-item adjustment grid (location, size, vintage/condition,
   timing, terms), reconcile to a low/base/high range. Show the arithmetic. Never
   invent rents, NOI, or condition; missing inputs are labeled ASSUMPTION.
2. Draft an owner letter, a first-touch email, and a call script (templates in
   file 08). Personalize ONLY on pipeline facts (hold period, asset specifics,
   submarket activity). No invented familiarity, no dollar figure in the first
   touch, truthful sender identity, a working opt-out on email.

OUTPUT CONTRACT: per target, the value range with its grid, plus the three
outreach pieces with merge slots filled, ready for my edit (not auto-send).
```

**Human checkpoint.** Read every piece before it goes out, and edit it into your
voice. This is the one stage where "good enough" is not good enough, because this
is the part the owner actually sees. Then work file 09, the cadence.

---

## Two ways to run this

- **Conversation mode (this kit, start today).** You pull the data at each stage
  and paste it in; Claude does the screening, tracing, scoring, valuation, and
  drafting. Batch big tables into chunks of 50 to 100 rows so nothing falls out
  of a long table, save each stage output as a file, and feed it forward. Expect
  an afternoon for a submarket.
- **Agent mode (what production looks like).** The same four stages become the
  instructions inside an agentic loop (Claude Code, or the Claude API with tools)
  that queries the data itself and passes structured outputs between stages
  automatically. That is the 38-minute configuration. The prompts in this kit are
  the specification; the stages, contracts, and rules transfer directly.
