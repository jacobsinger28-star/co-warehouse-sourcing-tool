"""
Broker-contact enrichment — turn a brokerage website + broker name into a
callable phone and a best-effort email, WITHOUT a browser.

Why this exists
---------------
Crexi gates a broker's direct email/cell behind a lead form, so its API returns
them null (see scrapers/crexi.py). But the same ``/brokers`` payload hands us two
things Crexi does NOT gate: the broker's state-license brokerage phone and the
brokerage's public **website**. This module mines the website:

  * PHONE  — the brokerage's main office line, read from the site's ``tel:`` links
    (or a visible number). Combined with the state-license phone captured in
    crexi.py, this yields a real, callable number for the large majority of
    listings — where Crexi alone gave us nothing.
  * EMAIL  — brokerage sites rarely publish a broker's *direct* address on the
    home page, so we derive a likely address from the firm's known email pattern
    (:data:`KNOWN_FIRM_PATTERNS`, seeded from confirmed CRE patterns) or from a
    pattern inferred off any personal ``mailto:`` the site does publish. A derived
    address is returned as a **guess** (``email_guess``) and is never promoted to
    the verified ``email`` field — matching the team rule *"never write a bare
    pattern guess to the CRM; verify on a real page first."* A guess plus its
    source domain is exactly what makes that one-click verify fast. An address is
    only returned as verified when it actually appears as a ``mailto:`` on the
    firm's own site.

Everything here is best-effort: any network/parse failure returns empty, so
enabling enrichment can only ever *add* contact info, never break a scrape.
"""
from __future__ import annotations

import asyncio
import logging
import re
from urllib.parse import urlsplit

import httpx

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Fetch tuning
# ---------------------------------------------------------------------------

# Per-request timeout for a brokerage site (their marketing sites are usually
# small static pages; a slow one is not worth blocking a scrape on).
_TIMEOUT = 8.0
# Pages fetched per domain before giving up: the root, then a few likely
# contact/team pages where personal emails tend to live. Capped so we stay
# polite (each brokerage domain is hit at most this many times, once per run).
_CONTACT_PATHS = ("", "contact", "team", "our-team", "about", "agents")
_MAX_PAGES = 3

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# ---------------------------------------------------------------------------
# Email-pattern knowledge
# ---------------------------------------------------------------------------

# Local-part builders. `first`/`last` are already lowercased a-z only.
_PATTERN_FUNCS = {
    "first.last": lambda f, l: f"{f}.{l}",
    "firstlast":  lambda f, l: f"{f}{l}",
    "first_last": lambda f, l: f"{f}_{l}",
    "flast":      lambda f, l: f"{f[:1]}{l}",        # finitial + last  (dsheeran)
    "firstl":     lambda f, l: f"{f}{l[:1]}",
    "first":      lambda f, l: f,
    "last":       lambda f, l: l,
}

# Confirmed firm email patterns (domain -> pattern key), seeded from the sourcing
# team's `cre-firm-email-patterns` note. Only unambiguous ones are listed — firms
# whose format varies by office (e.g. Lee & Associates) are deliberately omitted
# so we never assert a wrong pattern. A domain here yields a *high-confidence*
# guess; anything else falls back to inference / the default below.
KNOWN_FIRM_PATTERNS = {
    "colliers.com":           "first.last",
    "ohioequities.com":       "flast",      # NAI Ohio Equities (NOT naiohioequities)
    "naimiami.com":           "flast",
    "avisonyoung.com":        "first.last",
    "streamrealty.com":       "first.last",
    "bridge-commercial.com":  "first.last",
    "piedmontproperties.com": "flast",
    "onesothebysrealty.com":  "flast",
    "americascre.com":        "first",
    "ascent.re":              "first",
    "vivogroup.net":          "flast",
    "ripcofl.com":            "flast",
    "ripcony.com":            "flast",
    "keyes.com":              "firstlast",
    "cpgmiami.com":           "first",
}

# When we know nothing about a firm, this is the single most common Southeast/
# Midwest small-brokerage shape in the confirmed set. The result is labelled a
# guess, so a wrong default is a lead to verify, never a false CRM write.
_DEFAULT_PATTERN = "flast"

