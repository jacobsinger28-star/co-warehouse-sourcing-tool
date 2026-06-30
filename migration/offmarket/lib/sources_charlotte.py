"""
Confirmed public data sources for the CHARLOTTE / Mecklenburg County, NC market.

This mirrors `lib/sources.py` (Nashville / Davidson County, TN) so the pipeline can
be re-pointed at Charlotte. Every URL below was verified to respond on 2026-06-16
via live ArcGIS REST probes (see `DATA_NOTES_CHARLOTTE.md` for the discovery log,
field samples, counts, and the three things that differ from Nashville).

Big picture — how Charlotte differs from Nashville:

  1. TWO governments host the data, not one. Mecklenburg County GIS
     (`meckgis.mecklenburgcountync.gov/server`) owns the assessor/CAMA + permits;
     the City of Charlotte (`gis.charlottenc.gov/arcgis`) owns code enforcement and
     mirrors county parcel geometry. Both are plain ArcGIS REST (POST + paging),
     same client as Nashville (`lib/arcgis.py`).

  2. Owner + land use + building SF + year-built all live in ONE CAMA layer
     (`TaxParcel_camadata`), keyed on `pid`. Nashville needed an APN join between a
     geometry/owner layer and a separate CAMA layer; here it's a single feature
     service. (There is still ONE ROW PER BUILDING per parcel — aggregate by `pid`.)

  3. The industrial filter is INVERTED vs Nashville. There, `LUCode` was the clean
     key and `LUDesc` text was unreliable. Here `lusecode` is NOT clean (code `I600`
     maps to INDUSTRIAL *and* MINI WAREHOUSE *and* TRUCK TERMINAL...). The reliable
     filter is the building-level `bldgtype` (or parcel `landuse_description`) TEXT.
     See INDUSTRIAL_BLDGTYPE_KEYWORDS / EXCLUDED_BLDGTYPES below.

  Two more, smaller:
   - Permits here are DEEPER and RICHER than Nashville: 36 yr of history (1990→now)
     and a real `permitstat` + `compldate`, so "permit pulled, never finaled" IS
     derivable (it was undefined in Nashville's Issued-only feed).
   - Code enforcement is SHALLOWER: the HNS feature services expose only a rolling
     ~8-week window (verified 2026-04-22 → 2026-06-15), NOT multi-year history. The
     "code case in last 24 months" signal must be accumulated by the weekly cron
     going forward, or sourced from the City's 311 archive. Top open risk.

All field lists are snapshots — re-verify with a discover script before trusting a
column; county schemas drift.
"""

# --- Hosts -----------------------------------------------------------------
# Mecklenburg County GIS ArcGIS Server (authoritative assessor/CAMA + permits).
MECK_SERVER = "https://meckgis.mecklenburgcountync.gov/server/rest/services"
# City of Charlotte ArcGIS Server (code enforcement, zoning, county parcel mirror).
CLT_SERVER = "https://gis.charlottenc.gov/arcgis/rest/services"


# --- Parcels + CAMA: owner, land use, building SF, year, sale, value, vac/imp ---
# ONE layer carries what Nashville split across ownership + CAMA. One row PER
# BUILDING per parcel -> aggregate `finarea`/`totalarea` grouped by `pid`.
# `vacorimprov` ('VAC'/'IMP') is a first-class vacancy flag from the assessor.
PARCELS_CAMA = (
    f"{MECK_SERVER}/TaxParcel_camadata/FeatureServer/0"
)
# Cleaner ownership/values cut (closer to one row per parcel; full_owner_name,
# txt_propertyuse_desc, amt_netbldgvalue). Useful for owner/portfolio rollups.
PARCELS_OWNERSHIP_VALUES = (
    f"{MECK_SERVER}/TaxParcel_Camaownershipvalues/FeatureServer/0"
)
# County parcel geometry mirror on the City server (geometry + PID only).
PARCELS_GEOMETRY = (
    f"{CLT_SERVER}/CountyData/Parcels/MapServer/0"
)

# --- Code enforcement (City of Charlotte HNS). Join key: ParcelId. -----------
# WARNING: rolling ~8-week window only (no multi-year history). See module docstring.
CODE_ENFORCEMENT_ALL = (
    f"{CLT_SERVER}/HNS/CodeEnforcementCasesAll/MapServer/0"
)
CODE_ENFORCEMENT_OPEN = (
    f"{CLT_SERVER}/HNS/CodeEnforcementNewAndOpenCases/MapServer/0"
)
CODE_ENFORCEMENT_DEMOLISH = (
    f"{CLT_SERVER}/HNS/CodeEnforcementOrderstoDemolish/MapServer/0"
)

# --- Building permits (Mecklenburg County GIS). Join key: parcelnum. ---------
# 36 yr deep (1990->now); carries permitstat + issuedate + compldate -> the
# "pulled but never finaled" anomaly is derivable here (unlike Nashville).
BUILDING_PERMITS = (
    f"{MECK_SERVER}/BuildingPermits/FeatureServer/0"
)

