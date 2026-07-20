"""
Configurable brokerage site scraper — nationwide edition.

Passing markets=[] scrapes all listings without geographic filtering.
Supports CBRE, JLL, Cushman & Wakefield, Colliers, Newmark, and NAI Global.

Filters: 75,000–300,000 SF, US addresses only.
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import AsyncGenerator
from urllib.parse import urljoin, urlparse

from .base import BaseScraper

logger = logging.getLogger(__name__)

_CONFIG_PATH = Path(__file__).parent.parent / "scraper_config.json"

# SF range filter — listings outside this range are skipped
_SF_MIN = 75_000
_SF_MAX = 300_000

# US state / territory abbreviations.
# Territories (VI, GU, PR, MP, AS) collide with common foreign state abbreviations
# — e.g. JLL lists Victoria, Australia as "..., VI" with no postcode. To avoid
# admitting those, we require a US ZIP code for territory matches.
_US_50_STATES = {
    "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
    "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
    "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
    "VA","WA","WV","WI","WY","DC",
}
_US_TERRITORIES = {"PR", "GU", "VI", "MP", "AS"}
_US_50_STATES_RE = re.compile(
    r",\s*(" + "|".join(_US_50_STATES) + r")(?:[,\s\d]|$)"
)
_US_TERRITORY_RE = re.compile(
    r",\s*(" + "|".join(_US_TERRITORIES) + r")(?:[,\s\d]|$)"
)
# 5-digit ZIP (with optional +4)
_US_ZIP_RE = re.compile(r"\b\d{5}(?:-\d{4})?\b")


def _passes_sf_filter(sf: float | None) -> bool:
    """True if SF is within 75k–300k range, or unknown (None)."""
    if sf is None:
        return True   # keep unknowns — we don't want to miss listings
    return _SF_MIN <= sf <= _SF_MAX


def _is_us_address(address: str | None) -> bool:
    """
    True only if the address contains a US state abbreviation or ZIP code.

    Positive check — anything without a recognisable US state code or ZIP
    is rejected, which catches international addresses that don't explicitly
    name their country (e.g. "45 King St, Toronto, ON" passes the old
    country-name blocklist but fails the state-code requirement).

    Territory codes (VI, GU, PR, MP, AS) collide with foreign state codes
    (e.g. Victoria, Australia = "VI"). For territories we require a US ZIP
    to disambiguate.
    """
    if not address:
        return True   # unknown — keep and let downstream filtering sort it out
    if _US_50_STATES_RE.search(address):
        return True
    has_zip = bool(_US_ZIP_RE.search(address))
    if _US_TERRITORY_RE.search(address) and has_zip:
        return True
    if has_zip:
        return True
    return False      # no US state code and no ZIP → almost certainly not US


# ---------------------------------------------------------------------------
# Regex helpers
# ---------------------------------------------------------------------------

def _re_sf(text: str) -> float | None:
    """
    Extract total building SF.

    Strategy (in order of reliability):
    1. Labeled field  — "Building Size: 150,000 SF" is almost always the subject property
    2. First unlabeled value in a plausible industrial range (50k–600k SF)
    3. First unlabeled value > 1,000 SF as a last resort

    We deliberately avoid taking the MAX across the whole page — that picks up
    portfolio stats ("500M SF under management") and related-listing sidebars.
    """
    _SF_RE = re.compile(r"([\d,]+)\s*(?:SF|sq\.?\s*ft\.?|square\s+f(?:oot|eet))", re.I)

    # 1. Labeled field patterns — scan first 8,000 chars where property details live
    #    Two sub-patterns: same-line ("Building Size: 150,000 SF") and
    #    next-line ("Building Size\n150,000 SF") since HTML renders both ways.
    _LABEL = (
        r"(?:building\s+(?:size|area)|total\s+(?:sf|size|area|square\s+feet)|"
        r"gross\s+(?:building\s+)?area|rentable\s+(?:building\s+)?area|"
        r"net\s+(?:rentable|leasable)\s+(?:area|sf)|leasable\s+area|"
        r"(?:GBA|RBA|GLA|NRA|NLA)\b|floor\s+area|floor\s+plate|"
        r"property\s+size|bldg\.?\s+(?:size|area|sf)|"
        r"warehouse\s+(?:size|area)|industrial\s+(?:space|area|size)|"
        r"total\s+building(?:\s+area)?|available\s+(?:space|area)|"
        r"gross\s+sq\.?\s*ft\.?)"
    )
    # Same-line: "Building Size: 150,000 SF"
    labeled = re.search(
        _LABEL + r"[:\s#–\-]+([,\d]+)\s*(?:SF|sq\.?\s*ft\.?|square\s+f(?:oot|eet))?",
        text[:8000], re.I,
    )
    # Next-line: "Building Size\n150,000\nSF" or "Building Size\n150,000 SF"
    if not labeled:
        labeled = re.search(
            _LABEL + r"\s*\n\s*([,\d]+)\s*(?:SF|sq\.?\s*ft\.?|square\s+f(?:oot|eet))?",
            text[:8000], re.I,
        )
    if labeled:
        val = float(labeled.group(1).replace(",", ""))
        if 5_000 <= val <= 2_000_000:   # sanity range
            return val

    # 2. All unlabeled SF matches across the page
    matches = _SF_RE.findall(text)
    if not matches:
        return None
    values = [float(m.replace(",", "")) for m in matches]

    # Prefer the FIRST value that falls in a typical industrial building range
    for v in values:
        if 50_000 <= v <= 600_000:
            return v

    # Last resort: first value above 1,000 SF
    for v in values:
        if v > 1_000:
            return v

    return None


def _re_clear_height(text: str) -> float | None:
    """
    Extract clear height in feet.  Tries both same-line and next-line label/value
    patterns since brokerage HTML often renders label and value on separate lines.
    """
    patterns = [
        # Same-line: "Clear Height: 32'" / "Ceiling Height 32 ft"
        r"(?:clear|ceiling)\s+height[^\n\d]*(\d+(?:\.\d+)?)",
        # Next-line: "Clear Height\n32'"
        r"(?:clear|ceiling)\s+height[^\n]*\n\s*(\d+(?:\.\d+)?)",
        # "Interior Clear: 32'" / "Interior Clearance: 32'"
        r"interior\s+clear(?:ance)?[^\n\d]*(\d+(?:\.\d+)?)",
        r"interior\s+clear(?:ance)?[^\n]*\n\s*(\d+(?:\.\d+)?)",
        # "Eave Height: 32'" / "Eave Ht: 32'"
        r"eave\s+(?:height|ht|clearance)[^\n\d]*(\d+(?:\.\d+)?)",
        r"eave\s+(?:height|ht|clearance)[^\n]*\n\s*(\d+(?:\.\d+)?)",
        # "Column Height: 32'" / "Overhead Clearance: 32'"
        r"(?:column|overhead)\s+(?:height|ht|clearance)[^\n\d]*(\d+(?:\.\d+)?)",
        r"(?:column|overhead)\s+(?:height|ht|clearance)[^\n]*\n\s*(\d+(?:\.\d+)?)",
        # "32' clear" / "32-ft clear" / "32' interior clear"
        r"(\d+(?:\.\d+)?)\s*['''ʼ\-–]?\s*(?:ft\.?[^\w\n]*)?\bClear\b(?!\s*(?:span\b|title|of\b))",
        # "32' Eave" / "32' Column Height"
        r"(\d+(?:\.\d+)?)['\s]*(?:eave|column)\s+(?:height|ht)",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.I)
        if m:
            val = float(m.group(1))
            if 8 <= val <= 100:
                return val
    return None


def _re_docks(text: str) -> float | None:
    """
    Extract loading dock count.  Covers same-line and next-line label/value patterns.
    """
    patterns = [
        # "12 dock-high doors" / "12 DH doors" / "12 dock doors"
        r"(\d+)\s+(?:dock[\s\-]*(?:high|door|leveler|position)?s?|DH\s+doors?)",
        # "Dock Doors: 12" / "Loading Docks: 12" / "Truck Doors: 12"
        r"(?:dock[\s\-]*(?:doors?|high|levelers?|positions?)|loading\s+docks?|truck\s+(?:doors?|docks?))\s*[:\-–]\s*(\d+)",
        # Next-line: "Dock Doors\n12" / "Loading Docks\n12"
        r"(?:dock[\s\-]*(?:doors?|high|levelers?|positions?)|loading\s+docks?)\s*\n\s*(\d+)",
        # "dock: 12" / "docks: 12"
        r"\bdocks?\s*[:\-–]\s*(\d+)",
        # "12 trailer positions" / "Trailer Positions: 12"
        r"(\d+)\s+trailer\s+(?:doors?|positions?|stalls?)",
        r"trailer\s+(?:doors?|positions?|stalls?)\s*[:\-–]\s*(\d+)",
        # Catchall: "12 dock" (but not dockyard/dock area)
        r"(\d+)\s+dock(?!\s*(?:yard|area|street|side))",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.I)
        if m:
            return float(m.group(1))
    return None


def _re_grade_doors(text: str) -> float | None:
    """
    Extract grade-level / drive-in door count.
    """
    patterns = [
        # "2 grade-level doors" / "3 drive-in doors" / "2 GL doors" / "2 DI doors"
        r"(\d+)\s+(?:grade[\s\-]*(?:level)?|drive[\s\-]*in|drive[\s\-]*thru|at[\s\-]*grade|GL\b|DI\b)\s*(?:doors?|OHD|overhead)?",
        # "Grade Level Doors: 2" / "Drive-In Doors: 2" / "Grade-Level Access: 2"
        r"(?:grade[\s\-]*level|drive[\s\-]*in|drive[\s\-]*thru|at[\s\-]*grade)\s+(?:doors?|OHD|overhead\s*doors?|access)\s*[:\-–]\s*(\d+)",
        # Next-line: "Grade Level Doors\n2" / "Drive-In Doors\n2"
        r"(?:grade[\s\-]*level|drive[\s\-]*in)\s+(?:doors?|OHD|access)[^\n]*\n\s*(\d+)",
        # "grade level: 2" / "grade-level access: 2"
        r"grade[\s\-]*level\s*(?:doors?|access|overhead)?\s*[:\-–]\s*(\d+)",
        r"grade[\s\-]*level\s*(?:doors?|access|overhead)?\s*\n\s*(\d+)",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.I)
        if m:
            return float(m.group(1))
    return None


def _re_asking_price(text: str) -> float | None:
    m = re.search(r"\$([\d,]+(?:\.\d+)?)\s*[Mm](?!\w)", text)
    if m:
        return float(m.group(1).replace(",", "")) * 1_000_000
    m = re.search(r"\$([\d,]{7,})", text)
    if m:
        val = float(m.group(1).replace(",", ""))
        if val > 100_000:
            return val
    return None


def _re_price_psf(text: str) -> float | None:
    m = re.search(r"\$([\d,]+(?:\.\d+)?)\s*/\s*(?:SF|sq\.?\s*ft)(?!\s*/\s*mo)", text, re.I)
    return float(m.group(1).replace(",", "")) if m else None


def _re_power(text: str) -> str | None:
    patterns = [
        r"(?:power|electrical?|electric\s+service)[:\s]+([^\n•|<]{3,60})",
        r"(?:power|electrical?|electric\s+service)\s*\n\s*([^\n•|<]{3,60})",
        r"(\d[\d,]*\s*(?:amp|amps?|A)\b[^\n]{0,40}(?:\d+\s*[Vv]|volt)[^\n]{0,20})",
        r"(\d[\d,]*\s*(?:volt|[Vv])\b[^\n]{0,20})",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.I)
        if m:
            val = m.group(1).strip().rstrip(".,;")
            if re.fullmatch(r"\([^)]+\)", val):
                continue
            val = re.sub(r"\s{2,}", " ", val)
            if val and len(val) >= 3:
                return val
    return None


def _re_sprinkler(text: str) -> str | None:
    # Labeled value: "Sprinkler: ESFR"
    m = re.search(r"sprinkler(?:ed|s?)[:\s]+([^\n•|<]{2,40})", text, re.I)
    if m:
        return m.group(1).strip()
    # Next-line: "Sprinkler\nESFR"
    m = re.search(r"sprinkler(?:ed|s?)\s*\n\s*([^\n•|<]{2,30})", text, re.I)
    if m:
        return m.group(1).strip()
    # Keyword matches → "Yes"
    if re.search(r"\bsprinklered\b", text, re.I):
        return "Yes"
    if re.search(
        r"\b(?:ESFR|EFSR|K-25|wet[\s\-]pipe|dry[\s\-]pipe|wet[\s\-]sprinkler|"
        r"dry[\s\-]sprinkler|fire\s+suppression|FM-200|pre[\s\-]action)\b",
        text, re.I,
    ):
        return "Yes"
    return None


def _re_zoning(text: str) -> str | None:
    patterns = [
        r"zoning[:\s]+([^\n•|,<]{1,40})",
        r"zoning\s*\n\s*([^\n•|,<]{1,40})",
        r"zone[:\s]+([A-Z][\w\-\s]{0,30})",
        r"\bzone[d\s]+([A-Z][\w\-\s]{0,20})",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.I)
        if m:
            val = m.group(1).strip()
            if val and len(val) >= 1:
                return val
    return None


def _re_office_pct(text: str) -> float | None:
    patterns = [
        r"(\d+(?:\.\d+)?)\s*%\s*office",
        r"office[:\s]+(\d+(?:\.\d+)?)\s*%",
        r"office\s+(?:space\s+)?%[:\s]+(\d+(?:\.\d+)?)",
        r"office\s*\n\s*(\d+(?:\.\d+)?)\s*%",
        r"(\d+(?:\.\d+)?)\s*%\s*(?:office\s+)?(?:space|area)",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.I)
        if m:
            val = float(m.group(1))
            if 0 <= val <= 100:
                return val
    return None


def _re_parking(text: str) -> float | None:
    patterns = [
        r"([\d.]+)\s*(?:stalls?|spaces?|cars?|spots?)\s*/\s*(?:1,?000\s*SF|MSF|KSF)",
        r"parking\s+ratio[:\s]+([\d.]+)",
        r"parking\s+ratio\s*\n\s*([\d.]+)",
        r"([\d.]+)\s*/\s*(?:1,?000\s*SF)\s+parking",
        r"([\d.]+)\s+per\s+(?:1,?000|msf|ksf)",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.I)
        if m:
            return float(m.group(1))
    return None


def _re_truck_court(text: str) -> float | None:
    patterns = [
        r"truck\s+court(?:\s+depth)?[:\s\-–]*(\d+(?:\.\d+)?)",
        r"truck\s+court(?:\s+depth)?\s*\n\s*(\d+(?:\.\d+)?)",
        r"(\d+(?:\.\d+)?)[^\w\n]*(?:ft\.?[^\w\n]*)?truck\s+court",
        r"(\d+)['\"]\s*(?:truck\s+court|TC\b)",
        r"maneuvering\s+(?:area|depth|yard)?[:\s]+(\d+)",
        r"(\d+)['\"]\s*maneuvering",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.I)
        if m:
            return float(m.group(1))
    return None


def _re_occupancy(text: str) -> float | None:
    """Extract occupancy / leased percentage (0–100)."""
    # "fully leased" / "100% leased" shorthand
    if re.search(r"\bfully\s+(?:leased|occupied)\b", text, re.I):
        return 100.0
    patterns = [
        # "95% leased" / "95% occupied" / "95% occupancy"
        r"(\d+(?:\.\d+)?)\s*%\s*(?:leased|occupied|occupancy|lease[d\s])",
        # "occupancy: 95%" / "leased: 95%"
        r"(?:occupancy|leased|occupied)[:\s]+(\d+(?:\.\d+)?)\s*%",
        # Next-line: "Occupancy\n95%"
        r"(?:occupancy|leased|occupied)\s*\n\s*(\d+(?:\.\d+)?)\s*%",
        # "95.0% occupancy"
        r"(\d+(?:\.\d+)?)\s*%\s+(?:current\s+)?occupancy",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.I)
        if m:
            val = float(m.group(1))
            if 0 <= val <= 100:
                return val
    return None


def _re_walt(text: str) -> float | None:
    """Extract WALT / WALE in years."""
    patterns = [
        # "WALT: 4.5 years" / "WALT: 4.5"
        r"WALT[:\s]+(\d+(?:\.\d+)?)\s*(?:years?|yrs?)?",
        r"WALT\s*\n\s*(\d+(?:\.\d+)?)",
        # "3.2 year WALT" / "3.2-year WALT"
        r"(\d+(?:\.\d+)?)\s*[\-\s]?(?:year|yr)[^\w]{0,5}WALT",
        # "Weighted Average Lease Term: 4.5 years"
        r"weighted\s+average\s+(?:lease\s+)?term[:\s]+(\d+(?:\.\d+)?)\s*(?:years?|yrs?)?",
        r"weighted\s+average\s+(?:lease\s+)?term\s*\n\s*(\d+(?:\.\d+)?)",
        # "WALE: 4.5" / "WAL: 4.5"
        r"(?:WALE|WAL)[:\s]+(\d+(?:\.\d+)?)\s*(?:years?|yrs?)?",
        r"(?:WALE|WAL)\s*\n\s*(\d+(?:\.\d+)?)",
        # "Average Lease Term: 4.5 years" / "Average Remaining Term: 4.5"
        r"average\s+(?:remaining\s+)?(?:lease\s+)?term[:\s]+(\d+(?:\.\d+)?)\s*(?:years?|yrs?)?",
        r"average\s+(?:remaining\s+)?(?:lease\s+)?term\s*\n\s*(\d+(?:\.\d+)?)",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.I)
        if m:
            val = float(m.group(1))
            if 0 < val < 50:
                return val
    return None


# ---------------------------------------------------------------------------
# Site definitions
# ---------------------------------------------------------------------------

_BUILTIN_SITES: list[dict] = [
    {
        "name": "cbre",
        "cbre_mode": True,       # uses _scrape_cbre_cards (scroll-based collection)
        "location_param": None,
        "extraction": "regex",
        # Candidate search URLs tried in order; first one that renders cards wins
        "cbre_search_urls": [
            "https://www.cbre.com/properties/properties-for-sale/industrial-space",
            "https://www.cbre.com/properties/properties-for-sale?propertyType=industrial",
            "https://www.cbre.com/properties/properties-for-sale",
        ],
        # Candidate link selectors tried in order after each scroll
        "cbre_link_selectors": [
            "a[href*='/properties/properties-for-sale/industrial-space/details/']",
            "a[href*='/properties/properties-for-sale/']",
            "a[href*='/properties/details/']",
            "[class*='PropertyCard'] a[href*='properties']",
            "[class*='property-card'] a[href*='properties']",
            "[class*='listing-card'] a[href]",
            "article a[href*='cbre.com/properties']",
        ],
    },
    {
        "name": "jll",
        # invest.jll.com is the working endpoint (confirmed via Railway prod data).
        # property.jll.com is JLL's newer SPA platform — usable as a fallback if
        # invest.jll.com is decommissioned, but its networkidle never settles
        # under stealth Playwright, causing goto timeouts.
        "search_url": (
            "https://invest.jll.com/us/en/property-search"
            "?filter=%7B%22assetTypes%22%3A%5B%22Industrial+%26+Logistics%22%5D"
            "%2C%22countries%22%3A%5B%22United+States%22%5D%7D"
        ),
        "listing_links": "a[href*='/us/en/listings/industrial-logistics/']",
        "pagination_param": "page",
        "max_pages": 20,
        "extraction": "regex",
        "location_param": None,
    },
    {
        "name": "cushman",
        # Cushman's US property search uses ?page=N for pagination
        # (verified via probe — #first, ?first, ?from are all ignored).
        # 12 per page × ~54 pages for ~649 industrial-for-sale listings.
        "search_url": (
            "https://www.cushmanwakefield.com/en/united-states/properties/invest/search"
            "?type=industrial,manufacturing,warehouse_sdistribution"
        ),
        "listing_links": "a[href*='/for-sale/']",
        "pagination_param": "page",
        "max_pages": 25,
        "wait_for_js": True,
        "extraction": "regex",
        "location_param": None,
    },
    {
        "name": "colliers",
        # Try main Colliers property search first; fall back to legacy RCM platform
        "search_url": "https://www.colliers.com/en-us/properties",
        "colliers_mode": True,
        # If True (default), use scrapers.colliers.ColliersScraper — direct API
        # against my.rcm1.com, no browser, captures broker contacts. Flip to
        # False to fall back to the legacy Playwright card scraper below.
        "colliers_use_api": True,
        "colliers_search_urls": [
            # Main Colliers property search — industrial for sale
            "https://www.colliers.com/en-us/properties?propertyType=Industrial&transactionType=Sale",
            # Legacy RCM / sales portal
            "https://sales.colliers.com/",
            # Capital markets / investment sales
            "https://capital.colliers.com/",
        ],
        "colliers_card_selectors": [
            # Main colliers.com property cards
            "a[href*='colliers.com/en-us/properties/']",
            "a[href*='colliers.com/en/us/properties/']",
            "[data-testid*='property'] a[href]",
            "[class*='PropertyCard'] a[href]",
            "[class*='property-card'] a[href]",
            "[class*='listing-card'] a[href]",
            # Legacy RCM domains
            "a[href*='my.rcm1.com']",
            "a[href*='rcm2.com']",
            "a[href*='rcm.colliers.com']",
        ],
        "location_param": None,
        "extraction": "regex",
    },
    {
        "name": "crexi",
        # Direct api.crexi.com scraper (scrapers.crexi.CrexiScraper) — the free
        # on-market source for the buy-box markets where Colliers is empty.
        # No browser; scoped to scrapers.markets.TARGET_MARKETS via lat/long
        # bounding boxes. Captures the listing broker's name + brokerage.
        "crexi_mode": True,
        "search_url": "https://www.crexi.com/",
        "location_param": None,
        "extraction": "regex",
    },
    {
        "name": "newmark",
        "search_url": (
            "https://nim.nmrk.com/properties"
            "?t=sale&pt=3%7C301%7C302%7C303%7C304%7C305%7C306%7C307%7C308%7C309%7C310"
        ),
        "newmark_mode": True,
        "location_param": None,
        "extraction": "regex",
    },
    {
        "name": "nai",
        "search_url": (
            "https://buildout.com/plugins/4fc4c741a2b49384c474ebc81ede3d108d02ca1c"
            "/www.naiglobal.com/inventory/"
            "?pluginId=0&iframe=true&embedded=true&cacheSearch=true&=undefined"
        ),
        "nai_mode": True,
        "location_param": None,
        "extraction": "regex",
    },
]


def _load_config() -> dict:
    if _CONFIG_PATH.exists():
        with open(_CONFIG_PATH) as f:
            return json.load(f)
    return {}


# ---------------------------------------------------------------------------
# Scraper
# ---------------------------------------------------------------------------

class BrokerageScraper(BaseScraper):
    SOURCE = "brokerage"

    def __init__(
        self,
        enabled_sites: list[str] | None = None,
        stop_event=None,          # threading.Event — set to request graceful stop
    ):
        super().__init__(headless=True)
        cfg = _load_config()
        self._sites = _BUILTIN_SITES + cfg.get("custom_sites", [])
        if enabled_sites:
            self._sites = [s for s in self._sites if s["name"] in enabled_sites]
        self._stop_event = stop_event

    def _should_stop(self) -> bool:
        """True if a graceful stop has been requested."""
        return self._stop_event is not None and self._stop_event.is_set()

    async def _collect_listing_urls(self, page, site: dict, market: str) -> list[str]:
        base = site["search_url"]
        loc_key = site.get("location_param", "location")
        extra = site.get("extra_params", "")
        pagination_param = site.get("pagination_param")
        max_pages = site.get("max_pages", 1)

        if loc_key and market:
            sep = "&" if "?" in base else "?"
            base_url = f"{base}{sep}{loc_key}={market.replace(' ', '+')}"
        else:
            base_url = base
        if extra:
            base_url = f"{base_url}&{extra}"

        selector = site.get("listing_links", "a[href]")
        text_filter = (site.get("text_filter") or "").lower()
        hrefs: list[str] = []
        seen: set[str] = set()
        search_hash = site.get("search_hash", "")
        hash_page_size = site.get("hash_page_size", 0)

        for page_num in range(1, max_pages + 1):
            if search_hash:
                first = (page_num - 1) * (hash_page_size or 12)
                page_hash = search_hash
                if first > 0:
                    page_hash = f"first={first}&{search_hash}"
                url = f"{base_url}#{page_hash}"
            elif pagination_param and page_num > 1:
                url = f"{base_url}&{pagination_param}={page_num}"
            else:
                url = base_url

            try:
                wait_event = "networkidle" if site.get("wait_for_js") else "domcontentloaded"
                await page.goto(url, wait_until=wait_event, timeout=60_000)
            except Exception as exc:
                logger.warning("[%s] search page %d failed: %s", site["name"], page_num, exc)
                break

            # For JS-heavy SPAs, try each comma-separated selector until one returns links
            found_selector = selector
            for sel in [s.strip() for s in selector.split(",")]:
                try:
                    await page.wait_for_selector(sel, timeout=10_000)
                    found_selector = sel
                    break
                except Exception:
                    continue

            await self._human_delay(2, 3)
            base_origin = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
            links = await page.query_selector_all(found_selector)
            page_count = 0

            for el in links:
                href = await el.get_attribute("href")
                if not href:
                    continue
                if text_filter:
                    try:
                        card_text = (await el.inner_text()).lower()
                        if text_filter not in card_text:
                            continue
                    except Exception:
                        pass
                full = href if href.startswith("http") else urljoin(base_origin, href)
                if full in seen or full == url:
                    continue
                seen.add(full)
                hrefs.append(full)
                page_count += 1

            logger.info("[%s] page %d: +%d listings (total %d)", site["name"], page_num, page_count, len(hrefs))
            if page_count == 0:
                break

        return hrefs

    async def _extract_regex(self, page) -> dict:
        try:
            text = await page.inner_text("body")
        except Exception:
            text = ""

        # ── Structured data extraction ──────────────────────────────────────
        # Many brokerage sites embed machine-readable data in:
        #   1. JSON-LD  (<script type="application/ld+json">)
        #   2. Next.js  (<script id="__NEXT_DATA__">)
        # We pull these and append as extra searchable text so the regex
        # helpers pick up values that may not appear in the visible page body.
        jld_address: str | None = None
        jld_sf: float | None = None
        extra_text = ""

        try:
            html = await page.content()

            # 1. JSON-LD
            for script_m in re.finditer(
                r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
                html, re.S | re.I,
            ):
                try:
                    obj = json.loads(script_m.group(1))
                    if isinstance(obj, list):
                        obj = next((o for o in obj if isinstance(o, dict)), {})
                    if not isinstance(obj, dict):
                        continue
                    # Address
                    addr_obj = obj.get("address") or {}
                    if isinstance(addr_obj, dict):
                        parts = [
                            addr_obj.get("streetAddress", ""),
                            addr_obj.get("addressLocality", ""),
                            addr_obj.get("addressRegion", ""),
                            addr_obj.get("postalCode", ""),
                        ]
                        candidate = ", ".join(p for p in parts if p)
                        if candidate and re.search(r"[A-Z]{2}", candidate):
                            jld_address = candidate
                    elif isinstance(addr_obj, str) and addr_obj:
                        jld_address = addr_obj
                    if not jld_address:
                        name = obj.get("name") or ""
                        if re.search(r",\s*[A-Z]{2}", name):
                            jld_address = name
                    # Floor size
                    fs = obj.get("floorSize") or obj.get("floor_size")
                    if isinstance(fs, dict):
                        jld_sf = self._safe_float(str(fs.get("value", "")))
                    elif isinstance(fs, (int, float)):
                        jld_sf = float(fs)
                    # Flatten remaining fields into searchable text
                    extra_text += " " + json.dumps(obj)
                    break
                except Exception:
                    pass

            # 2. Next.js __NEXT_DATA__ (used by CBRE among others)
            nd_m = re.search(
                r'<script[^>]+id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>',
                html, re.S | re.I,
            )
            if nd_m:
                try:
                    nd_text = nd_m.group(1)
                    nd = json.loads(nd_text)
                    # Flatten into searchable text — cap at 15k chars to avoid
                    # pulling in irrelevant sidebar / navigation data
                    extra_text += " " + json.dumps(nd)[:15000]
                except Exception:
                    pass

        except Exception:
            pass

        # Combine visible text + structured-data text for all regex passes
        full_text = text + ("\n" + extra_text if extra_text else "")

        # ── Address ─────────────────────────────────────────────────────────
        # Priority: JSON-LD > H1 > og:title > inline regex scan
        address = jld_address or ""
        if not address:
            try:
                h1 = await page.query_selector("h1")
                if h1:
                    address = (await h1.inner_text()).strip()
            except Exception:
                pass
        if not address:
            try:
                meta = await page.query_selector("meta[property='og:title']")
                if meta:
                    address = (await meta.get_attribute("content") or "").strip()
            except Exception:
                pass
        if not re.search(r",\s*[A-Z]{2}", address):
            m = re.search(
                r"(\d+[^,\n]+(?:,\s*[A-Za-z\s]+)+,\s*[A-Z]{2}(?:,\s*\d{5})?)",
                text[:3000],
            )
            if m:
                address = m.group(1).strip()

        if address and "\n" in address:
            lines = [ln.strip() for ln in address.splitlines() if ln.strip()]
            street = next((ln for ln in lines if re.search(r"\d+\s+\w", ln)), lines[0])
            address = street

        # ── Numeric fields ───────────────────────────────────────────────────
        sf = _re_sf(full_text)
        if sf is None and jld_sf and 5_000 <= jld_sf <= 2_000_000:
            sf = jld_sf

        price_psf = _re_price_psf(full_text)
        if not price_psf:
            asking_total = _re_asking_price(full_text)
            if asking_total and sf and sf > 0:
                price_psf = round(asking_total / sf, 2)

        return {
            "address":           address or None,
            "total_sf":          sf,
            "asking_price_psf":  price_psf,
            "clear_height":      _re_clear_height(full_text),
            "loading_docks":     _re_docks(full_text),
            "grade_doors":       _re_grade_doors(full_text),
            "zoning":            _re_zoning(full_text),
            "power":             _re_power(full_text),
            "sprinklered":       _re_sprinkler(full_text),
            "office_pct":        _re_office_pct(full_text),
            "parking_ratio":     _re_parking(full_text),
            "truck_court_depth": _re_truck_court(full_text),
            "occupancy_pct":     _re_occupancy(full_text),
            "walt":              _re_walt(full_text),
        }

    async def _extract_css(self, page, fields: dict) -> dict:
        async def _text(selector: str) -> str:
            try:
                el = await page.query_selector(selector)
                return (await el.inner_text()).strip() if el else ""
            except Exception:
                return ""

        address = await _text(fields.get("address", "h1"))
        total_sf_raw = await _text(fields.get("total_sf", ""))
        asking_psf_raw = await _text(fields.get("asking_price_psf", ""))
        clear_h_raw = await _text(fields.get("clear_height", ""))
        docks_raw = await _text(fields.get("loading_docks", ""))

        sf = self._sf_from_text(total_sf_raw) or self._safe_float(re.sub(r"[^\d.]", "", total_sf_raw))
        psf = self._psf_from_text(asking_psf_raw) or self._safe_float(re.sub(r"[^\d.]", "", asking_psf_raw))
        clear_h = self._safe_float(re.sub(r"[^\d.]", "", clear_h_raw))
        docks = self._safe_float(re.sub(r"[^\d]", "", docks_raw))

        return {
            "address":           address or None,
            "total_sf":          sf,
            "asking_price_psf":  psf,
            "clear_height":      clear_h,
            "loading_docks":     docks,
            "grade_doors":       None,
            "zoning":            (await _text(fields.get("zoning", ""))) or None,
            "power":             (await _text(fields.get("power", ""))) or None,
            "sprinklered":       (await _text(fields.get("sprinklered", ""))) or None,
            "office_pct":        None,
            "parking_ratio":     None,
            "truck_court_depth": None,
            "occupancy_pct":     None,
            "walt":              None,
        }

    async def _scrape_detail(self, page, url: str, site: dict) -> dict | None:
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            await self._human_delay(1, 3)
        except Exception as exc:
            logger.warning("[%s] detail page failed %s: %s", site["name"], url, exc)
            return None

        extraction = site.get("extraction", "regex")
        fields = site.get("fields", {})
        if extraction == "regex" or not fields:
            extracted = await self._extract_regex(page)
        else:
            extracted = await self._extract_css(page, fields)
            if not any(extracted.values()):
                extracted = await self._extract_regex(page)

        return {
            "source":        site["name"],
            "listing_url":   url,
            "building_type": "Industrial",
            "raw_data":      {"site": site["name"], "url": url},
            **extracted,
        }

    async def _scrape_cbre_cards(
        self,
        page,
        market_patterns: list[re.Pattern],
        markets: list[str],
        market_rents: dict[str, float],
        known_urls: set[str] | None = None,
    ) -> AsyncGenerator[dict, None]:
        """
        CBRE is an infinite-scroll SPA that lazy-loads cards.
        We scroll repeatedly to collect all listing URLs, then visit each detail page.
        """
        site_cfg = next((s for s in self._sites if s.get("cbre_mode")), {})
        search_urls: list[str] = site_cfg.get("cbre_search_urls") or [
            "https://www.cbre.com/properties/properties-for-sale/industrial-space",
            "https://www.cbre.com/properties/properties-for-sale",
        ]
        link_selectors: list[str] = site_cfg.get("cbre_link_selectors") or [
            "a[href*='/properties/properties-for-sale/industrial-space/details/']",
            "a[href*='/properties/properties-for-sale/']",
            "a[href*='/properties/details/']",
        ]

        # Try each search URL until one renders cards
        active_selector: str | None = None
        active_search_url = search_urls[0]

        for try_url in search_urls:
            logger.info("[cbre] trying search URL: %s", try_url)
            try:
                await page.goto(try_url, wait_until="domcontentloaded", timeout=60_000)
                await self._human_delay(3, 5)
                # Try one slow scroll to trigger lazy-loading, then check selectors
                await page.evaluate("window.scrollTo(0, document.body.scrollHeight / 2)")
                await self._human_delay(2, 3)
            except Exception as exc:
                logger.warning("[cbre] search URL failed (%s): %s", try_url, exc)
                continue

            active_search_url = try_url
            for sel in link_selectors:
                try:
                    els = await page.query_selector_all(sel)
                    if els:
                        active_selector = sel
                        logger.info("[cbre] selector '%s' matched %d elements on %s",
                                    sel, len(els), try_url)
                        break
                except Exception:
                    continue

            if active_selector:
                break

        if not active_selector:
            logger.warning("[cbre] no link selector matched on any search URL — skipping")
            return

        # Scroll to collect all listing URLs
        seen_urls: set[str] = set()
        listing_urls: list[str] = []
        base_origin = "https://www.cbre.com"
        stall = 0

        for scroll_num in range(60):  # up to 60 scrolls → ~600 listings
            if self._should_stop():
                logger.info("[cbre] stop requested during scroll — halting link collection")
                break

            els = await page.query_selector_all(active_selector)
            new = 0
            for el in els:
                href = await el.get_attribute("href")
                if not href:
                    continue
                full = href if href.startswith("http") else urljoin(base_origin, href)
                if full in seen_urls or full == active_search_url:
                    continue
                seen_urls.add(full)
                listing_urls.append(full)
                new += 1

            logger.debug("[cbre] scroll %d: +%d links (total %d)", scroll_num + 1, new, len(listing_urls))

            if new == 0:
                stall += 1
                if stall >= 4:
                    break
            else:
                stall = 0

            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await self._human_delay(1.5, 2.5)

        logger.info("[cbre] collected %d listing URLs after scrolling", len(listing_urls))

        # Visit each detail page
        new_urls = [u for u in listing_urls[:300] if u not in (known_urls or set())]
        cached_skip = len(listing_urls[:300]) - len(new_urls)
        if cached_skip:
            logger.info("[cbre] skipping %d cached, fetching %d new", cached_skip, len(new_urls))

        site_dict = {"name": "cbre", "extraction": "regex"}
        for url in new_urls:
            if self._should_stop():
                logger.info("[cbre] stop requested — halting detail scrape")
                return
            detail = await self._scrape_detail(page, url, site_dict)
            if not detail:
                await self._human_delay(1, 2)
                continue
            addr = detail.get("address") or ""
            if not _is_us_address(addr):
                logger.debug("[cbre] skip %s — non-US", addr)
                continue
            if not _passes_sf_filter(detail.get("total_sf")):
                logger.debug("[cbre] skip %s — SF out of range", addr)
                continue
            if market_patterns and not any(p.search(addr) for p in market_patterns):
                continue
            yield detail
            await self._human_delay(1, 2)

    async def _scrape_colliers_cards(
        self,
        page,
        market_patterns: list[re.Pattern],
        markets: list[str],
        market_rents: dict[str, float],
        known_urls: set[str] | None = None,
    ) -> AsyncGenerator[dict, None]:
        # Try each search URL in order until one loads and yields card links
        site_cfg = next(
            (s for s in self._sites if s.get("colliers_mode")), {}
        )
        search_urls: list[str] = site_cfg.get("colliers_search_urls") or [
            "https://www.colliers.com/en-us/properties?propertyType=Industrial&transactionType=Sale",
            "https://sales.colliers.com/",
        ]
        candidate_selectors: list[str] = site_cfg.get("colliers_card_selectors") or [
            "a[href*='colliers.com/en-us/properties/']",
            "[class*='property-card'] a[href]",
            "[class*='listing-card'] a[href]",
            "a[href*='my.rcm1.com']",
            "a[href*='rcm2.com']",
        ]

        search_url = search_urls[0]
        card_selector: str | None = None

        for try_url in search_urls:
            try:
                logger.info("[colliers] trying search URL: %s", try_url)
                await page.goto(try_url, wait_until="domcontentloaded", timeout=45_000)
                await self._human_delay(2, 4)
            except Exception as exc:
                logger.warning("[colliers] search URL failed (%s): %s", try_url, exc)
                continue

            search_url = try_url  # remember which one loaded
            for sel in candidate_selectors:
                try:
                    await page.wait_for_selector(sel, timeout=6_000)
                    test = await page.query_selector_all(sel)
                    if test:
                        card_selector = sel
                        logger.info("[colliers] matched selector '%s' on %s (%d cards)",
                                    sel, try_url, len(test))
                        break
                except Exception:
                    continue

            if card_selector:
                break  # found a working URL + selector combo

        if not card_selector:
            logger.warning(
                "[colliers] no card selector matched on any search URL — "
                "site structure may have changed"
            )
            return

        seen_hrefs: set[str] = set()
        matched: list[tuple[str, str]] = []
        stall = 0

        for scroll_num in range(80):
            if self._should_stop():
                logger.info("[colliers] stop requested during scroll")
                return

            cards = await page.query_selector_all(card_selector)
            new = 0
            for card in cards:
                href = await card.get_attribute("href")
                if not href or href in seen_hrefs:
                    continue
                seen_hrefs.add(href)
                new += 1
                try:
                    card_text = await card.inner_text()
                except Exception:
                    continue
                if "industrial" not in card_text.lower():
                    continue
                if market_patterns and not any(p.search(card_text) for p in market_patterns):
                    continue
                matched.append((href, card_text))

            if new == 0:
                stall += 1
                if stall >= 3:
                    break
            else:
                stall = 0

            logger.debug("[colliers] scroll %d: +%d new cards, %d matched", scroll_num + 1, new, len(matched))
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await self._human_delay(1.5, 3)

        logger.info("[colliers] collected %d industrial cards", len(matched))

        for href, card_text in matched[:300]:
            if self._should_stop():
                logger.info("[colliers] stop requested — halting detail scrape")
                return
            lines = [ln.strip() for ln in card_text.splitlines() if ln.strip()]
            address = None
            for i, line in enumerate(lines):
                if re.search(r",\s*[A-Z]{2}(?:\s+\d{5})?(?:$|[,\s])", line):
                    address = line
                    break
                if re.match(r"\d+\s+\w", line) and i + 1 < len(lines):
                    nxt = lines[i + 1]
                    if re.search(r",\s*[A-Z]{2}", nxt):
                        address = f"{line}, {nxt}"
                        break
                    address = line
            if not address:
                continue
            if market_patterns and not any(p.search(address) for p in market_patterns):
                continue

            # US filter
            if not _is_us_address(address):
                logger.debug("[colliers] skip %s — non-US address", address)
                continue

            sf = _re_sf(card_text)
            price_total = _re_asking_price(card_text)
            price_psf = None
            if price_total and sf and sf > 0:
                price_psf = round(price_total / sf, 2)
            else:
                price_psf = _re_price_psf(card_text)

            # Early SF filter (before detail fetch)
            if not _passes_sf_filter(sf):
                logger.debug("[colliers] skip %s — SF %.0f out of range", address, sf or 0)
                continue

            # Skip detail fetch for already-cached listings
            if known_urls and href in known_urls:
                logger.debug("[colliers] skip detail (cached): %s", href)
                continue

            detail_extra: dict = {}
            try:
                await page.goto(href, wait_until="domcontentloaded", timeout=20_000)
                await self._human_delay(1, 2)
                detail_text = await page.inner_text("body")
                if "page not found" not in detail_text.lower() and len(detail_text) > 500:
                    d = await self._extract_regex(page)
                    for key in ("clear_height", "loading_docks", "grade_doors", "zoning",
                                "power", "sprinklered", "office_pct", "parking_ratio",
                                "truck_court_depth", "occupancy_pct", "walt"):
                        if d.get(key) is not None:
                            detail_extra[key] = d[key]
                    if d.get("asking_price_psf") and not price_psf:
                        price_psf = d["asking_price_psf"]
                    # Re-validate SF from detail page
                    if sf is None and d.get("total_sf"):
                        sf = d["total_sf"]
                        if not _passes_sf_filter(sf):
                            await page.goto(search_url, wait_until="domcontentloaded", timeout=30_000)
                            continue
                await page.goto(search_url, wait_until="domcontentloaded", timeout=30_000)
                await self._human_delay(1, 2)
            except Exception:
                pass

            yield {
                "source":            "colliers",
                "listing_url":       href,
                "building_type":     "Industrial",
                "address":           address,
                "total_sf":          sf,
                "asking_price_psf":  price_psf,
                "clear_height":      None,
                "loading_docks":     None,
                "grade_doors":       None,
                "zoning":            None,
                "power":             None,
                "sprinklered":       None,
                "office_pct":        None,
                "parking_ratio":     None,
                "truck_court_depth": None,
                "occupancy_pct":     None,
                "walt":              None,
                **detail_extra,
            }

    @staticmethod
    def _parse_card_address(card_text: str) -> str | None:
        lines = [ln.strip() for ln in card_text.splitlines() if ln.strip()]
        for i, line in enumerate(lines):
            if re.search(r",\s*[A-Z]{2}(?:\s+\d{5})?(?:$|[,\s])", line):
                if "|" in line:
                    parts = line.split("|", 1)
                    return f"{parts[0].strip()}, {parts[1].strip()}"
                return line
            if re.match(r"\d+\s+\w", line) and i + 1 < len(lines):
                nxt = lines[i + 1]
                if re.search(r",\s*[A-Z]{2}", nxt):
                    return f"{line}, {nxt}"
            if "|" in line:
                parts = line.split("|", 1)
                if re.search(r",\s*[A-Z]{2}", parts[1]):
                    return f"{parts[0].strip()}, {parts[1].strip()}"
        return None

    async def _scrape_newmark_cards(
        self,
        page,
        market_patterns: list[re.Pattern],
        markets: list[str],
        market_rents: dict[str, float],
        known_urls: set[str] | None = None,
    ) -> AsyncGenerator[dict, None]:
        """NIM needs a bare context — extra stealth headers break their listing API."""
        nim_page, nim_ctx = await self.new_bare_page()
        try:
            search_url = (
                "https://nim.nmrk.com/properties"
                "?t=sale&pt=3%7C301%7C302%7C303%7C304%7C305%7C306%7C307%7C308%7C309%7C310"
            )
            try:
                await nim_page.goto(search_url, wait_until="domcontentloaded", timeout=45_000)
                await self._human_delay(4, 6)
            except Exception as exc:
                logger.warning("[newmark] failed to load search page: %s", exc)
                return

            # NIM may render links as absolute or relative URLs
            card_selectors_nim = [
                "a[href*='nmrk.com/properties/']",
                "a[href*='/properties/']",
                "[class*='property-card'] a[href]",
                "[class*='listing'] a[href]",
                "article a[href]",
            ]
            card_selector = card_selectors_nim[0]
            for sel in card_selectors_nim:
                try:
                    await nim_page.wait_for_selector(sel, timeout=8_000)
                    test = await nim_page.query_selector_all(sel)
                    if test:
                        card_selector = sel
                        logger.info("[newmark] using card selector: %s (%d cards found)", sel, len(test))
                        break
                except Exception:
                    continue

            seen_hrefs: set[str] = set()
            matched: list[tuple[str, str, str]] = []

            for page_num in range(1, 20):
                if self._should_stop():
                    logger.info("[newmark] stop requested during page collection")
                    break

                cards = await nim_page.query_selector_all(card_selector)
                page_new = 0
                for card in cards:
                    href = await card.get_attribute("href")
                    if not href or href in seen_hrefs:
                        continue
                    # Normalise relative URLs
                    if href.startswith("/"):
                        href = "https://nim.nmrk.com" + href
                    elif not href.startswith("http"):
                        continue
                    seen_hrefs.add(href)
                    page_new += 1
                    try:
                        card_text = await card.inner_text()
                    except Exception:
                        continue
                    if "for sale" not in card_text.lower() and "investment" not in card_text.lower():
                        continue
                    if "industrial" not in card_text.lower() and "warehouse" not in card_text.lower() and "flex" not in card_text.lower():
                        continue
                    address = self._parse_card_address(card_text)
                    if not address:
                        continue
                    if market_patterns and not any(p.search(address) for p in market_patterns):
                        continue
                    matched.append((href, card_text, address))

                logger.info("[newmark] page %d: %d new cards, %d matched", page_num, page_new, len(matched))

                await nim_page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                await self._human_delay(1, 2)
                next_num = str(page_num + 1)
                next_btn = None
                for el in await nim_page.query_selector_all("button, a"):
                    try:
                        if (await el.inner_text()).strip() == next_num and await el.is_visible():
                            next_btn = el
                            break
                    except Exception:
                        pass
                if not next_btn or page_new == 0:
                    break
                await next_btn.click()
                await self._human_delay(2, 3)

            logger.info("[newmark] visiting %d detail pages", len(matched))

            for href, card_text, address in matched[:200]:
                if self._should_stop():
                    logger.info("[newmark] stop requested — halting detail scrape")
                    return

                # US filter
                if not _is_us_address(address):
                    logger.debug("[newmark] skip %s — non-US", address)
                    continue

                sf = _re_sf(card_text)
                price_total = _re_asking_price(card_text)
                price_psf: float | None = None
                if price_total and sf and sf > 0:
                    price_psf = round(price_total / sf, 2)
                else:
                    price_psf = _re_price_psf(card_text)

                # Early SF filter
                if not _passes_sf_filter(sf):
                    logger.debug("[newmark] skip %s — SF %.0f out of range", address, sf or 0)
                    continue

                # Skip detail fetch for already-cached listings
                if known_urls and href in known_urls:
                    logger.debug("[newmark] skip detail (cached): %s", href)
                    continue

                detail_extra: dict = {}
                detail_url = href if href.startswith("http") else f"https:{href}"
                try:
                    await nim_page.goto(detail_url, wait_until="domcontentloaded", timeout=20_000)
                    await self._human_delay(1, 2)
                    d = await self._extract_regex(nim_page)
                    for key in ("clear_height", "loading_docks", "grade_doors", "zoning",
                                "power", "sprinklered", "office_pct", "parking_ratio",
                                "truck_court_depth", "occupancy_pct", "walt"):
                        if d.get(key) is not None:
                            detail_extra[key] = d[key]
                    if d.get("asking_price_psf") and not price_psf:
                        price_psf = d["asking_price_psf"]
                    if sf is None and d.get("total_sf"):
                        sf = d["total_sf"]
                        if not _passes_sf_filter(sf):
                            continue
                except Exception:
                    pass

                yield {
                    "source":            "newmark",
                    "listing_url":       href,
                    "building_type":     "Industrial",
                    "address":           address,
                    "total_sf":          sf,
                    "asking_price_psf":  price_psf,
                    "clear_height":      None,
                    "loading_docks":     None,
                    "grade_doors":       None,
                    "zoning":            None,
                    "power":             None,
                    "sprinklered":       None,
                    "office_pct":        None,
                    "parking_ratio":     None,
                    "truck_court_depth": None,
                    "occupancy_pct":     None,
                    "walt":              None,
                    **detail_extra,
                }
                await self._human_delay(1, 2)
        finally:
            await nim_ctx.close()

    _NAI_PLUGIN = "4fc4c741a2b49384c474ebc81ede3d108d02ca1c"

    async def _scrape_nai_cards(
        self,
        page,
        market_patterns: list[re.Pattern],
        markets: list[str],
        market_rents: dict[str, float],
        known_urls: set[str] | None = None,
    ) -> AsyncGenerator[dict, None]:
        iframe_url = (
            f"https://buildout.com/plugins/{self._NAI_PLUGIN}"
            "/www.naiglobal.com/inventory/"
            "?pluginId=0&iframe=true&embedded=true&cacheSearch=true&=undefined"
        )
        # Seed cookies by visiting the main NAI site first, then the BuildOut iframe.
        # Without this, the CSRF cookie is often missing from the domain.
        try:
            await page.goto("https://www.naiglobal.com/", wait_until="domcontentloaded", timeout=30_000)
            await self._human_delay(2, 3)
            await page.goto(iframe_url, wait_until="networkidle", timeout=60_000)
            await self._human_delay(4, 6)
        except Exception as exc:
            logger.warning("[nai] failed to load BuildOut iframe: %s", exc)
            return

        yielded = 0
        plugin = self._NAI_PLUGIN
        consecutive_html = 0  # track consecutive HTML responses (CSRF failures)

        for pg in range(0, 80):
            if self._should_stop():
                logger.info("[nai] stop requested — halting inventory fetch")
                return

            try:
                data = await page.evaluate(f"""