# Local parts that are role/team inboxes, not a person — surfaced separately as
# the brokerage's general email, never treated as a broker's personal address.
_GENERIC_LOCALS = {
    "info", "sales", "contact", "admin", "hello", "office", "team", "marketing",
    "support", "leasing", "listings", "inquiries", "inquiry", "general", "mail",
    "main", "reception", "frontdesk", "hr", "careers", "webmaster", "noreply",
    "no-reply", "help", "service", "services", "properties", "property",
}

# Junk email domains that show up in page markup but aren't real contacts.
_JUNK_EMAIL_DOMAINS = {
    "sentry.io", "wixpress.com", "example.com", "domain.com", "email.com",
    "godaddy.com", "squarespace.com", "wix.com", "sentry-next.wixpress.com",
    "2x.png", "schema.org", "w3.org", "googleapis.com", "gstatic.com",
}

# ---------------------------------------------------------------------------
# Pure helpers (no network — unit-tested directly)
# ---------------------------------------------------------------------------

# Multi-label public suffixes we might realistically meet, so `co.uk` etc. don't
# collapse to "co.uk". US CRE is almost all 2-label .com/.net/.re, so this stays
# intentionally tiny.
_MULTI_TLDS = {"co.uk", "com.au", "co.nz", "com.br", "co.za"}


def registrable_domain(url: str | None) -> str | None:
    """Reduce any website URL/host to its registrable domain, lowercased.

    ``https://www.ohioequities.com/listings.html`` -> ``ohioequities.com``.
    Returns None when there is no host with a dot.
    """
    if not url:
        return None
    s = str(url).strip()
    if "//" not in s:
        s = "//" + s          # urlsplit needs a scheme or leading //
    host = urlsplit(s).netloc or urlsplit("//" + str(url)).path.split("/")[0]
    host = host.split("@")[-1].split(":")[0].strip().lower()
    if host.startswith("www."):
        host = host[4:]
    labels = host.split(".")
    if len(labels) < 2 or not all(labels):
        return None
    last2 = ".".join(labels[-2:])
    if last2 in _MULTI_TLDS and len(labels) >= 3:
        return ".".join(labels[-3:])
    return last2


_NAME_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


def _name_parts(full_name: str | None) -> tuple[str, str]:
    """Split a display name into lowercased, a-z-only (first, last), dropping
    generational suffixes and middle names. ("Dan Sheeran Jr" -> ("dan","sheeran"))."""
    if not full_name:
        return "", ""
    toks = [re.sub(r"[^a-z]", "", t.lower()) for t in str(full_name).split()]
    toks = [t for t in toks if t and t not in _NAME_SUFFIXES]
    if not toks:
        return "", ""
    if len(toks) == 1:
        return toks[0], ""
    return toks[0], toks[-1]


def derive_email(full_name: str | None, domain: str | None,
                 pattern: str = _DEFAULT_PATTERN) -> str | None:
    """Build a likely email from a name + domain + pattern key. Returns None if
    the name/domain/pattern can't produce a sensible local part."""
    first, last = _name_parts(full_name)
    if not domain or not first:
        return None
    func = _PATTERN_FUNCS.get(pattern)
    if func is None:
        return None
    # Patterns that need a surname can't run on a single-token name.
    if not last and pattern not in ("first", "last"):
        return None
    local = func(first, last)
    if not local:
        return None
    return f"{local}@{domain}"


_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
_MAILTO_RE = re.compile(r'mailto:([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})', re.I)
_TEL_RE = re.compile(r'tel:([+0-9().\-\s]{7,})', re.I)
# Visible-text phone. REQUIRES a separator (space/dot/dash/paren) between the
# groups so a bare 10-digit run (a tracking id, concatenated numbers) can't be
# mistaken for a phone — that false positive surfaced a "(900) 170-8350" office
# number in testing. tel: links are trusted without this constraint.
_PHONE_RE = re.compile(r"(?:\+?1[\s.\-]?)?\(?([2-9]\d{2})\)?[\s.\-]+(\d{3})[\s.\-]+(\d{4})")