# --- Zoning lookup (City of Charlotte ODP). Join key: PID. Bonus signal. ------
PARCEL_ZONING = (
    f"{CLT_SERVER}/ODP/Parcel_Zoning_Lookup/MapServer/0"
)


# Confirmed field names per source (snapshot 2026-06-16 — re-verify before trusting).
FIELDS = {
    "parcels_cama": [
        "pid", "parcelid", "commonpid", "nc_pin",
        "ownrlstnme", "ownrfrstnme", "ownr2lstnme", "ownertype", "ownertyped",
        "mailaddr1", "mailaddr2", "city", "state", "zipcode",
        "lusecode", "landuse_description", "bldgtype", "bldgcode", "vacorimprov",
        "heatedarea", "finarea", "totalarea", "basearea",
        "yearbuilt", "effyearblt", "storyheight", "extwall",
        "saleprice", "saledate", "validsale", "grantor", "typeofdeed", "amtstamps",
        "totalvalue", "totalbldgval", "totlandval", "totmarkval",
        "totalac", "legalacres", "gisacres", "comunits", "resunits",
        "address", "streetnumber", "streetname", "loccity", "legaldesc",
        "taxmundist", "neighborhood",
    ],
    "ownership_values": [
        "pid", "id_commonpid", "camapid", "full_owner_name",
        "nme_ownerlastname", "nme_ownerfirstname",
        "txt_mailaddr1", "txt_city", "txt_state", "txt_zipcode",
        "amt_netbldgvalue", "amt_landvalue", "amt_totalvalue",
        "txt_propertyuse_desc", "txt_landunittype", "num_totalac",
        "dte_dateofsale", "amt_price", "situsaddress1", "municipality_desc",
    ],
    "code_enforcement": [
        "CaseNumber", "ParcelId", "CaseType", "FullAddress", "CaseStatus",
        "DateCreated", "DateClosed", "Conclusion", "DetailedDescription",
        "Inspector", "CouncilDistrict", "FOFOrdered",
    ],
    "permits": [
        "permitnum", "parcelnum", "permitdesc", "permittype", "permitstat",
        "issuedate", "compldate", "bldgcost", "worktype", "workdesc",
        "typeofbldg", "occupancy", "heatsqft", "totalsqft",
        "ownname", "owncity", "ownstate", "projadd", "zonecode",
    ],
}

# Join keys differ by source — all resolve to the same 8-char parcel id space
# (CAMA `pid` == geometry `PID` == code-enf `ParcelId` == permits `parcelnum`).
JOIN_KEY = {
    "parcels_cama": "pid",
    "ownership_values": "pid",
    "parcels_geometry": "PID",
    "code_enforcement": "ParcelId",
    "permits": "parcelnum",
    "zoning": "PID",
}

# Industrial filter — TEXT-based here (lusecode is NOT clean; see docstring).
# Match on building-level `bldgtype` first (most precise), fall back to parcel
# `landuse_description`. Keep a keyword set + an explicit exclusion set.
INDUSTRIAL_BLDGTYPE_KEYWORDS = (
    "WAREHOUSE", "MANUFACTURING", "INDUSTRIAL", "TERMINAL", "DISTRIBUTION", "FLEX",
)
INDUSTRIAL_LANDUSE_KEYWORDS = (
    "WAREHOUSE", "INDUSTRIAL", "MANUF", "DISTRIB", "TERMINAL", "FLEX",
)
# Drop these even though they match a keyword above:
#  - self-storage (competing use)         - fractured-ownership condos
#  - retail big-box                       - "MANUFACTURED HOME" (mobile homes!)
EXCLUDED_BLDGTYPES = {
    "MINI WAREHOUSE", "MINI WAREHOUSE CLIMATE CONTROL", "PREFAB/MINIMAL WAREHOUSE",
    "WAREHOUSE CONDOMINIUM", "RETAIL WAREHOUSE DISCOUNT STORE",
    "MANUFACTURED HOME-SINGLEWIDE", "MANUFACTURED HOME-DOUBLEWIDE",
}
EXCLUDED_LANDUSE_SUBSTRINGS = ("MINI WAREHOUSE", "CONDOMINIUM")

INDUSTRIAL_FILTER_NOTE = (
    "Unlike Nashville (match on numeric LUCode), Mecklenburg `lusecode` is many-to-many "
    "with use (I600 = INDUSTRIAL and MINI WAREHOUSE and TRUCK TERMINAL). Filter on "
    "`bldgtype`/`landuse_description` TEXT with the keyword + exclusion sets above. "
    "Exclude MANUFACTURED HOME* explicitly — it matches the 'MANUF' keyword but is a "
    "mobile home, not industrial."
)

BUILDING_SF_NOTE = (
    "Same as Nashville: a parcel (`pid`) can carry multiple building rows. building_sf "
    "should be the SUM of non-self-storage `finarea` (or `totalarea`) grouped by `pid`; "
    "store building_sf_largest + building_count alongside. `heatedarea` appears to be "
    "pre-summed to the parcel in sampling — verify before using it as the gate field."
)
