# What I need from you to unblock Stage 0

> The single gating dependency for this whole project is **Stage 0 — getting every past
> deal/LOI into one indexed place**. The tooling is built and tested; the *data* doesn't exist
> in the repo yet (only the example row). Everything below is an **input from a human** — an
> access grant, a decision, a piece of information, a sample artifact, or a confirmation. Drafted
> 2026-06-25 from a full sweep of the repo docs, the external `.private/` context, and the tooling
> assumptions. Owners are best-guess from the docs — correct them.

## ⭐ If you only do three things

1. **Where does Simi's LOI / past-deal history actually live today?** (Pipedrive attachments? a
   shared drive? scattered inboxes? a mix?) → **Aaron.** This is the #1 blocker — nothing
   downstream is better than this input.
2. **Pipedrive access** — plan/tier + an API token, or at minimum a one-row-per-deal export with
   stage, dates, owner, economics → **Aaron.** It's the recommended first intake step (60–80% of
   the columns with zero reading).
3. **Pick the single canonical home** for the Deal Archive (Google Drive / SharePoint / Dropbox)
   and give me write access → **Aaron.** That's where `deal-index.csv` and the `/deals/<id>/`
   folders live; the bus-factor rule forbids a personal laptop.

These three are independent and can go out in parallel — together they unblock the index, the
folders, and the chatbot. The cleanest move is to put all of them on the **week-1 PRD-call
question list** (see the "decisions for you" section on whether I draft that now).

---

## 1. Forward to Aaron (the PRD call)

- **Where the LOIs live** (the #1 ask above) — and **confirm whether it's "scattered"** vs already
  consolidated. This sizes Stage 0 from "10 deals" to "300 deals."
- **Pipedrive access** (plan/tier + API token; export acceptable as a fallback).
- **Designate + grant access to the canonical archive home.** Fold in the storage logistics: is
  there **capacity** for the LOI PDFs, is it **backed up**, and is it the **system of record** or a
  copy? "Storage already exists" is assumed but never confirmed.
- **Historical cutoff + rough volume** — how far back are deals in scope (all-time vs last N years),
  and roughly **how many deals** is that? (Distinct from the stage question below; this is the time
  window. It also feeds the Claude-Project knowledge-size decision.)
- **Confirm the controlled vocabularies** cover Simi's real deals, or give corrections — especially
  any asset class outside `industrial / multifamily / retail / office / hospitality / IOS / carwash
  / other` (self-storage? MH parks? land? mixed-use?). The linter **hard-rejects** off-list values.
- **The teammate roster** — the canonical list of named teammates for `relationship_owner`, plus
  **who is authorized to read** the archive and the Claude Project. Free-text owner names fragment a
  teammate's deals; "internal-only, access-controlled" needs actual names attached.
- **The 3 open Phase-1 discovery questions** (from the internship plan): (1) is RenomyHelper mine to
  extend or someone's production system; (2) is Pipedrive the "limited CRM" Aaron complained about;
  (3) broker-side vs owner-side outreach first.

## 2. Get from Andrew (greenlight + scope)

- **🚩 Legal / NDA go-ahead to upload deal docs into a third-party LLM.** Stage 1 loads the actual
  LOI PDFs (pricing, terms, broker identities — commercially sensitive, possibly NDA-bound) into a
  Claude Project as "knowledge." Confirm Simi is *contractually allowed* to do that, and whether any
  specific deal carries an NDA that forbids it. This should clear **before** standup, not after.
- **Greenlight (or hold) past Stage 1** — whether to build the Stage 2 `/ask` page and/or Stage 3
  RAG once consolidation is done. Default is to cap at Stage 1 until he says "keep going."
- **Is RenomyHelper / NashbilleSourcing sourcing-stage data in scope** for the archive, or only
  closed/LOI'd deals? (Sets how much sourcing noise enters the corpus.)
- **The no-document boundary** — do Pipedrive deals with *no* document get an index row now, or are
  they deferred? (The reconcile tool currently just *warns* on these; someone has to rule.)
- **PII-handling policy** for owner phone/email enrichment (internal-only, access-controlled) — ratify
  before any enrichment is ingested.
- **Confirm the inbox boundary stays closed** — bot reads deal archive + Pipedrive only, never
  inboxes; adding email threads is a deliberate, policy-backed opt-in (a leadership call).
- **The real success bar + the actual use-case email.** The smoke tests are built to "map to
  Andrew's email," but that email isn't in the repo. Get the real list of questions he expects the
  bot to answer, one **real owner/property** I can demo live, and what makes him call Stage 1 a win.

## 3. Decisions only you (Raz) can make

- **🚩 Timeline + your capacity.** Nothing here has a "by when." When is the PRD call actually
  scheduled, what's the target date to show Andrew Stage 1, and how many hours/week do you (or
  someone) have for the consolidation labor? Stage 0 is "labor only" — without this the estimate is
  unanchored.
