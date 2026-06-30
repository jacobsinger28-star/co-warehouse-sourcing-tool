"""
Buy Box scoring + financial underwriting for industrial warehouse properties.

Financial formula (all values in $/SF):
  Projected_Gross_Rent  = Market_Gross_Rent_Small_Bay * 1.35
  NOI                   = Projected_Gross_Rent - 8.00
  Target_Basis          = NOI / 0.11
  Implied_Purchase_Price = Target_Basis - 50.00

Scoring:
  Actionable (Green) — ALL physical criteria met AND Asking <= Implied Price
  Tentative  (Yellow) — Sprinkler missing, Power < 15A/1k SF, Truck Court < 100 ft,
                         Docks below ratio, Parking < 1.0/1k SF, Office 10-15%,
                         Clear height missing, or Asking within 10% above Implied Price
  Pass       (Red)   — Clear Height < 14 ft OR Office > 15%
                         OR size / zoning hard fail
                         OR Asking > 10% above Implied Price
"""
from __future__ import annotations
import re
from typing import Optional

import pandas as pd

# ---------------------------------------------------------------------------
# Column aliases
# ---------------------------------------------------------------------------
COL_MAP = {
    # ── Core physical (scored) ──────────────────────────────────────────────
    "address":       ["address", "property_address", "site_address"],
    "asset_class":   ["asset_class", "asset class"],
    "market_msa":    ["market_msa", "market (msa)", "market_(msa)", "msa"],
    "total_sf":      ["total_sf", "total sf", "building_size", "building size",
                      "property_size", "property size",
                      "building_sf", "building sf", "size_sf", "size sf", "sq_ft", "sqft"],
    "clear_height":  ["clear_height", "clear height", "clear_ht", "ceiling_height", "ceiling height"],
    "loading_docks": ["loading_docks", "loading docks", "dock_doors", "dock doors", "docks", "dock_count"],
    "grade_doors":   ["grade_doors", "grade doors", "grade_level_doors", "drive_in_doors", "drive-in doors"],
    "sprinklered":   ["sprinklered", "sprinkler", "fire_safety", "fire safety", "sprinkler_system"],
    "office_pct":    ["office_pct", "office %", "office_percent", "office percent", "office pct",
                      "office_percentage", "office percentage"],
    "parking_ratio": ["parking_ratio", "parking ratio", "parking", "parking_spaces"],
    "power":         ["power", "power_capacity", "power capacity", "electrical",
                      "power_type", "power type", "amps"],
    "hvac":          ["hvac", "hvac?"],
    "food_access":   ["food_access", "food access"],
    "zoning":        ["zoning", "zoning_code", "zoning code"],
    "condition":     ["condition", "property_condition"],
    "lease_type":    ["lease_type", "lease type"],
    # ── Scoring-only ────────────────────────────────────────────────────────
    "building_type": ["building_type", "building type", "type", "property_type"],
    "truck_court_depth": ["truck_court_depth", "truck court depth", "truck court",
                          "truck_access", "truck access?", "truck access",
                          "court_depth", "court depth", "truck_court"],
    "market_gross_rent_small_bay": [
        "market_gross_rent_small_bay", "market gross rent small bay",
        "market_rent", "market rent", "gross_rent", "gross rent",
        "rent_psf", "rent psf", "market_rent_psf",
    ],
    "asking_price_psf": ["asking_price_psf", "asking price psf", "asking_price", "asking price",
                         "list_price_psf", "list price psf", "price_psf", "price psf"],
    "notes":            ["notes", "comments", "broker_notes", "broker notes"],
}

SCORE_ACTIONABLE = "Actionable"
SCORE_TENTATIVE  = "Tentative"
SCORE_PASS       = "Pass"

# Physical thresholds
MIN_AMPS_PER_1K_SF   = 15
DOCK_SF_RATIO        = 15_000   # 1 dock per 15k SF
TRUCK_COURT_MIN_FT   = 100

# Financial constants
RENT_MULTIPLIER      = 1.35
NOI_EXPENSE_PSF      = 8.00
CAP_RATE             = 0.11
BASIS_DEDUCTION      = 50.00
PRICING_TOLERANCE    = 0.10     # 10% over implied = tentative; >10% = pass

