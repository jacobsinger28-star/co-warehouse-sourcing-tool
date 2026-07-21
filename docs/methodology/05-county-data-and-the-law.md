# County Data Tiers, and the Law

Deals are not hidden. Signals are. Every parcel is already public: the owner of
record, the sale date, the mortgage, the liens, the tax status all sit in county
and state records right now. The job is not finding secret listings. It is
reading public data for the patterns that say "this owner may transact this year"
and getting there before a broker does.

This file tells you where each stage's data comes from, which pulls are free, and
where the legal line is.

---

## What feeds each stage

| Stage | Needs | Source category | Free? |
|---|---|---|---|
| 1 FIND | Parcel/owner export: address, land-use code, year built or size, owner of record, owner mailing address | County assessor portal, county/city GIS open-data, or a commercial parcel-data provider | Usually free at the county portal |
| 2 SCORE | Tax status, lien records, mortgage age, sale history | Assessor, recorder/register of deeds, tax collector | Mostly free |
| 3 RESOLVE | Entity filings, deed history | Secretary of State business-entity search, county recorder | Free in most states |
| 3 RESOLVE (contacts) | Verified email + cell per person | A contact-enrichment or skip-trace provider | Paid |
| 4 REACH | Recent sale + lease comps | Your comps source, brokerage research, transfer records | Varies |

**The honest split.** The parcel and entity stages are free in most counties:
assessor portal plus Secretary of State search plus recorder gets you through
FIND, SCORE, and the resolution chain without spending a dollar. The one paid
input is the verified contact at the end. Claude resolves the human from public
records; the working phone number comes from your own enrichment provider, not
from Claude. We deliberately do not name vendors: coverage and quality vary by
market, and the prompts treat every source as a pluggable input.

---

## The four county tiers

Sort every county into one tier, then route accordingly.

- **Tier A - free statewide bulk or open API.** Owner name and mailing address,
  no fee, no login. The core path. Pull it on a schedule.
- **Tier B - free per-county portal or GIS service.** Public, no login, but one
  county at a time. Query the service where available, structured-pull it where
  not. One approach per platform covers many counties.
- **Tier C - paid portal, per-record fee, or a no-automation term of service.**
  Route to a licensed parcel-data provider for that county.
- **Tier D - paper or records-request only.** No usable online access. Licensed
  provider or a quarterly manual pull. Rare in most footprints.

---

## The legal posture

Reading genuinely public government data while logged off stands on solid ground
(Van Buren v. United States, 2021; hiQ Labs v. LinkedIn, 2022; Meta v. Bright
Data, 2024). The moment you accept a portal's terms of service that forbid
automation, it becomes a contract question, not a public-data question. Those
counties go to Tier C on purpose, and a licensed provider is the correct backstop,
never a workaround.

**Outreach compliance is yours.** Before you dial, scrub your call list against
the National Do Not Call Registry and any applicable state registry. Emails need
truthful sender identity and a working opt-out line (CAN-SPAM). Some states add
their own telemarketing and solicitation rules. In the UK and EU the same method
ports, only the registries change, and outreach is bound by GDPR. None of this is
legal advice; when in doubt, ask your counsel.

---

## Practical tips

- **Start where data is free.** Assessor plus Secretary of State plus recorder
  carries you through stages 1 to 3 in most counties.
- **One submarket at a time.** The accuracy comes from a specific deal box. Resist
  running a whole metro on day one.
- **Save every raw extract.** The system audits its own claims against the source
  data, so keep every file you fed in.
- **County data is chaos.** Land-use codes differ by county, fields go missing,
  formats drift. The flag-don't-drop rule absorbs most of it, but budget review
  time for flagged rows on your first run in any new county.
