"""
Public data sources — MARKET-DRIVEN.

Every endpoint, land-use code, and excluded structure type comes from the ACTIVE
market config (markets/<MARKET>.yaml, default nashville) via lib.market — nothing
here is hardcoded to one metro. Select a market with the MARKET env var. Field
schemas + the discovery narrative live in DATA_NOTES.md (Nashville) and
DATA_NOTES_COLUMBUS.md (Columbus); re-verify a live schema with tools/discover_sources.py.

Day-1 discovery findings that still hold for Nashville:
  1. data.nashville.gov is ArcGIS Hub, not Socrata — violations/permits are feature
     services queried like the parcel layer.
  2. Building SF + year-built live in a separate CAMA layer joined on APN (multiple
     building rows per parcel). Columbus has no open commercial-SF layer — it uses a
     building-footprint proxy (see markets/columbus.yaml + DATA_NOTES_COLUMBUS.md).
"""
from __future__ import annotations

from lib.market import (
    excluded_structure_types as _excluded_structure_types,
    industrial_codes as _industrial_codes,
    load_market as _load_market,
)

_S = _load_market()["sources"]

# --- Active-market ArcGIS REST endpoints (the join keys differ by market) ---
PARCELS_OWNERSHIP = _S["parcels"]
# CAMA building-characteristics layer (Nashville). None for markets without one
# (e.g. Columbus, which derives building_sf from a footprint proxy).
PARCELS_BUILDING_CHARACTERISTICS = _S.get("building_chars")
# .get() not [] — markets without a code-enforcement or permits feed legitimately omit
# these (Charleston has neither; Hamilton has violations but no permits). Eager bracket-
# indexing made `from lib import sources` raise KeyError at IMPORT for those markets; the
# generic ingest scripts that actually need a feed still fail loudly when they query None.
PROPERTY_STANDARDS_VIOLATIONS = _S.get("violations")
BUILDING_PERMITS_ISSUED = _S.get("permits")

# --- Active-market industrial land-use filter (match on CODE, not text) ---
INDUSTRIAL_LUCODES = _industrial_codes()              # {code: description}
EXCLUDED_STRUCTURE_TYPES = set(_excluded_structure_types())

BUILDING_SF_NOTE = (
    "building_sf is the SUM of all non-self-storage structures on the parcel "
    "(Nashville: CAMA FinishedArea summed per APN; Columbus: footprint-area proxy "
    "pending the Auditor CAMA file). building_sf_largest + building_count are stored "
    "alongside so a '75k across small boxes' parcel stays distinguishable. See DATA_NOTES*.md."
)