POWER_3PHASE_KEYWORDS = ["277/480", "480v", "3-phase", "3 phase", "three phase"]
INDUSTRIAL_KEYWORDS   = [
    "industrial", "light industrial", "heavy industrial",
    "warehouse", "distribution", "logistics", "manufacturing",
    "m1", "m2", "i1", "i2", "li", "hi", "ind",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _normalise(df):
    col_lookup: dict[str, str] = {}
    for df_col in df.columns:
        lower  = df_col.strip().lower()
        key    = lower.replace(" ", "_")
        # Strip all non-alphanumeric characters (handles parentheses, ?, etc.)
        clean  = re.sub(r"[^a-z0-9]", "", lower)
        for canon, aliases in COL_MAP.items():
            alias_clean = {re.sub(r"[^a-z0-9]", "", a) for a in aliases}
            if lower in aliases or key in aliases or clean in alias_clean:
                col_lookup[df_col] = canon
                break
    return df.rename(columns=col_lookup)


def _get(row, key, default=None):
    return row[key] if key in row.index and not _is_blank(row[key]) else default


def _is_blank(val) -> bool:
    if val is None:
        return True
    import pandas as pd
    try:
        if pd.isna(val):
            return True
    except (TypeError, ValueError):
        pass
    return str(val).strip() == ""


def _parse_float(val) -> Optional[float]:
    if _is_blank(val):
        return None
    try:
        return float(re.sub(r"[,$%\s]", "", str(val)))
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------------------
# Financial underwriting
# ---------------------------------------------------------------------------

def _underwrite(market_rent: Optional[float]) -> tuple[Optional[float], str]:
    """Return (implied_purchase_price_psf, description)."""
    if market_rent is None:
        return None, "No market rent data — implied price unavailable"
    proj_gross = market_rent * RENT_MULTIPLIER
    noi        = proj_gross - NOI_EXPENSE_PSF
    target     = noi / CAP_RATE
    implied    = target - BASIS_DEDUCTION
    return round(implied, 2), (
        f"Market Rent ${market_rent:.2f} → Proj. Gross ${proj_gross:.2f} "
        f"→ NOI ${noi:.2f} → Target ${target:.2f} → Implied ${implied:.2f}/SF"
    )


# ---------------------------------------------------------------------------
# Physical spec checks
# ---------------------------------------------------------------------------

def _check_power(power_val, total_sf: Optional[float]) -> tuple[bool, Optional[float], str]:
    """Returns (ok, amps_per_1k_sf, label)."""
    if _is_blank(power_val):
        return False, None, "Power spec missing"
    val = str(power_val).lower()
    if any(kw in val for kw in POWER_3PHASE_KEYWORDS):
        return True, None, "277/480V 3-Phase (verified ≥15A/1k SF)"
    amps = _parse_float(power_val)
    if amps is not None and total_sf and total_sf > 0:
        density = round((amps / total_sf) * 1000, 1)
        ok = density >= MIN_AMPS_PER_1K_SF
        label = f"{density}A/1k SF ({'meets' if ok else 'below'} 15A/1k SF min)"
        return ok, density, label
    return False, None, f"Power '{power_val}' — verify ≥15A/1k SF"


def _check_loading(docks_val, total_sf: Optional[float]) -> tuple[bool, str]:
    docks = _parse_float(docks_val)
    if docks is None:
        return False, "Loading dock count missing"
    if not total_sf:
        return False, f"{int(docks)} docks (SF unknown — can't verify ratio)"
    required = max(1, total_sf / DOCK_SF_RATIO)
    ok = docks >= required
    return ok, f"{int(docks)} dock{'s' if docks != 1 else ''} ({'meets' if ok else 'below'} 1/15k SF ratio)"


def _check_sprinkler(val) -> tuple[bool, str]:
    if _is_blank(val):
        return False, "Sprinkler status unknown"
    v = str(val).lower().strip()
    if v in ("yes", "y", "true", "1", "fully", "full", "sprinklered"):
        return True, "Fully Sprinklered"
    if v in ("no", "n", "false", "0", "none"):
        return False, "Not Sprinklered"
    return False, f"Sprinkler unclear: '{val}'"


def _check_truck_court(val) -> tuple[bool, Optional[float], str]:
    depth = _parse_float(val)
    if depth is None:
        return False, None, "Truck court depth missing"
    ok = depth >= TRUCK_COURT_MIN_FT
    label = (
        f"{depth:.0f} ft (meets 100 ft min)"
        if ok else
        f"{depth:.0f} ft (Threshold: 100 ft) — verify semi-truck radius"
    )
    return ok, depth, label


def _check_zoning(val) -> tuple[bool, str]:
    if _is_blank(val):
        return False, "Zoning unknown"
    v = str(val).lower()
    if any(kw in v for kw in INDUSTRIAL_KEYWORDS):
        return True, "Industrial Zoning"
    return False, f"Non-Industrial Zoning ({val})"


# ---------------------------------------------------------------------------
# Main row scorer
# ---------------------------------------------------------------------------

def score_row(row) -> dict:
    # --- Raw inputs ---
    total_sf       = _parse_float(_get(row, "total_sf"))
    building_type  = str(_get(row, "building_type", "")).lower()
    office_pct     = _parse_float(_get(row, "office_pct"))
    clear_height   = _parse_float(_get(row, "clear_height"))
    zoning_val     = _get(row, "zoning")
    power_val      = _get(row, "power")
    docks_val      = _get(row, "loading_docks")
    sprinkler_val  = _get(row, "sprinklered")
    parking_ratio  = _parse_float(_get(row, "parking_ratio"))
    court_val      = _get(row, "truck_court_depth")
    food_access    = _get(row, "food_access")
    grade_doors    = _parse_float(_get(row, "grade_doors"))
    market_rent    = _parse_float(_get(row, "market_gross_rent_small_bay"))
    asking_psf     = _parse_float(_get(row, "asking_price_psf"))

    # --- Financial underwriting ---
    implied_price, _uw_detail = _underwrite(market_rent)

    pricing_delta: Optional[float] = None
    pricing_label = "No asking price provided"
    if implied_price is not None and asking_psf is not None:
        pricing_delta = round(asking_psf - implied_price, 2)
        pct_over      = pricing_delta / implied_price if implied_price else 0
        if pricing_delta <= 0:
            pricing_label = f"Actionable: Implied ${implied_price:.2f} covers Asking ${asking_psf:.2f}/SF"
        elif pct_over <= PRICING_TOLERANCE:
            pricing_label = (
                f"Tentative: Asking ${asking_psf:.2f} is {pct_over*100:.1f}% above "
                f"Implied ${implied_price:.2f}/SF (within 10% tolerance)"
            )
        else:
            pricing_label = (
                f"Pass: Asking ${asking_psf:.2f} is {pct_over*100:.1f}% above "
                f"Implied ${implied_price:.2f}/SF (exceeds 10% threshold)"
            )

    # --- Physical checks ---
    power_ok,   power_density,  power_label   = _check_power(power_val, total_sf)
    dock_ok,    dock_label                    = _check_loading(docks_val, total_sf)
    spkr_ok,    spkr_label                    = _check_sprinkler(sprinkler_val)
    court_ok,   court_depth,    court_label   = _check_truck_court(court_val)
    zoning_ok,  zoning_label                  = _check_zoning(zoning_val)

    # Power density label for Excel column
    power_density_str = (
        "277/480V 3-Phase" if power_density is None and power_ok
        else f"{power_density}A/1k SF" if power_density is not None
        else "Unknown"
    )

    # Truck court label for Excel column
    truck_court_str = f"{court_depth:.0f} ft" if court_depth else "Unknown"

    # -----------------------------------------------------------------------
    # HARD FAILS → Pass (Red)
    # -----------------------------------------------------------------------
    hard_fail_reasons: list[str] = []

    # Sprinkler is NOT a hard fail — can be added as capex
    # (handled below in tentative checks)

    # Power is Tentative, not a hard fail (handled below)

    if office_pct is not None and office_pct > 15:
        hard_fail_reasons.append(f"Pass: Office {office_pct:.0f}% exceeds 15% max")

    # Size hard fail
    is_multi = "multi" in building_type
    if total_sf is not None:
        if is_multi:
            if total_sf > 250_000:
                hard_fail_reasons.append(f"Pass: Multi-tenant {total_sf:,.0f} SF exceeds 250k SF max")
        else:
            if total_sf < 50_000:
                hard_fail_reasons.append(f"Pass: {total_sf:,.0f} SF below 50k SF minimum")
            elif total_sf > 250_000:
                hard_fail_reasons.append(f"Pass: {total_sf:,.0f} SF exceeds 250k SF max")

    if not zoning_ok and "unknown" not in zoning_label.lower():
        hard_fail_reasons.append(f"Pass: {zoning_label}")

    if clear_height is not None and clear_height < 14:
        hard_fail_reasons.append(f"Pass: Clear height {clear_height:.0f} ft — below 14 ft minimum")

    # Pricing hard fail (>10% above implied)
    if pricing_delta is not None and implied_price is not None and implied_price > 0:
        pct_over = pricing_delta / implied_price
        if pct_over > PRICING_TOLERANCE:
            hard_fail_reasons.append(pricing_label)

    if hard_fail_reasons:
        return {
            "Score_Category":         SCORE_PASS,
            "Implied_Purchase_Price":  implied_price,
            "Power_Density":           power_density_str,
            "Truck_Court_Depth":       truck_court_str,
            "Pricing_Delta":           pricing_delta,
            "Scoring_Reason":          "; ".join(hard_fail_reasons),
        }

    # -----------------------------------------------------------------------
    # TENTATIVE (Yellow)
    # -----------------------------------------------------------------------
    tentative_reasons: list[str] = []

    if not spkr_ok:
        tentative_reasons.append(f"Tentative: {spkr_label} — can be added as capex")

    if not court_ok:
        if court_depth is not None:
            tentative_reasons.append(
                f"Tentative: Truck court depth is {court_depth:.0f} ft "
                f"(Threshold: {TRUCK_COURT_MIN_FT} ft) — verify semi-truck radius"
            )
        else:
            tentative_reasons.append("Tentative: Truck court depth missing — verify semi-truck radius")

    # Pricing within 10% above implied
    if pricing_delta is not None and implied_price and 0 < pricing_delta / implied_price <= PRICING_TOLERANCE:
        tentative_reasons.append(pricing_label)

    if _is_blank(_get(row, "clear_height")):
        tentative_reasons.append("Tentative: Clear height missing")

    if not dock_ok:
        tentative_reasons.append(f"Tentative: {dock_label}")

    if parking_ratio is not None and parking_ratio < 1.0:
        tentative_reasons.append(
            f"Tentative: Parking {parking_ratio:.2f}/1k SF below 1.0 min — verify truck turning radius"
        )

    if zoning_ok is False and "unknown" in zoning_label.lower():
        tentative_reasons.append(f"Tentative: {zoning_label}")

    if office_pct is not None and 10 <= office_pct <= 15:
        tentative_reasons.append(f"Tentative: Office {office_pct:.0f}% (borderline — target <10%)")

    # Food access blank / none / N/A → Tentative
    _none_vals = {"none", "n/a", "na", "no", "n", "false", "0", "-", "—"}
    if _is_blank(food_access) or str(food_access).lower().strip() in _none_vals:
        tentative_reasons.append("Tentative: Food access unconfirmed")

    # Grade doors: none or zero → Tentative
    if _is_blank(_get(row, "grade_doors")) or (grade_doors is not None and grade_doors == 0):
        tentative_reasons.append("Tentative: No grade doors")

    # Power below threshold or unverified → Tentative
    if not power_ok:
        if power_density is not None:
            tentative_reasons.append(
                f"Tentative: Power density {power_density}A/1k SF — below {MIN_AMPS_PER_1K_SF}A/1k SF minimum"
            )
        else:
            tentative_reasons.append(f"Tentative: {power_label}")

    if tentative_reasons:
        return {
            "Score_Category":         SCORE_TENTATIVE,
            "Implied_Purchase_Price":  implied_price,
            "Power_Density":           power_density_str,
            "Truck_Court_Depth":       truck_court_str,
            "Pricing_Delta":           pricing_delta,
            "Scoring_Reason":          "; ".join(tentative_reasons),
        }

    # -----------------------------------------------------------------------
    # ACTIONABLE (Green)
    # -----------------------------------------------------------------------
    green_parts: list[str] = []
    if implied_price is not None and asking_psf is not None:
        green_parts.append(
            f"Actionable: Implied ${implied_price:.2f} covers Asking ${asking_psf:.2f}/SF"
        )
    elif implied_price is not None:
        green_parts.append(f"Actionable: Implied price ${implied_price:.2f}/SF")

    green_parts.append(spkr_label)
    green_parts.append(dock_label)
    green_parts.append(court_label)
    green_parts.append(power_label)

    return {
        "Score_Category":         SCORE_ACTIONABLE,
        "Implied_Purchase_Price":  implied_price,
        "Power_Density":           power_density_str,
        "Truck_Court_Depth":       truck_court_str,
        "Pricing_Delta":           pricing_delta,
        "Scoring_Reason":          "; ".join(green_parts),
    }


def score_dataframe(df):
    df = _normalise(df)
    enrichment = df.apply(score_row, axis=1, result_type="expand")
    return df.join(enrichment)


def score_listing(listing: dict) -> dict:
    """Score a single scraper-output dict. Physical-only when market_rent is absent."""
    df = _normalise(pd.DataFrame([listing]))
    return score_row(df.iloc[0])
