# Methodology — Detecting Adaptive Reuse from Street-Level Imagery

How to decide, from a single Street View image of a building, whether it has been **adaptively
reused** (repurposed from its original use to a materially different one) — and how confident to be.

**Core test (the gate):** adaptive reuse exists when a building's **current use does not match the
use its envelope was built for**. Conversions keep the original purpose-built shell (massing,
openings, windows, roof) and graft new-use fittings onto it, leaving a *visible seam*. So the
detection task is: **does the envelope's design intent mismatch its current use?** If the original
use is still operating (fuel pumps at a station, cars on lifts at a shop, a cross + service-times
sign on a church), it is **original use, not reuse** — cap likelihood ≤ 0.15 regardless of features.

This rubric is grounded in preservation doctrine (the Secretary of the Interior's *Standards for
Rehabilitation* require new work to be "differentiated from the old" — i.e. conversions leave a
legible seam) and in conversion case studies. Sources listed at the bottom.

---

## 1. Taxonomy — original use → new use, and the artifacts each leaves

| Original use | Common new use | Persistent visual artifacts visible from the street |
|---|---|---|
| **Warehouse / factory / mill** | Loft residence, creative office, brewery, retail | Oversized multi-pane steel industrial windows; very tall floor-to-floor; exposed brick/masonry shell; sawtooth or clerestory roof; bow-truss roofline; ghost signage; loading docks; freight doors; smokestack |
| **Auto shop / garage / service bay** | Home, café, brewery, gallery, office | **Large roll-up / overhead / sectional doors retained as the dominant facade feature** (the key tell); wide curb cut / former drive apron; bay-width facade rhythm; concrete forecourt; service-bay canopy |
| **Gas / filling station** | Café, restaurant, bar, retail | Flat cantilevered/oversized **canopy on slim columns** over a patio or entry; small boxy core; pump-island scars or bollards; wide paved forecourt now patio/parking |
| **Church / chapel / synagogue** | Home, condos, restaurant, event space | Pointed-arch (lancet) windows; stained glass; rose window; steeple/bell tower; buttresses; tall single-volume nave — paired with secular signage, residential curtains, or a patio |
| **School / institutional** | Condos, apartments, offices | Symmetrical institutional brick massing; repetitive classroom-window grid; central stone entry with a carved name/date stone — now with unit balconies or leasing signage |
| **Firehouse** | Home, condos, restaurant, museum | Tall, wide **apparatus-bay doors** (now glazed/infilled); hose-drying tower; "ENGINE CO." carved/painted lettering; red detailing; civic brick facade |
| **Grain silo / elevator** | Apartments, hotel, home | Cylindrical clustered concrete/steel tubes; curved walls with **windows cut into the curve**; rooftop penthouses; wrapped balconies |
| **Water tower** | Home, lookout residence | Tall narrow base with a bulbous/boxed former-tank top; new windows + terrace up high; "house on stilts" silhouette |
| **Bank** | Restaurant, bar, retail, home | Monumental classical facade (columns, pediment); heavy stone; a vault door visible inside; "BANK / TRUST" carved above a non-bank tenant |
| **Barn / agricultural** | Home, event venue, brewery | Gambrel/gabled barn silhouette; hayloft door opening; board-and-batten cladding; cupola; sliding barn-track door kept as a feature |
| **Train depot / rail** | Restaurant, home, museum | Platform canopy; ticket-window openings; freight-room doors; trackside loading face beside a rail right-of-way |

---

## 2. Prioritized visual tells — strongest signal first

Ranked by **specificity to a former (non-current) use × visibility from the street** — i.e. how
hard the feature is to explain away as belonging to the current use.

### Tier A — strong, near-diagnostic

