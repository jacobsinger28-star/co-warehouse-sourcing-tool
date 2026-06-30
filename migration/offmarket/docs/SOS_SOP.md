# SOP — resolve owner LLCs to humans (TN SOS) + lis-pendens check

A ~2-minute-per-owner manual routine. Most of our top owners are LLCs / trusts /
corporations, not people — you can't skip-trace "DOGWOOD HOLDINGS II PROPCO TN, LLC"
for a phone number. This finds the human behind the entity so they can be traced and
called. Delegable to a VA after the first few.

**Worklist:** run `make skiptrace-export` → open the CSV → every row with
`needs_sos_first = yes` needs this SOP. Rows marked `no` are individuals — skip straight
to skip-tracing. Do the highest `best_score` rows first.

---

## Part A — TN Secretary of State: entity → human (tnbear.tn.gov)

1. Go to **https://tnbear.tn.gov/Ecommerce/FilingSearch.aspx** (Business Information Search).
2. Search the entity name exactly as in the `owner_name` column (try without the trailing
   "LLC/LP/INC" if no exact hit; try the distinctive words only).
3. Open the matching active record. Record:
   - **Registered Agent** — name + address (this is the most reliable human/contact).
   - **Principal office address** (sometimes differs from the assessor mailing address).
   - **Officers / members** if listed (filings vary; many TN LLCs list little).
4. If the agent is a commercial registered-agent service (e.g. "CT Corporation",
   "Registered Agents Inc", "Corporation Service Company") it's a dead end for a human —
   note `agent=commercial` and fall back to the assessor mailing address + the entity
   name for a *business* skip-trace instead.
5. Cross-entity tip: the same person often controls several of our LLCs. If a registered
   agent shows up on multiple worklist rows, resolve once and reuse.

**Record the result** so it flows into the pipeline. Easiest: add a row to a
`imports/sos_contacts.csv` with columns:
`entity_id, person_name, role, mailing_street, mailing_city, mailing_state, mailing_zip`
(role = `registered_agent` | `officer` | `member`). `entity_id` comes from the export CSV.
Those resolved people are then the skip-trace upload (name + address → phone).

> Goal for the first batch (plan Day 9): **≥15 A-tier owners resolved to a human.**

---

## Part B — lis pendens / pre-foreclosure check (A-tier owners only)

A pre-foreclosure filing is a strong motivation signal that's invisible in our automated
feeds. ~2 min, only worth it for the top owners.

1. Go to the **Davidson County Register of Deeds** search: **https://recordsonline.nashville.gov**
   (a.k.a. recdsonline.com). Search by the **owner/entity name**.
2. Look for recent **"Lis Pendens"**, **"Notice of Trustee's Sale"**, or **"Substitute
   Trustee"** instruments.
3. If found, this is a top-priority flag. Record it as a distress signal:
   add to `imports/lis_pendens.csv`: `apn, detail, event_date, source_ref`
   (source_ref = the recordsonline document/instrument number or URL). It will load as a
   `distress_signals` row (type `lis_pendens`) — every signal needs a source, no exceptions.

---

## What happens after you finish

1. Drop `imports/sos_contacts.csv` → (loader maps resolved people into `contacts`,
   source `sos_manual`) → they join the next skip-trace export.
2. `make skiptrace-export` → upload to BatchSkipTracing → `make skiptrace-import FILE=...`
   → phones land in `contacts`.
3. `make call-sheets` → per-owner dial sheets, now with phone numbers.
4. **DNC:** scrub numbers against Do-Not-Call before dialing — `contacts.dnc_checked`
   stays FALSE until that's done. Call sheets surface the warning.

*(Note: the `sos_contacts.csv` / `lis_pendens.csv` loaders are thin importers — wire them
into `import_csv.py` when the founder runs the first SOS batch; the CSV shapes above are
the contract.)*
