#!/usr/bin/env python3
"""
call_sheets.py — per-property dial sheets the founder calls from (Day 10).

Renders one Markdown sheet per target property (brief §8): address/SF/year, owner +
resolved person + phones + confidence, hold years + last sale, every distress signal
WITH its date and source link, VLM observations (pending until imagery runs), and the
open questions to verify on the call.

HARD RULE (brief §8): nothing appears as a fact without a source reference; machine
guesses are labelled as guesses. Anything we don't have yet is shown as an explicit
gap ("pending"), never fabricated.

Target selection mirrors skiptrace_export: --grade A, else --top N by score.

    python outreach/call_sheets.py --top 25 --out exports/call_sheets/
"""
from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from imagery.record_observation import maps_urls  # noqa: E402
from lib import sources as S  # noqa: E402
from lib.db import cursor  # noqa: E402

TARGETS_SQL = """
WITH latest AS (
  SELECT DISTINCT ON (apn) apn, total, components, grade_human
  FROM scores WHERE version LIKE '%-final' ORDER BY apn, scored_at DESC
),
owner AS (
  SELECT DISTINCT ON (o.apn) o.apn, e.entity_id, e.name_raw, e.entity_type,
         e.mailing_address, e.is_out_of_state, e.portfolio_group_id
  FROM ownerships o JOIN entities e USING (entity_id) ORDER BY o.apn, e.entity_id
)
SELECT l.apn, l.total, l.components, l.grade_human,
       p.situs_address, p.land_use_desc, p.zoning_code,
       pr.building_sf, pr.building_sf_largest, pr.building_count, pr.year_built,
       pr.distance_miles_icbd, pr.hold_years, pr.last_sale_date, pr.last_sale_price,
       pr.assessed_value, pr.sf_confidence, pr.clear_height_est,
       ow.entity_id, ow.name_raw, ow.entity_type, ow.mailing_address,
       ow.is_out_of_state, ow.portfolio_group_id
FROM latest l
JOIN parcels p USING (apn)
JOIN properties pr USING (apn)
LEFT JOIN owner ow ON ow.apn = l.apn
WHERE l.total IS NOT NULL
ORDER BY l.total DESC
"""


def fmt(n, money=False):
    if n is None:
        return "—"
    return f"${float(n):,.0f}" if money else f"{float(n):,.0f}"


def fmt_phone(p: str) -> str:
    return f"({p[0:3]}) {p[3:6]}-{p[6:]}" if p and len(p) == 10 and p.isdigit() else p


def signals_for(apn: str) -> list[dict]:
    with cursor(dict_rows=True, commit=False) as cur:
        cur.execute(
            "SELECT type, detail, event_date, source_ref, verified "
            "FROM distress_signals WHERE apn = %s ORDER BY event_date DESC NULLS LAST",
            (apn,))
        return cur.fetchall()


def contacts_for(entity_id) -> list[dict]:
    if not entity_id:
        return []
    with cursor(dict_rows=True, commit=False) as cur:
        cur.execute(
            "SELECT person_name, role, phones, emails, source, confidence, dnc_checked "
            "FROM contacts WHERE entity_id = %s ORDER BY confidence DESC", (entity_id,))
        return cur.fetchall()


def portfolio_count(pg_id) -> int:
    if pg_id is None:
        return 1
    with cursor(dict_rows=True, commit=False) as cur:
        cur.execute(
            "SELECT count(DISTINCT o.apn) AS n FROM entities e "
            "JOIN ownerships o USING (entity_id) WHERE e.portfolio_group_id = %s", (pg_id,))
        return cur.fetchone()["n"]


def observation_for(apn: str) -> dict | None:
    """The imagery/VLM pass for this parcel, if one exists (site_observations)."""
    with cursor(dict_rows=True, commit=False) as cur:
        cur.execute(
            "SELECT image_paths, captured_at, vlm_json, dock_doors_est, drive_ins_est, "
            "parking_fullness, signage_present, condition, divisibility, truck_access, "
            "model_version, human_verified FROM site_observations WHERE apn = %s", (apn,))
        return cur.fetchone()


# How the VLM occupancy read translates for a caller (mirrors scoring/rules.py _vacancy).
def _occupancy_label(parking: str | None, signage: str | None) -> str:
    if parking == "empty" and signage == "no":
        return "**vacancy signals** — empty lot, no signage (strongest off-market tell)"
    if parking in ("empty", "sparse") or signage == "no":
        return "**possible vacancy** — sparse parking / no signage"
    if parking == "not_visible" and signage == "not_visible":
        return "occupancy unclear from imagery"
    if parking is None and signage is None:
        return "not assessed"
    return "clearly active (occupied)"


