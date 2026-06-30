"""
Pure text normalization: owner names, entity typing, estate flags, addresses, APNs.
No DB, no I/O — fully unit-tested in tests/test_normalize.py. transform/normalize.py
and scoring/score.py import from here so the logic exists exactly once.
"""
from __future__ import annotations

import re

# --------------------------------------------------------------------------- #
# Generic normalizers
# --------------------------------------------------------------------------- #
def norm_name(raw: str | None) -> str:
    """Uppercase, strip punctuation (keep & for joint owners), collapse spaces."""
    if not raw:
        return ""
    s = raw.upper()
    s = re.sub(r"[^A-Z0-9& ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def norm_apn(raw: str | None) -> str:
    """Uppercase + strip non-alphanumerics. Davidson APNs are dense already, but
    founder CSVs (Trustee file) may arrive dashed/dotted."""
    if not raw:
        return ""
    return re.sub(r"[^A-Z0-9]", "", raw.upper())


_ADDR_ABBREV = {
    "STREET": "ST", "AVENUE": "AVE", "ROAD": "RD", "DRIVE": "DR",
    "BOULEVARD": "BLVD", "LANE": "LN", "COURT": "CT", "PLACE": "PL",
    "HIGHWAY": "HWY", "PARKWAY": "PKWY", "CIRCLE": "CIR", "TERRACE": "TER",
    "SUITE": "STE", "NORTH": "N", "SOUTH": "S", "EAST": "E", "WEST": "W",
    "APARTMENT": "APT", "BUILDING": "BLDG", "FLOOR": "FL",
    # Variant short forms seen in real Davidson mailing data: "760 MELROSE AV" vs
    # "760 MELROSE AVE" split one owner into two portfolio groups (found Day 2 QA).
    "AV": "AVE", "PKWAY": "PKWY", "BLV": "BLVD", "CRT": "CT",
}


def norm_address(addr: str | None, city: str | None = None,
                 state: str | None = None, zip_code: str | None = None) -> str:
    """Normalize a mailing address for portfolio grouping. Conservative: casing,
    punctuation, and USPS-style abbreviations only — no fuzzy matching, so false
    merges (the founder's Day-3 review concern) stay near zero."""
    parts = []
    for piece in (addr, city, state):
        if piece:
            s = re.sub(r"[^A-Z0-9 ]+", " ", piece.upper())
            tokens = [_ADDR_ABBREV.get(t, t) for t in s.split()]
            parts.append(" ".join(tokens))
    if zip_code:
        z = re.sub(r"[^0-9]", "", str(zip_code))[:5]
        if z:
            parts.append(z)
    return " ".join(p for p in parts if p).strip()


# --------------------------------------------------------------------------- #
# Entity typing
# --------------------------------------------------------------------------- #
# Order matters: first match wins. Checked against real Davidson owner strings.
_GOV = re.compile(
    r"\b(METRO(POLITAN)? GOV|METRO NASHVILLE|GOVERNMENT|STATE OF|CITY OF|"
    r"COUNTY OF|UNITED STATES|U S A|HOUSING AUTHORITY|AIRPORT AUTHORITY|"
    r"BOARD OF EDUCATION)\b")
_BANKLIKE = re.compile(r"\b(BANK|TRUST CO(MPANY)?)\b")  # corporate, not a family trust
# "TR" only as a trailing token: assessor shorthand for trustee ("..., III, TR.").
# Mid-string TR would false-positive on initials.
_TRUST = re.compile(r"\b(TRUST|TRUSTEE|TRUSTEES|REVOCABLE|IRREVOCABLE)\b|\bTR$")
_LLC = re.compile(r"\bL ?L ?C\b|\bLLC\b")
_PARTNERSHIP = re.compile(r"\b(LP|LLP|LLLP|LIMITED PARTNERSHIP|PARTNERSHIP|PARTNERS)\b")
_CORP = re.compile(r"\b(INC|INCORPORATED|CORP|CORPORATION|COMPANY|LTD|PLC|HOLDINGS?)\b")
_CHURCH = re.compile(r"\b(CHURCH|MINISTR(Y|IES)|BAPTIST|CATHOLIC|TEMPLE|SYNAGOGUE|MOSQUE)\b")
_INDIVIDUAL_HINT = re.compile(r"\b(ETUX|ET UX|ET AL|ETAL|ET VIR|JR|SR|III|II|IV)\b")


def entity_type(raw: str | None) -> str:
    """
    Classify an assessor owner string. Returns one of:
      'gov' | 'trust' | 'llc' | 'partnership' | 'corp' | 'church' | 'individual' | 'other'
    Scoring only rewards 'trust' and 'individual' (owner_profile), so the
    conservative bias is: when ambiguous, do NOT call it an individual.
    """
    s = norm_name(raw)
    if not s:
        return "other"
    if _GOV.search(s):
        return "gov"
    if _BANKLIKE.search(s):
        return "corp"
    if _TRUST.search(s):
        return "trust"
    if _LLC.search(s):
        return "llc"
    if _PARTNERSHIP.search(s):
        return "partnership"
    if _CORP.search(s):
        return "corp"
    if _CHURCH.search(s):
        return "church"
    # "LAST, FIRST ..." — assessor convention for people. Comma must be present in
    # the RAW string (norm_name strips it), plus no org keyword hit above.
    if raw and "," in raw:
        return "individual"
    if _INDIVIDUAL_HINT.search(s):
        return "individual"
    return "other"


# --------------------------------------------------------------------------- #
# Estate / probate flag
# --------------------------------------------------------------------------- #
# weights.yaml says: name_raw ILIKE '%estate%' OR '%heir%' OR '%deceased%'.
# Implemented more carefully than the spec: a naive %estate% match fires on every
# "X REAL ESTATE LLC" and "OAK ESTATES PARTNERS" — pure false positives for the
# probate/forced-sale signal. Deviation documented in BUILD_LOG.md.
_ESTATE_STRONG = re.compile(r"\b(ESTATE OF|EST OF|HEIRS?|DECEASED|C O EST)\b")
_REAL_ESTATE = re.compile(r"\bREAL ESTATE\b")
_ESTATE_WORD = re.compile(r"\bESTATE\b")  # singular only; ESTATES = subdivisions/branding


def estate_flag(raw: str | None) -> bool:
    s = norm_name(raw)
    if not s:
        return False
    if _ESTATE_STRONG.search(s):
        return True
    # Bare "ESTATE" counts only after removing "REAL ESTATE" phrases.
    return bool(_ESTATE_WORD.search(_REAL_ESTATE.sub(" ", s)))
