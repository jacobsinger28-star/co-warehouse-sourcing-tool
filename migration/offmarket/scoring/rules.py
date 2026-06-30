"""
Pure scoring engine. No database, no I/O — give it a facts dict, get back a fully
decomposed, explainable score. scoring/score.py wraps this with DB read/write.

Design rules (from ENGINEER_BRIEF.md):
  * No weight is hardcoded here — every number comes from weights.yaml.
  * Components sum to `total`; the full breakdown is returned so "why is this #3?"
    is always answerable.
  * Gates are evaluated BEFORE scoring. A property below the SF gate or outside
    the buy box is never assigned a score (it gets a status instead).

`facts` is the normalized view of one property. Any field may be None/missing.

MISSING-DATA CONVENTION (HEALTH_AUDIT §A2): a missing scoring signal contributes 0 to its
component (absent evidence = no points) and never crashes. The one DELIBERATE exception is
the owner out-of-state signal — when the mailing state or the market's home state is unknown,
`is_out_of_state` is None and the owner-profile rule simply does NOT fire (neutral, not a
penalty; see transform/normalize.py + scoring/score.py). Keep new scorers on the 0-convention
unless there is a documented reason to go neutral. See FACTS_SHAPE.
"""
from __future__ import annotations

from typing import Any

from lib.config import load_weights

# Documentation of the expected facts dict. Every key is optional; absent => 0.
FACTS_SHAPE = {
    "apn": "str",
    # --- gate inputs ---
    "building_sf": "float | None   (summed/largest per parcel — see build_universe)",
    "land_use_industrial": "bool   (passed the land-use filter)",
    "in_target_submarket": "bool   (point-in-polygon vs buy-box)",
    "distance_miles_icbd": "float | None",
    # --- scoring inputs ---
    "parking_fullness": "'empty'|'sparse'|'moderate'|'full'|'not_visible'|None",
    "signage_present": "'yes'|'no'|'not_visible'|None",
    "tax_delinquency_years": "int | None   (from Trustee CSV; None => component 0)",
    "dock_doors_est": "int | None",
    "drive_ins_est": "int | None",
    "divisibility": "'single_box'|'some_separation'|'multi_entry'|'not_visible'|None",
    "condition": "'good'|'fair'|'poor'|'not_visible'|None",
    "truck_access": "'easy'|'tight'|'bad'|'not_visible'|None",
    "code_violations_24mo": "int",
    "hold_years": "float | None",
    "entity_type": "'llc'|'trust'|'individual'|'corp'|None",
    "is_out_of_state": "bool",
    "estate_keyword": "bool",
    "permit_lapsed_or_expired": "bool",
    "permit_none_10yr_pre1985": "bool",
    "cama_condition": "'poor'|'fair'|None   (assessor CAMA condition/obsolescence; absent => 0)",
    "year_built": "int | None",
    # --- data-confidence deduction flags ---
    "sf_mismatch": "bool",
    "violation_join_uncertain": "bool",
    "no_usable_imagery": "bool",
}


# --------------------------------------------------------------------------- #
# Gates
# --------------------------------------------------------------------------- #
def evaluate_gates(facts: dict[str, Any], gates: dict) -> tuple[str, str]:
    """
    Return (status, reason).
      status == 'scored'        -> proceed to scoring
      status == 'manual_review' -> 60k-75k SF grey zone; surfaced, not scored
      status == 'excluded'      -> fails a hard gate; never scored
    """
    sf = facts.get("building_sf")
    min_sf = gates["min_building_sf"]
    floor_sf = gates.get("manual_review_sf_floor", min_sf)

    if not facts.get("land_use_industrial", False):
        return "excluded", "land use not industrial"
    if not facts.get("in_target_submarket", False):
        return "excluded", "outside buy-box submarket"

    dist = facts.get("distance_miles_icbd")
    if dist is not None and dist > gates.get("max_distance_miles", float("inf")):
        return "excluded", f"distance {dist:.1f}mi exceeds gate"

    if sf is None:
        return "excluded", "building_sf unknown"
    if sf < floor_sf:
        return "excluded", f"building_sf {sf:.0f} below manual-review floor"
    if sf < min_sf:
        return "manual_review", f"building_sf {sf:.0f} in {floor_sf:.0f}-{min_sf:.0f} grey zone"
    return "scored", "passes all gates"