def site_assessment_lines(apn: str) -> list[str]:
    """The '## Site assessment' block. Renders the real imagery pass when one exists;
    otherwise the honest 'pending' line. Every claim is sourced to the image + capture
    date; nothing is invented (brief §8)."""
    obs = observation_for(apn)
    L = ["## Site assessment (imagery / VLM)"]
    if not obs:
        L.append("- *pending — no imagery pass yet for this parcel "
                 "(top of queue first; see docs/SCREENSHOT_USES.md).*")
        return L

    vlm = obs["vlm_json"] or {}
    cap = obs["captured_at"].isoformat() if obs["captured_at"] else "date n/a"
    src = maps_urls(apn).get("satellite", "google maps satellite")
    L.append(f"- **Source:** {(', '.join(obs['image_paths']) if obs['image_paths'] else '—')} "
             f"via {obs['model_version']}, captured {cap}"
             f"{' · human-verified' if obs['human_verified'] else ''}")
    L.append(f"  - [{src}]({src})")
    L.append(f"- **Occupancy:** {_occupancy_label(obs['parking_fullness'], obs['signage_present'])} "
             f"(parking {obs['parking_fullness'] or '—'}, signage {obs['signage_present'] or '—'})")

    use = vlm.get("use_truth") or {}
    if use.get("actual_use"):
        match = use.get("matches_landuse")
        flag = (" — ✓ matches assessor land use" if match is True
                else " — ⚠️ NO LONGER MATCHES assessor land use (verify before pursuing)"
                if match is False else "")
        L.append(f"- **Observed use:** {use['actual_use']}{flag}")

    ten = vlm.get("tenant") or {}
    names = ten.get("operating_business") or []
    if names or ten.get("tenancy") or ten.get("occupancy"):
        bits = []
        if names:
            bits.append(", ".join(names))
        meta = " / ".join(x for x in (ten.get("tenancy"), ten.get("occupancy")) if x)
        L.append(f"- **Operating tenant(s):** {bits[0] if bits else '—'}"
                 f"{f' ({meta})' if meta else ''}")

    phys = []
    if obs["dock_doors_est"] is not None:
        phys.append(f"~{obs['dock_doors_est']} dock doors")
    if obs["drive_ins_est"] is not None:
        phys.append(f"~{obs['drive_ins_est']} drive-ins")
    if obs["divisibility"]:
        phys.append(f"divisibility {obs['divisibility']}")
    if obs["truck_access"]:
        phys.append(f"truck access {obs['truck_access']}")
    if obs["condition"]:
        phys.append(f"condition {obs['condition']}")
    if phys:
        L.append(f"- **Physical:** {' · '.join(phys)}")
    if vlm.get("context"):
        L.append(f"- **Context:** {vlm['context']}")
    if vlm.get("note"):
        L.append(f"- **Observed:** {vlm['note']}")
    return L