**A1. Large garage / roll-up / overhead / sectional door on a building presenting as residential
or non-auto commercial** *(the founder's key tell)*
- *Looks like:* one or more wide (12–24 ft+), tall metal doors — coiling roll-up slats, or
  sectional horizontal panels — set into a facade that otherwise reads as a home (curtains,
  mailbox, house number, landscaping) or a non-automotive business (café tables, gallery
  signage). Often glazed (glass-panel) or propped open as a patio rather than used for vehicles.
- *Why:* these are **commercial/industrial-scale openings**. Residential garage doors run ~7–8 ft
  tall, 8–16 ft wide; commercial roll-up/overhead doors reach 14–24 ft+ and were built for trucks
  and forklifts. A home or café has no functional need for them — their presence means the opening
  predates the current use, and reuse projects deliberately keep them as character.
- *False-positive traps:*
  - **Normal attached home garage** — sectional door ≤ ~8 ft, integrated into the house's cladding
    and roofline, flanked by a pedestrian front door + residential-proportion windows. Distinguish
    by door height/panel style and by the building clearly being a house, not a flat-roofed box.
  - **Still-operating auto shop** — roll-up doors AND auto-commercial cues (bay signage, cars on
    lifts, oil-stained apron, no residential/café fittings). This is original use → gate caps it.
  - **Purpose-built modern townhouse with an oversized glass garage** — high-design new build uses
    tall glass sectional doors aesthetically; if everything else is crisp new construction with no
    aged shell, it's design, not conversion. Lower confidence (≤0.35).
  - **Self-storage** — rows of small roll-up doors; current use *is* storage, not reuse.

**A2. Gas-station canopy over a non-fuel use** — flat/boomerang cantilevered canopy on slim
columns over a café/restaurant patio, no pumps (or pump scars/bollards remain). *Trap:* an
operating station (pumps + fuel-brand signage) = original use; a bank/coffee drive-through canopy
or hotel porte-cochère is purpose-built for the current use (distinguish by the large low
free-standing proportion + the small former-kiosk core behind it).

**A3. Ecclesiastical/institutional massing with secular new-use signage or residential fittings**
— lancet/rose windows, stained glass, steeple, buttresses, tall nave — paired with a restaurant
patio, brewery logo, "condos for sale" sign, residential curtains, or balconies cut into the nave.
*Trap:* an active church (cross, service-times sign) = original use; parish halls/rectories were
always ancillary.

**A4. Firehouse apparatus bays on a residence or restaurant** — a row of tall wide door openings
(now glazed/infilled), "ENGINE CO. No. __" lettering, hose tower, fronting a home or eatery.
*Trap:* an active fire station (apparatus visible, dept. signage).

### Tier B — strong corroboration (rarely diagnostic alone)

- **B1. Oversized multi-pane steel "industrial" (Crittall-style) windows on a residence/office** —
  tall, wide, dense small-pane grid. *Trap:* new-build "industrial-style" imitations — authentic
  conversions pair them with an aged shell + other tells; black-framed modern windows alone are weak.
- **B2. Sawtooth or clerestory factory roofline** — repeating asymmetric glazed ridges, or a raised
  glazed roof monitor. On a home/office/retail use it means a former factory shell. *Trap:* rare
  new sustainable designs + still-operating sheds.
- **B3. Loading dock / raised freight platform / freight doors on a non-industrial building** —
  truck-bed-height platform with bumpers, or tall freight openings, fronting a home/office/retail.
  *Trap:* active warehouse/distribution (trucks docked) = original use.
- **B4. Ghost signage / faded painted wall ads** naming a former business/product over a different
  current tenant. *Trap:* genuine fading/period typography vs. a crisp modern "ghost-sign" decor mural;
  a still-derelict building with a ghost sign isn't *reused* yet.
- **B5. Smokestack / industrial chimney** on a building now used as housing/office/retail.
  *Trap:* active industrial/utility plants; decorative chimneys on grand old institutions.

### Tier C — weak / contextual (raise suspicion; need corroboration)

- **C1. Converted storefront with residential fittings** — display windows/transom/recessed entry
  now showing curtains, blinds, a residential door, houseplants. *Trap:* mixed-use (apartments
  always above shops) isn't reuse; a vacant shop isn't reused yet.
- **C2. Mismatched additions / infill / seams** — newer material/massing grafted on an older shell;
  bricked-in former openings ("blind" arches), changed window rhythm, a rooftop penthouse on an old
  base. *Trap:* ordinary renovation/additions happen on non-reused buildings too.
- **C3. Grain silo / water tower / unusual primary form used as a dwelling** — windows cut into
  curved concrete; tank-top terrace. (Effectively Tier A on the rare occasion it appears.)
- **C4. Carved date stone / building name mismatching the current use** — "1908 — ___ MILL /
  SCHOOL / SAVINGS BANK" above a different-type tenant. *Trap:* commemorative naming for a person/donor.
- **C5. Bay-width modular facade + wide curb cut / forecourt** — low flat-roofed box with repeating
  bay divisions + a wide apron, now a shop/home (former auto/service signature). *Trap:* ordinary
  commercial strips look similar.
- **C6. Disproportionate floor-to-floor height** — unusually tall stories (industrial ~15 ft).
  *Trap:* hard to judge from one oblique image; grand old residences also have tall floors.

---

## 3. Confidence scoring

Output a continuous `adaptive_reuse_likelihood` in **[0.0–1.0]** plus a categorical band.
Evidence-additive, with a use-mismatch gate.

**Step 1 — Establish use mismatch (the gate).** Read (a) the current use (signage, fittings,
residential/commercial cues) and (b) the envelope's original design intent (form, openings, roof).
If they align — original use is still operating — **cap likelihood ≤ 0.15** regardless of features.

**Step 2 — Tally weighted evidence.**

| Evidence | Weight |
|---|---|
| Each **Tier-A** tell present **with confirmed use-mismatch** | **+0.45** |
| Each **Tier-B** corroborating tell | +0.20 |
| Each **Tier-C** contextual tell | +0.08 |
| An explicit current-use cue that conflicts with the form (café tables under a gas canopy; house number + curtains on a roll-up-door box) | +0.15 |

**Step 3 — Apply knock-downs.**

| Condition | Effect |
|---|---|
| The lone suspicious feature is fully explainable by the current use (8-ft suburban garage on an obvious house) | subtract its weight; treat as no evidence |
| Everything is crisp new-build, no aged shell (likely *industrial-style imitation*) | cap ≤ 0.35 |
| Derelict/vacant with old features but no new-use fittings (a *candidate*, not yet reused) | cap ≤ 0.40, flag review |
| Heavy occlusion / poor image / only a sliver of facade visible | cap ≤ 0.50, `needs_human_review = true` |
| Active original-use signage present (gate triggered) | cap ≤ 0.15 |

Clamp to [0, 1].

**Bands & review guidance**
- **High (≥ 0.75):** ≥1 Tier-A tell with confirmed mismatch, OR ≥2 independent Tier-B tells + a
  current-use mismatch cue.
- **Medium (0.45–0.74):** one strong tell but ambiguous current use, or several B/C without a clean A.
- **Low (0.15–0.44):** only weak/contextual tells, or strong imitation-newbuild suspicion.
- **Very low (< 0.15):** gate failed (original use ongoing) or no tells.
- **`needs_human_review = true` when:** score lands in **0.40–0.65**; OR exactly one Tier-A tell has
  a strong innocent explanation (a roll-up door that could be an active shop); OR image
  quality/occlusion blocks reading the current use; OR signals conflict (industrial windows but
  active-church signage).

**The carried-over lesson (from `../offmarket-scraping`):** *no single visual signal is a verdict.*
A lone tell without the use-mismatch confirmation reintroduces exactly the false positives this
rubric exists to kill. When in doubt, lower the score and flag for review — never guess high.

---

## Sources
- Secretary of the Interior's *Standards for Rehabilitation* — nps.gov/subjects/taxincentives;
  NTHP explainer (savingplaces.org).
- Warehouse/industrial → residential features — Ankrom Moisan; Architizer; self-build.co.uk industrial-conversion guide.
- Commercial vs. residential roll-up/overhead doors — Innovative Garage Door; Raynor; Door Systems.
- Gas-station conversions / canopies — NTHP "7 Former Gas Stations"; CNN.
- Sawtooth / clerestory roofs — ArchDaily "The Legacy of the Sawtooth Roof"; Wikipedia "Saw-tooth roof".
- Ghost signs — Wikipedia "Ghost sign"; NTHP; Preservation Texas.
- Church / school / firehouse / silo / water-tower conversions — Dwell; DesignWanted; FireRescue1;
  Dezeen silos; Inhabitat; WebUrbanist.