- **Hoist the shared context docs** out of `../easybay-demo/.private/` (in-flight.md,
  internship-plan, the Andrew emails, company-data.md, the F4 dedupe-spine plan) into this repo or an
  umbrella level — or decide to leave them. Right now this repo's runbook depends on a sibling repo's
  private folder that may not travel.
- **Confirm the bot's audience/voice** — internal acquisitions team + principals only, plain-English
  analyst tone, internal/confidential, nothing external-facing. (It's baked into the prompt.)
- **Confirm the canonical schema/conventions** for the validator, or correct them: the 25-column
  header (and how Pipedrive maps onto it), the `deal_id` slug convention (is the trailing year
  mandatory), the doc-required stages, the cap-rate 1–20% band, and **whether `relationship_owner`
  should be validated against the fixed teammate allowlist** instead of free text.
- **Knowledge-prioritization rule** if the archive exceeds Claude-Project limits (index always in,
  then which LOIs — most-referenced vs most-recent). Outgrowing this is itself the Stage 3 trigger.
- **Should I draft the PRD-call question list now?** Both session logs flag it as the highest-leverage
  unblock. Say the word and I'll write it (it's zero-external-input).

## 4. Sample data to hand me (so I can trust the tooling on real data)

- **One real anonymized Pipedrive export (CSV)** — so I can confirm the column set/order matches the
  header, the vocabs map, `pipedrive_id` is a plain integer, and dates arrive ISO `YYYY-MM-DD`.
  **Also tell me who owns the field-mapping** (Pipedrive won't export in our schema; a header
  mismatch hard-fails the linter) and what date format it produces.
- **1–2 real anonymized LOI PDFs/Word docs** — so I can confirm the economics columns (ask_price,
  our_offer, cap_rate, $/sqft, key_terms) are actually extractable and that filenames match the
  `source_docs` convention.

## 5. From whoever remembers the deals (any teammate, ~15 min)

- **Backfill `why_passed_tag` + notes** from memory for deals where the reason isn't in a document.
  This is the highest-value, lowest-coverage column — the thing that makes the bot say something no
  spreadsheet can. Land it before showing Andrew (two smoke-test questions depend on it).
- **Map each deal to its `relationship_owner`** (which teammate owns the relationship) — the
  "don't step on a colleague" signal, usually human knowledge not in the export.

## 6. Deferred — only when Andrew greenlights past Stage 1 (NOT blocking now)

- Confirm the **Vercel ~$20/mo** budget when Stage 2 is triggered.
- Approve the **~$50–100/mo Stage 3 envelope** (Neon, Voyage, Cohere, Claude API) + provision those
  accounts, when the corpus/usage trigger is hit.
- Provide a **separate `ANTHROPIC_API_KEY`** (distinct from the Pro chat seat) + the card to route it
  to, once programmatic calls begin.

---

## Sequencing

Do the three ⭐ asks first, in parallel — they're independent but block almost everything. Once the
Pipedrive export and 1–2 sample LOIs are in hand, validate the tooling and confirm/correct the
vocabs + schema against *real* data **before** ingesting the full archive (a header or vocab
mismatch hard-fails the linter). The ~15-min memory backfill can run in parallel with consolidation
but must land before the Andrew demo. The Claude Projects seat is only needed at Stage 1 standup;
all budget/API-key items are deferred until the explicit greenlight — don't chase them now.

> **FYI (not an ask):** the sweep found the external `.private/` context docs carry some **superseded
> decisions** (e.g. `company-data.md` still says "Optix selected" but later docs flip to
> Nexudus-pending; older emails still show a Reonomy API buy that the June-16 docs killed). Those are
> EasyBay-sibling concerns, not deals-database — but it's a reason the "hoist + refresh the context
> docs" decision above is worth doing rather than trusting them in place.