# Premium-rate / service area codes that are never a brokerage office line.
_BAD_AREA_CODES = {"900", "976"}


def format_phone(raw: str | None) -> str | None:
    """Normalise any US phone string to ``(AAA) NNN-NNNN``; None if not a plausible
    10-digit US number (area code first digit 2-9, not a premium-rate code)."""
    if not raw:
        return None
    digits = re.sub(r"\D", "", str(raw))
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10 or digits[0] in "01" or digits[:3] in _BAD_AREA_CODES:
        return None
    return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"


def _is_junk_email(email: str) -> bool:
    dom = email.rsplit("@", 1)[-1].lower()
    if dom in _JUNK_EMAIL_DOMAINS:
        return True
    # image/asset filenames that the regex can catch ("logo@2x.png")
    return bool(re.search(r"\.(png|jpe?g|gif|svg|webp|css|js)$", email, re.I))


def extract_contacts(html: str) -> dict:
    """Pull phones + emails out of raw page HTML.

    Returns ``{"phones": [formatted...], "emails": [lowercased...]}`` — ``tel:``/
    ``mailto:`` links are trusted first, then visible-text regex as a fallback.
    De-duped, order-stable.
    """
    if not html:
        return {"phones": [], "emails": []}

    phones: list[str] = []
    seen_p: set[str] = set()

    def _add_phone(raw: str):
        p = format_phone(raw)
        if p and p not in seen_p:
            seen_p.add(p)
            phones.append(p)

    for m in _TEL_RE.finditer(html):
        _add_phone(m.group(1))
    for m in _PHONE_RE.finditer(html):
        _add_phone("".join(m.groups()))

    emails: list[str] = []
    seen_e: set[str] = set()

    def _add_email(raw: str):
        e = raw.strip().lower().rstrip(".")
        if e and e not in seen_e and not _is_junk_email(e):
            seen_e.add(e)
            emails.append(e)

    for m in _MAILTO_RE.finditer(html):
        _add_email(m.group(1))
    for m in _EMAIL_RE.finditer(html):
        _add_email(m.group(0))

    return {"phones": phones, "emails": emails}


def classify_emails(emails: list[str], domain: str) -> tuple[list[str], list[str]]:
    """Split same-domain emails into (personal, generic). Off-domain emails are
    ignored (they're usually vendors/partners, not this brokerage's people)."""
    personal, generic = [], []
    for e in emails:
        local, _, dom = e.partition("@")
        if dom != domain:
            continue
        (generic if local in _GENERIC_LOCALS else personal).append(e)
    return personal, generic


def infer_pattern(personal_emails: list[str], domain: str) -> str | None:
    """Best-effort pattern inference from personal emails the site publishes.
    Weak by design — it can only tell dotted (first.last) from undotted (flast) —
    so it's a fallback below KNOWN_FIRM_PATTERNS. Returns a pattern key or None."""
    locals_ = [e.split("@", 1)[0] for e in personal_emails if e.endswith("@" + domain)]
    locals_ = [l for l in locals_ if l not in _GENERIC_LOCALS]
    if not locals_:
        return None
    dotted = sum("." in l for l in locals_)
    return "first.last" if dotted >= max(1, len(locals_) - dotted) else "flast"


# ---------------------------------------------------------------------------
# Async enricher
# ---------------------------------------------------------------------------