# --------------------------------------------------------------------------- #
# Component scorers — each reads its own slice of weights.yaml, returns points.
# Each returns (points, rule_fired) so the breakdown explains itself.
# --------------------------------------------------------------------------- #
def _vacancy(facts, comp) -> tuple[float, str]:
    r = comp["rules"]
    parking = facts.get("parking_fullness")
    signage = facts.get("signage_present")
    if parking == "empty" and signage == "no":
        return r["empty_lot_no_signage"], "empty_lot_no_signage"
    if parking in ("empty", "sparse") or signage == "no":
        return r["sparse_or_no_signage"], "sparse_or_no_signage"
    # 'ambiguous' (5) means the VLM RAN and could not tell — literal not_visible on
    # both fields. Not-yet-assessed (None, e.g. provisional stage before imagery)
    # must score 0, or every property gets a free uniform 5 before VLM runs.
    if parking == "not_visible" and signage == "not_visible":
        return r["ambiguous"], "ambiguous"
    if parking is None and signage is None:
        return 0, "not_assessed"
    return r["clearly_active"], "clearly_active"


def _tax_delinquency(facts, comp) -> tuple[float, str]:
    r = comp["rules"]
    yrs = facts.get("tax_delinquency_years")
    if yrs is None:
        return 0, "no_trustee_file"  # file absent => 0, do not block (brief)
    if yrs >= 2:
        return r["two_plus_years"], "two_plus_years"
    if yrs == 1:
        return r["one_year"], "one_year"
    return r["current"], "current"


# NOTE: _tax_delinquency tiers are frozen by tests/test_scoring.py
# (test_tax_delinquency_tiers_all_reachable) — ledger #3: the 'two_plus_years' tier was
# once structurally unreachable. Keep all three tiers reachable + monotone in weights.yaml.
def _proximity(facts, comp) -> tuple[float, str]:
    r = comp["rules"]
    d = facts.get("distance_miles_icbd")
    if d is None:
        return 0, "distance_unknown"
    if d < 3:
        return r["under_3_miles"], "under_3_miles"
    if d < 5:
        return r["3_to_5_miles"], "3_to_5_miles"
    if d < 7:
        return r["5_to_7_miles"], "5_to_7_miles"
    if d <= 10:
        return r["7_to_10_miles"], "7_to_10_miles"
    return r["beyond_10_miles"], "beyond_10_miles"


def _physical_fit(facts, comp) -> tuple[float, str]:
    inp = comp["inputs"]
    pts, fired = 0, []
    docks = facts.get("dock_doors_est")
    if isinstance(docks, int) and docks >= 4:
        pts += inp["docks_4_plus"]; fired.append("docks_4_plus")
    drive = facts.get("drive_ins_est")
    if isinstance(drive, int) and drive >= 1:
        pts += inp["any_drive_in"]; fired.append("any_drive_in")
    if facts.get("divisibility") in ("some_separation", "multi_entry"):
        pts += inp["divisibility_not_single_box"]; fired.append("divisible")
    if facts.get("condition") in ("good", "fair"):
        pts += inp["condition_not_poor"]; fired.append("condition_ok")
    pts = min(pts, comp["weight"])
    return pts, "+".join(fired) if fired else "none"


def _code_violations(facts, comp) -> tuple[float, str]:
    r = comp["rules"]
    n = facts.get("code_violations_24mo") or 0
    if n >= 2:
        return r["two_plus_in_24mo"], "two_plus_in_24mo"
    if n == 1:
        return r["one_in_24mo"], "one_in_24mo"
    return r["none"], "none"


def _hold_period(facts, comp) -> tuple[float, str]:
    r = comp["rules"]
    h = facts.get("hold_years")
    if h is None:
        return 0, "hold_unknown"
    if h >= 20:
        return r["twenty_plus_years"], "twenty_plus_years"
    if h >= 10:
        return r["ten_to_nineteen"], "ten_to_nineteen"
    return r["under_ten"], "under_ten"


def _owner_profile(facts, comp) -> tuple[float, str]:
    r = comp["rules"]
    pts, fired = 0, []
    if facts.get("entity_type") in ("trust", "individual"):
        pts += r["trust_or_individual"]; fired.append("trust_or_individual")
    if facts.get("is_out_of_state"):
        pts += r["out_of_state_mailing"]; fired.append("out_of_state")
    if facts.get("estate_keyword"):
        pts += r["estate_keyword"]; fired.append("estate_keyword")
    pts = min(pts, comp["weight"])
    return pts, "+".join(fired) if fired else "none"


