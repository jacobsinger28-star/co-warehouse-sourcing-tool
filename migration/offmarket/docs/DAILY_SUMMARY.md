# Daily summary — for Jake

> Plain-English, founder-facing digest of what got done each day and what I need from
> you to keep moving. Newest entry on top. Engineering detail lives in
> [BUILD_LOG.md](BUILD_LOG.md); the full tools/accounts shopping list is
> [TOOLS_REGISTRY.md](TOOLS_REGISTRY.md).

---

## 2026-06-16 — Added a second city: Charlotte, NC

**What you asked for:** find off-market industrial deals in Charlotte, the same way we did Nashville.

**What I did:** pointed the whole machine at **Charlotte / Mecklenburg County** using only free
government data — no accounts, no keys, nothing on Crexi/LoopNet. Found the county and city public
map services, verified each one was live, pulled them in, and ran them through the exact same
scoring engine Nashville uses. Charlotte's data lives in its own walled-off section of the database,
so it can't touch or disturb the Nashville numbers.

**Result — 566 off-market industrial properties (75k+ SF) found and ranked**, with owner, building
size, year, how long they've held it, and any code-violation / permit red flags. They show up in
the **same dashboard** now — there's a "City" dropdown to switch between Charlotte and Nashville.
Top of the Charlotte list is the profile we want: old (1950s–70s) mid-size warehouses, long-held,
several owned out-of-state, several with active code cases (e.g. 700 W 28th St, 2815 N Church St).

**Where it is:** ranked list at `exports/ranked_charlotte_20260616_final.csv`; dashboard at
`exports/dashboard.html` (the "City" filter → Charlotte). Run it again any time with `make charlotte`.

**A couple of honest notes on the Charlotte data:**
- Charlotte's **code-violation feed only shows the last ~8 weeks** (the county doesn't expose older
  cases). It's still a strong "active problem right now" signal, but the full history will fill in
  as our weekly run keeps a running record. (Nashville's goes back further.)
- The county tags some parcels "vacant" even when they clearly have a building, so that tag is
  unreliable — I did **not** let it drive the score. Real vacancy still comes from the photo step
  (same as Nashville), which needs the imagery key below.

**What I need from you for Charlotte (same shape as Nashville — details in
[TOOLS_REGISTRY.md](TOOLS_REGISTRY.md) §4b/§7):**
1. **Charlotte submarket boundaries** — right now I'm using a rough ~20-mile circle around uptown.
   If you draw the actual submarkets you care about, the 566 tightens to the right ones. (optional)
2. **Mecklenburg delinquent-tax list** — the Charlotte version of the Trustee file (from the County
   Tax Collector); unlocks the tax-distress points. (P1)
3. **~Top-100 Charlotte A/B/C grades** so I can calibrate the scoring for this market. (P1)
4. The shared stuff already on the list — **imagery + skip-trace keys** — works for Charlotte too;
   no new accounts needed, the same ones cover both cities.

---

## 2026-06-16 — Owner contact info for the call list

**What you asked for:** phone numbers / emails on the leads.

**What I did:** we still don't have a skip-trace account, and our rule is to never make up a
phone number. So instead of paying for a trace, I researched the **top 50 owners** against
public records (company sites, the TN Secretary of State, business directories) and pulled in
only contact info I could back with a real source. Anything I couldn't verify, I left blank
with a note on exactly where to look next — no guessing, and I never attributed a tenant's
phone number to an owner.

**Result — 37 of the 50 owners (74%) now have a phone, 16 have an email**, plus owner/principal
names and registered agents for most of the rest. That's actually better than the ~50–60% a paid
skip-trace typically returns. Honest caveat: many of these are main business/switchboard lines,
not personal cells — each row is labeled with how good the contact is and where it came from.

**Where it is:** the dial-ready list is `exports/leads_dialready_20260616.csv` (rank, score,
property, owner, phones, emails, website, principals, registered agent, confidence, source, notes).
The same numbers also flowed into the call sheets, so each property's sheet now shows its phone(s).
*(These files contain owner contact info, so they stay off GitHub — they live on the machine /
the dashboard.)*

**What I need from you (details + costs in [TOOLS_REGISTRY.md §3](TOOLS_REGISTRY.md)):**
1. **A DNC scrub** before we dial anything — it's a legal step and none of these numbers are
   scrubbed yet. (P2)
2. **A BatchSkipTracing account** to finish the last **13 owners** (opaque holding companies /
   trusts that aren't in public records) and to get **personal cell numbers** instead of front
   desks. (P2)
3. Still open from before: the **Trustee delinquent-tax CSV** and your **top-100 A/B/C grades**
   for score calibration. (P1)

**Good news that cost nothing:** I found a free TN business-records site (`opengovus.com`) that
isn't behind the CAPTCHA walls that block the official portal — it's now our go-to for finding
the real human behind an LLC, so the manual SOS step is faster and cheaper than expected.