class BrokerContactEnricher:
    """Fetches brokerage sites (once per domain per run) and turns a broker into a
    contact dict. Best-effort and side-effect-free: failures return ``{}``.

    Use as an async context manager so the httpx client is owned/closed here::

        async with BrokerContactEnricher() as enr:
            contact = await enr.enrich_broker(broker_dict)
    """

    def __init__(self, timeout: float = _TIMEOUT, max_pages: int = _MAX_PAGES,
                 stop_event=None):
        self._timeout = timeout
        self._max_pages = max_pages
        self._stop_event = stop_event
        self._client: httpx.AsyncClient | None = None
        # domain -> resolved site-contact dict (memoised across the run)
        self._cache: dict[str, dict] = {}
        # domain -> in-flight fetch, so N concurrent listings on the same firm
        # trigger exactly one fetch (single-flight).
        self._inflight: dict[str, asyncio.Future] = {}

    async def __aenter__(self):
        self._client = httpx.AsyncClient(
            timeout=self._timeout,
            follow_redirects=True,
            headers={"User-Agent": _UA, "Accept": "text/html,*/*"},
        )
        return self

    async def __aexit__(self, *_):
        if self._client:
            await self._client.aclose()

    def _should_stop(self) -> bool:
        return self._stop_event is not None and self._stop_event.is_set()

    async def _fetch_site(self, domain: str) -> dict:
        """Fetch a domain's root + likely contact pages, aggregate contacts."""
        phones: list[str] = []
        emails: list[str] = []
        pages_fetched = 0
        for path in _CONTACT_PATHS:
            if pages_fetched >= self._max_pages or self._should_stop():
                break
            url = f"https://{domain}/{path}".rstrip("/")
            try:
                r = await self._client.get(url)
                pages_fetched += 1
                if r.status_code >= 400:
                    continue
                found = extract_contacts(r.text)
            except Exception as exc:  # noqa: BLE001 — best-effort per page
                logger.debug("[broker_contact] fetch failed %s: %s", url, exc)
                continue
            for p in found["phones"]:
                if p not in phones:
                    phones.append(p)
            for e in found["emails"]:
                if e not in emails:
                    emails.append(e)
            personal, _ = classify_emails(emails, domain)
            # Stop early once we have both a phone and a personal email — no need
            # to keep pulling contact pages.
            if phones and personal:
                break

        personal, generic = classify_emails(emails, domain)
        return {
            "domain": domain,
            "office_phone": phones[0] if phones else None,
            "personal_emails": personal,
            "generic_emails": generic,
        }

    async def site_contact(self, website: str | None) -> dict:
        """Single-flight, memoised site fetch for a website's registrable domain."""
        domain = registrable_domain(website)
        if not domain or not self._client:
            return {}
        if domain in self._cache:
            return self._cache[domain]
        fut = self._inflight.get(domain)
        if fut is None:
            fut = asyncio.ensure_future(self._fetch_site(domain))
            self._inflight[domain] = fut
        try:
            result = await fut
        except Exception:  # noqa: BLE001
            result = {"domain": domain, "office_phone": None,
                      "personal_emails": [], "generic_emails": []}
        finally:
            self._inflight.pop(domain, None)
        self._cache[domain] = result
        return result

    async def enrich_broker(self, broker: dict) -> dict:
        """Given a Crexi broker dict (name + brokerage.website), return contact
        signals mined from the firm's website. Empty dict when there's no website
        or nothing could be resolved.

        Keys: ``office_phone``, ``email_verified`` (address that actually appears
        on the site), ``email_guess`` (pattern-derived; needs verification),
        ``brokerage_email`` (generic office inbox), ``domain``, ``pattern``.
        """
        brokerage = broker.get("brokerage") or {}
        website = brokerage.get("website")
        domain = registrable_domain(website)
        if not domain:
            return {}

        site = await self.site_contact(website)
        personal = site.get("personal_emails") or []
        generic = site.get("generic_emails") or []

        pattern = (
            KNOWN_FIRM_PATTERNS.get(domain)
            or infer_pattern(personal, domain)
            or _DEFAULT_PATTERN
        )
        name = " ".join(
            str(x) for x in (broker.get("firstName"), broker.get("lastName")) if x
        )
        guess = derive_email(name, domain, pattern)

        # Verified = the derived address is actually published on the firm's site.
        email_verified = None
        if guess and guess in personal:
            email_verified = guess

        return {
            "domain": domain,
            "pattern": pattern,
            "office_phone": site.get("office_phone"),
            "email_verified": email_verified,
            "email_guess": None if email_verified else guess,
            "brokerage_email": generic[0] if generic else None,
        }