def _permit_anomaly(facts, comp) -> tuple[float, str]:
    r = comp["rules"]
    # Alternative signals — take the strongest applicable, capped at the weight.
    if facts.get("permit_lapsed_or_expired"):
        return r["lapsed_or_expired_permit"], "lapsed_or_expired_permit"
    if facts.get("permit_none_10yr_pre1985"):
        return r["no_permits_10yr_pre1985"], "no_permits_10yr_pre1985"
    return r["none"], "none"


def _condition_distress(facts, comp) -> tuple[float, str]:
    # Assessor CAMA poor/fair condition or functional obsolescence = neglected/obsolete = motivated.
    # Absent (None — markets without CAMA condition, or average/good parcels) scores 0.
    r = comp["rules"]
    c = facts.get("cama_condition")
    if c == "poor":
        return r["poor"], "poor"
    if c == "fair":
        return r["fair"], "fair"
    return r["none"], "none"


def _year_built_band(facts, comp) -> tuple[float, str]:
    r = comp["rules"]
    y = facts.get("year_built")
    if y is None:
        return 0, "year_unknown"
    if 1955 <= y <= 1985:
        return r["built_1955_1985"], "built_1955_1985"
    if 1986 <= y <= 2000:
        return r["built_1986_2000"], "built_1986_2000"
    return r["other"], "other"


def _truck_access(facts, comp) -> tuple[float, str]:
    r = comp["rules"]
    t = facts.get("truck_access")
    if t in r:  # 'bad'|'tight'|'easy'
        return r[t], t
    return 0, "not_visible"


# Maps weights.yaml component key -> scorer fn.
_SCORERS = {
    "vacancy_evidence": _vacancy,
    "tax_delinquency": _tax_delinquency,
    "proximity_score": _proximity,
    "physical_fit": _physical_fit,
    "code_violations": _code_violations,
    "hold_period": _hold_period,
    "owner_profile": _owner_profile,
    "permit_anomaly": _permit_anomaly,
    "condition_distress": _condition_distress,
    "year_built_band": _year_built_band,
    "truck_access_inverse": _truck_access,
}


def _deductions(facts, cfg) -> tuple[float, list[str]]:
    d = cfg.get("deductions", {}).get("data_confidence", {})
    total, fired = 0, []
    if facts.get("sf_mismatch"):
        total += d.get("sf_mismatch", 0); fired.append("sf_mismatch")
    if facts.get("violation_join_uncertain"):
        total += d.get("violation_join_uncertain", 0); fired.append("violation_join_uncertain")
    if facts.get("no_usable_imagery"):
        total += d.get("no_usable_imagery", 0); fired.append("no_usable_imagery")
    total = max(total, d.get("max_deduction", -6))  # floor
    return total, fired


def compute_score(facts: dict[str, Any], cfg: dict | None = None) -> dict[str, Any]:
    """
    Score one property. Returns a dict suitable for scores.components JSONB:
      {
        "status": "scored"|"manual_review"|"excluded",
        "gate_reason": str,
        "total": float,                 # only meaningful when status == 'scored'
        "components": {name: points},
        "rules_fired": {name: rule},
        "components_sum": float,
        "deductions": float,
        "deductions_fired": [...],
        "version": str,
      }
    Invariant (tested): sum(components.values()) - capped + deductions == total math,
    i.e. total == max(min(components_sum, 100) + deductions, 0).
    """
    cfg = cfg or load_weights()
    status, reason = evaluate_gates(facts, cfg["gates"])
    out: dict[str, Any] = {
        "status": status,
        "gate_reason": reason,
        "version": cfg.get("version", "unknown"),
        "components": {},
        "rules_fired": {},
    }
    if status != "scored":
        out["total"] = None
        return out

    components, rules_fired = {}, {}
    for name, comp in cfg["components"].items():
        scorer = _SCORERS.get(name)
        if scorer is None:
            raise KeyError(f"weights.yaml component '{name}' has no scorer in rules.py")
        pts, fired = scorer(facts, comp)
        components[name] = round(float(pts), 2)
        rules_fired[name] = fired

    comp_sum = round(sum(components.values()), 2)
    capped = min(comp_sum, 100)
    deduction, ded_fired = _deductions(facts, cfg)
    total = max(round(capped + deduction, 2), 0)

    out.update(
        components=components,
        rules_fired=rules_fired,
        components_sum=comp_sum,
        capped=capped,
        deductions=deduction,
        deductions_fired=ded_fired,
        total=total,
    )
    return out