def render(r: dict, rank: int) -> str:
    apn = r["apn"]
    sigs = signals_for(apn)
    cons = contacts_for(r["entity_id"])
    pcount = portfolio_count(r["portfolio_group_id"])
    mapq = (r["situs_address"] or "").replace(" ", "+") + ",+Nashville,+TN"
    L = []
    L.append(f"# Call sheet — {r['situs_address'] or '(no address)'}")
    L.append(f"*Rank #{rank} · score {float(r['total']):.0f}/100 · APN `{apn}`"
             f"{' · grade ' + r['grade_human'] if r['grade_human'] else ''}*")
    L.append("")
    L.append("## Property")
    L.append(f"- **Building:** {fmt(r['building_sf'])} SF total across "
             f"{r['building_count'] or '?'} building(s); largest {fmt(r['building_sf_largest'])} SF")
    if r["sf_confidence"] == "mismatch":
        L.append("  - ⚠️ *assessor SF looks inconsistent with parcel size — verify on the call*")
    L.append(f"- **Year built:** {r['year_built'] or '—'} · **Land use:** "
             f"{r['land_use_desc'] or '—'} · **Zoning:** {r['zoning_code'] or '—'}")
    if r["clear_height_est"] is not None:
        L.append(f"- **Clear height (est.):** ~{float(r['clear_height_est']):.0f} ft — "
                 f"roof height from 2022 aerial LiDAR; interior clear is typically 2–4 ft "
                 f"less. An estimate, not a public spec — confirm on the call.")
    L.append(f"- **Distance to core:** {fmt(r['distance_miles_icbd'])} mi · "
             f"**Assessed value:** {fmt(r['assessed_value'], money=True)}")
    L.append(f"- **Map:** https://www.google.com/maps/search/?api=1&query={mapq}")
    L.append("")
    L.append("## Owner")
    L.append(f"- **On title:** {r['name_raw'] or '—'} ({r['entity_type'] or '?'})"
             f"{' · out-of-state' if r['is_out_of_state'] else ''}")
    L.append(f"- **Mailing:** {r['mailing_address'] or '—'}")
    L.append(f"- **Hold:** {fmt(r['hold_years'])} years"
             + (f" · **Last sale:** {r['last_sale_date']} for {fmt(r['last_sale_price'], money=True)}"
                if r['last_sale_date'] else " · last sale: —"))
    if pcount > 1:
        L.append(f"- **Portfolio:** this owner group holds ~{pcount} parcels in our universe")
    L.append("")
    L.append("### Phone(s)")
    if cons:
        for c in cons:
            phones = ", ".join(fmt_phone(p) for p in c["phones"]) if c["phones"] else "no number returned"
            dnc = "" if c["dnc_checked"] else " · ⚠️ DNC not checked"
            L.append(f"- {phones} — *{c['confidence']} confidence, via {c['source']}*{dnc}"
                     + (f" ({c['person_name']})" if c['person_name'] else ""))
    elif r["entity_type"] and r["entity_type"] not in ("individual",):
        L.append("- *pending — LLC/trust: resolve to a human via the TN SOS SOP, then skip-trace*")
    else:
        L.append("- *pending — run skip-trace export/import*")
    L.append("")
    L.append("## Distress signals (the reason to call)")
    if sigs:
        for s in sigs:
            d = s["event_date"].isoformat() if s["event_date"] else "date n/a"
            src = s["source_ref"] or "(no source!)"
            L.append(f"- **{s['type'].replace('_', ' ')}** ({d}) — {s['detail'] or ''}")
            L.append(f"  - source: {src}")
    else:
        L.append("- none on file (ranked on owner profile / location / vintage)")
    L.append("")
    L.extend(site_assessment_lines(apn))
    L.append("")
    L.append("## Verify on the call")
    if r["clear_height_est"] is not None:
        L.append(f"- **Clear height** — LiDAR roof est ~{float(r['clear_height_est']):.0f} ft; "
                 f"confirm interior clear (16'+ good, 12' weak).")
    else:
        L.append("- **Clear height** — no LiDAR estimate; always confirm (16'+ good, 12' weak).")
    L.append("- **Actual occupancy / vacancy** — confirm who (if anyone) is in the building.")
    L.append("- **Willingness to sell / lease** and rough price expectation.")
    if r["sf_confidence"] == "mismatch":
        L.append("- **True building size** — our assessor SF figure is flagged uncertain.")
    L.append("")
    L.append(f"<sub>Generated {date.today():%Y-%m-%d}. Facts cite a source; "
             f"absent data is marked pending, never guessed.</sub>")
    return "\n".join(L)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--grade", choices=("A", "B", "C"), default=None)
    ap.add_argument("--top", type=int, default=25)
    ap.add_argument("--out", default="exports/call_sheets/")
    args = ap.parse_args()

    with cursor(dict_rows=True, commit=False) as cur:
        cur.execute(TARGETS_SQL)
        rows = cur.fetchall()
    if args.grade:
        graded = [r for r in rows if r["grade_human"] == args.grade]
        rows = graded if graded else rows[: args.top]
        if not graded:
            print(f"  !! no '{args.grade}'-graded properties yet — using top {args.top} by score")
    else:
        rows = rows[: args.top]

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    index = ["# Call queue — generated {}\n".format(date.today().isoformat()),
             f"{len(rows)} sheets, ranked by score.\n", "| # | Score | Address | APN | Owner |",
             "|---|---|---|---|---|"]
    for i, r in enumerate(rows, 1):
        sheet = render(r, i)
        fn = f"{i:03d}_{r['apn']}.md"
        (out_dir / fn).write_text(sheet, encoding="utf-8")
        index.append(f"| {i} | {float(r['total']):.0f} | {r['situs_address'] or '—'} "
                     f"| `{r['apn']}` | [{(r['name_raw'] or '?')[:30]}]({fn}) |")
    (out_dir / "INDEX.md").write_text("\n".join(index), encoding="utf-8")
    print(f"  call sheets: {len(rows)} written to {out_dir} (+ INDEX.md)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