async () => {{
    // Try multiple sources for the CSRF token
    const getCsrf = () => {{
        // 1. Cookie
        for (const c of document.cookie.split(';')) {{
            const [k, v] = c.trim().split('=');
            if (k.trim() === 'csrftoken') return decodeURIComponent(v || '');
        }}
        // 2. Hidden form input
        const el = document.querySelector('[name=csrfmiddlewaretoken]');
        if (el) return el.value;
        // 3. Meta tag
        const meta = document.querySelector('meta[name=csrf-token]');
        if (meta) return meta.getAttribute('content') || '';
        return '';
    }};
    const csrf = getCsrf();
    const params = new URLSearchParams({{
        csrfmiddlewaretoken: csrf,
        page: '{pg}',
        property_type: 'Industrial',
        polygon_geojson: '',
        lat_min: '', lat_max: '', lng_min: '', lng_max: '',
        mobile_lat_min: '', mobile_lat_max: '',
        mobile_lng_min: '', mobile_lng_max: '',
        map_display_limit: '5000',
        map_type: 'roadmap',
        use_marker_clustering: 'false',
    }});
    const resp = await fetch('/plugins/{plugin}/inventory', {{
        method: 'POST',
        headers: {{
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
            'X-CSRFToken': csrf,
            'Referer': window.location.href,
        }},
        credentials: 'include',
        body: params.toString(),
    }});
    const text = await resp.text();
    const trimmed = text.trimStart();
    if (trimmed.startsWith('<')) {{
        return {{ _html_response: trimmed.substring(0, 300), _csrf: csrf }};
    }}
    try {{ return JSON.parse(text); }} catch(e) {{ return {{ _parse_error: e.toString(), _raw: trimmed.substring(0, 200) }}; }}
}}
""")
            except Exception as exc:
                logger.warning("[nai] page %d API call failed: %s", pg, exc)
                break

            if not data or not isinstance(data, dict):
                logger.warning("[nai] page %d: unexpected response type: %s", pg, type(data))
                break
            if "_html_response" in data:
                consecutive_html += 1
                csrf_val = data.get("_csrf", "")
                logger.warning(
                    "[nai] page %d: HTML response (CSRF '%s' / consecutive=%d): %s",
                    pg, csrf_val[:20] if csrf_val else "empty", consecutive_html,
                    data["_html_response"][:100],
                )
                if consecutive_html >= 2:
                    logger.warning("[nai] CSRF appears broken — reloading iframe to refresh cookies")
                    try:
                        await page.goto(iframe_url, wait_until="networkidle", timeout=45_000)
                        await self._human_delay(3, 5)
                        consecutive_html = 0
                        continue
                    except Exception:
                        break
                continue  # retry same page after reload
            consecutive_html = 0
            if "_parse_error" in data:
                logger.warning("[nai] page %d: JSON parse error: %s | raw: %s", pg, data["_parse_error"], data.get("_raw"))
                break
            inventory = data.get("inventory", [])
            if not inventory:
                logger.info("[nai] page %d: empty inventory — done", pg)
                break

            page_yielded = 0
            for item in inventory:
                url = item.get("also_for_sale_or_lease_url", "") or ""
                if not url.endswith("-sale") and "-sale" not in url:
                    continue

                attrs = item.get("index_attributes") or {}
                info = item.get("info_window_attributes") or {}
                prop_type = (
                    attrs.get("property_type")
                    or attrs.get("property_use")
                    or info.get("property_type")
                    or ""
                )
                if prop_type and not any(
                    kw in prop_type.lower()
                    for kw in ("industrial", "warehouse", "flex", "distribution", "manufacturing")
                ):
                    continue

                address = (
                    item.get("address_one_line")
                    or item.get("display_name_address")
                    or f"{item.get('address','')} {item.get('city_state','')}"
                ).strip()
                if not address:
                    continue
                if market_patterns and not any(p.search(address) for p in market_patterns):
                    continue
                if not _is_us_address(address):
                    continue

                sf: float | None = None
                for key in ("size", "building_size", "total_sf", "sq_ft", "square_feet"):
                    raw = attrs.get(key) or info.get(key)
                    if raw:
                        sf = self._safe_float(re.sub(r"[^\d.]", "", str(raw)))
                        if sf:
                            break

                if not _passes_sf_filter(sf):
                    continue

                price_psf: float | None = None
                for key in ("price", "sale_price", "asking_price"):
                    raw = attrs.get(key) or info.get(key)
                    if raw:
                        total = self._safe_float(re.sub(r"[^\d.]", "", str(raw)))
                        if total and total > 100_000:
                            price_psf = round(total / sf, 2) if sf and sf > 0 else None
                        break

                listing_url = url or f"http://www.naiglobal.com/listings?propertyId={item.get('id','')}"

                # Skip already-cached NAI listings
                if known_urls and listing_url in known_urls:
                    logger.debug("[nai] skip (cached): %s", listing_url)
                    continue

                yield {
                    "source":            "nai",
                    "listing_url":       listing_url,
                    "building_type":     "Industrial",
                    "address":           address,
                    "total_sf":          sf,
                    "asking_price_psf":  price_psf,
                    "clear_height":      None,
                    "loading_docks":     None,
                    "grade_doors":       None,
                    "zoning":            None,
                    "power":             None,
                    "sprinklered":       None,
                    "office_pct":        None,
                    "parking_ratio":     None,
                    "truck_court_depth": None,
                    "occupancy_pct":     None,
                    "walt":              None,
                }
                yielded += 1
                page_yielded += 1

            logger.info("[nai] page %d: %d items, %d yielded", pg, len(inventory), page_yielded)
            if len(inventory) < 30:
                break
            await self._human_delay(0.5, 1)

        logger.info("[nai] total yielded: %d", yielded)

    async def scrape(
        self,
        markets: list[str],
        market_rents: dict[str, float],
        max_age_hours: float = 336,   # re-fetch listings older than 14 days; 0 = always re-fetch
    ) -> AsyncGenerator[dict, None]:
        """
        Yield only NEW or STALE listings.

        known_urls: set of listing URLs already in the cache that were scraped
        within `max_age_hours`.  Detail pages for these URLs are skipped entirely,
        making incremental runs dramatically faster when few new deals have appeared.

        Set max_age_hours=0 to force a full re-scrape of every listing.
        """
        from database import get_known_urls
        known_urls: set[str] = (
            get_known_urls(max_age_hours=max_age_hours) if max_age_hours > 0 else set()
        )
        logger.info(
            "[scrape] cache contains %d URLs (max_age=%.0fh) — will skip their detail pages",
            len(known_urls), max_age_hours,
        )

        # Empty markets list = nationwide (no geographic filtering)
        market_patterns: list[re.Pattern] = []
        for m in markets:
            parts = [p.strip().lower() for p in m.split(",")]
            city = re.escape(parts[0])
            market_patterns.append(re.compile(city, re.I))
            if len(parts) > 1:
                state = re.escape(parts[1].strip())
                market_patterns.append(re.compile(rf",\s*{state}(?=[,\d\s]|$)", re.I))

        async with self:
            page = await self.new_page()
            for site in self._sites:
                site_name = site.get("name", "unknown")
                logger.info("[scrape] starting brokerage: %s", site_name)
                try:
                    if site.get("cbre_mode"):
                        async for listing in self._scrape_cbre_cards(
                            page, market_patterns, markets, market_rents, known_urls=known_urls
                        ):
                            yield listing
                        continue

                    if site.get("colliers_mode"):
                        if site.get("colliers_use_api", True):
                            # Direct-API path — no browser, captures broker contacts.
                            # Self-contained httpx context so it doesn't share the
                            # Playwright page or the brokerage browser session.
                            from .colliers import ColliersScraper
                            async with ColliersScraper(stop_event=self._stop_event) as cs:
                                async for listing in cs.scrape(
                                    markets, market_rents, known_urls=known_urls,
                                ):
                                    yield listing
                        else:
                            # Legacy Playwright fallback (selector-rotted as of
                            # 2026-06-08, kept for emergency switchover).
                            async for listing in self._scrape_colliers_cards(
                                page, market_patterns, markets, market_rents, known_urls=known_urls
                            ):
                                yield listing
                        continue

                    if site.get("crexi_mode"):
                        # Direct-API path — no browser. Self-contained httpx
                        # context; scoped to the buy-box markets internally.
                        from .crexi import CrexiScraper
                        async with CrexiScraper(stop_event=self._stop_event) as cx:
                            async for listing in cx.scrape(
                                markets, market_rents, known_urls=known_urls,
                            ):
                                yield listing
                        continue

                    if site.get("newmark_mode"):
                        async for listing in self._scrape_newmark_cards(
                            page, market_patterns, markets, market_rents, known_urls=known_urls
                        ):
                            yield listing
                        continue

                    if site.get("nai_mode"):
                        async for listing in self._scrape_nai_cards(
                            page, market_patterns, markets, market_rents, known_urls=known_urls
                        ):
                            yield listing
                        continue

                    no_loc = site.get("location_param") is None and "location_param" in site
                    if no_loc or not markets:
                        # No server-side location filter, OR nationwide mode
                        listing_urls = await self._collect_listing_urls(page, site, "")
                        new_urls    = [u for u in listing_urls[:300] if u not in known_urls]
                        cached_skip = len(listing_urls[:300]) - len(new_urls)
                        if cached_skip:
                            logger.info("[%s] skipping %d cached URLs, fetching %d new",
                                        site_name, cached_skip, len(new_urls))
                        for url in new_urls:
                            detail = await self._scrape_detail(page, url, site)
                            if not detail:
                                await self._human_delay(1, 2)
                                continue
                            addr = detail.get("address") or ""
                            if market_patterns and not any(p.search(addr) for p in market_patterns):
                                continue
                            if not _is_us_address(addr):
                                logger.debug("[%s] skip %s — non-US", site_name, addr)
                                continue
                            if not _passes_sf_filter(detail.get("total_sf")):
                                logger.debug(
                                    "[%s] skip %s — SF %.0f out of range",
                                    site_name, addr, detail.get("total_sf") or 0,
                                )
                                continue
                            yield detail
                            await self._human_delay(1, 2)
                    else:
                        for market in markets:
                            rent = market_rents.get(market.lower())
                            listing_urls = await self._collect_listing_urls(page, site, market)
                            new_urls = [u for u in listing_urls[:100] if u not in known_urls]
                            for url in new_urls:
                                detail = await self._scrape_detail(page, url, site)
                                if detail:
                                    addr = detail.get("address") or ""
                                    if not _is_us_address(addr):
                                        continue
                                    if not _passes_sf_filter(detail.get("total_sf")):
                                        continue
                                    if rent and not detail.get("market_gross_rent_small_bay"):
                                        detail["market_gross_rent_small_bay"] = rent
                                    yield detail
                                await self._human_delay(1, 2)

                except Exception as exc:
                    # Isolate per-brokerage failures — log and continue to next site
                    logger.error(
                        "[%s] brokerage scrape failed, skipping: %s", site_name, exc,
                        exc_info=True,
                    )
                    continue
