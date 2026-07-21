"""Crexi broker-contact capture + enrichment (scrapers/crexi.py + broker_contact.py).

Guards the fix for "the Crexi scrape got no phone or email": Crexi's /brokers API
carries NO email/phone field, but it DOES carry the state-license brokerage phone,
the brokerage website, office address and license — which the scraper now captures
— and scrapers.broker_contact backfills an office phone + a verified/guessed email
from the firm's own site. Network is mocked throughout.
"""
import asyncio
import unittest

from scrapers import broker_contact as bc
from scrapers import crexi as C


# A realistic two-broker payload shaped like api.crexi.com/assets/{id}/brokers:
# broker[0] has no license phone; broker[1] carries the brokerage license phone.
_BROKERS = [
    {
        "firstName": "Randy", "lastName": "Best", "id": 27160,
        "publicProfileId": "randybes", "licenses": ["311236"],
        "licenseDetails": [{"number": "311236", "licenseStateCode": "OH"}],
        "brokerage": {
            "name": "Best Corporate Real Estate",
            "website": "http://www.bestcorporaterealestate.com",
            "location": {"address": "4608 Sawmill Road", "city": "Columbus",
                         "state": {"code": "OH"}, "zip": "43220"},
        },
    },
    {
        "firstName": "Noah", "lastName": "Kahkonen", "id": 191635,
        "publicProfileId": "carolynbl", "licenses": ["2020001513"],
        "licenseDetails": [{"number": "2020001513", "licenseStateCode": "OH",
                            "brokerageLicensePhone": "614-559-3350"}],
        "brokerage": {
            "name": "Best Corporate Real Estate",
            "website": "http://www.bestcorporaterealestate.com",
            "location": {"address": "4608 Sawmill Road", "city": "Columbus",
                         "state": {"code": "OH"}, "zip": "43220"},
        },
    },
]

_ASSET = {"id": 2442929, "askingPrice": 3_000_000, "status": "Active",
          "types": ["industrial"], "name": "511 Industrial Mile Rd"}


def _enrich(brokers, *, enricher=None, search_sf=120000):
    """Run CrexiScraper._enrich_asset with mocked detail + broker fetches."""
    async def go():
        sc = C.CrexiScraper(enrich_websites=False)
        sc._client = object()             # bypass the httpx context manager
        sc._enricher = enricher           # None → API-only capture path

        async def fake_specs(_id):
            return {}

        async def fake_brokers(_id):
            return brokers

        sc._fetch_detail_specs = fake_specs
        sc._fetch_brokers = fake_brokers
        return await sc._enrich_asset(
            _ASSET, {"name": "Columbus"},
            "https://www.crexi.com/properties/2442929/x", "511 Industrial Mile Rd, Columbus, OH 43228",
            search_sf,
        )

    return asyncio.run(go())


class _FakeEnricher:
    """Stands in for BrokerContactEnricher — returns a fixed contact dict."""
    def __init__(self, contact):
        self._contact = contact

    async def enrich_broker(self, broker):
        return dict(self._contact)


# --------------------------------------------------------------------------- #
# broker_contact.py pure helpers
# --------------------------------------------------------------------------- #
class TestBrokerContactHelpers(unittest.TestCase):
    def test_registrable_domain(self):
        self.assertEqual(bc.registrable_domain("https://www.ohioequities.com/listings.html"),
                         "ohioequities.com")
        self.assertEqual(bc.registrable_domain("http://www.bestcorporaterealestate.com"),
                         "bestcorporaterealestate.com")
        self.assertEqual(bc.registrable_domain("limrealtygroup.com"), "limrealtygroup.com")
        self.assertIsNone(bc.registrable_domain(None))
        self.assertIsNone(bc.registrable_domain("notadomain"))

    def test_name_parts_drops_suffix(self):
        self.assertEqual(bc._name_parts("Dan Sheeran Jr"), ("dan", "sheeran"))
        self.assertEqual(bc._name_parts("Ryan McGreevy"), ("ryan", "mcgreevy"))
        self.assertEqual(bc._name_parts("Cher"), ("cher", ""))

    def test_derive_email_patterns(self):
        # NAI Ohio Equities confirmed pattern → finitial+last
        self.assertEqual(bc.derive_email("Dan Sheeran Jr", "ohioequities.com", "flast"),
                         "dsheeran@ohioequities.com")
        self.assertEqual(bc.derive_email("Alex Broker", "colliers.com", "first.last"),
                         "alex.broker@colliers.com")
        # single-token name can't fill a surname-bearing pattern
        self.assertIsNone(bc.derive_email("Cher", "x.com", "flast"))
        self.assertIsNone(bc.derive_email("Alex Broker", None, "flast"))

    def test_known_firm_pattern_applied(self):
        self.assertEqual(bc.KNOWN_FIRM_PATTERNS["ohioequities.com"], "flast")
        self.assertEqual(bc.KNOWN_FIRM_PATTERNS["colliers.com"], "first.last")

    def test_format_phone(self):
        self.assertEqual(bc.format_phone("1-614-559-3350"), "(614) 559-3350")
        self.assertEqual(bc.format_phone("+16144567365"), "(614) 456-7365")
        self.assertEqual(bc.format_phone("(800) 525-7452"), "(800) 525-7452")  # toll-free is real
        self.assertIsNone(bc.format_phone("123"))
        self.assertIsNone(bc.format_phone("011-559-3350"))  # bad area code
        self.assertIsNone(bc.format_phone("900-170-8350"))  # premium-rate area code
        self.assertIsNone(bc.format_phone(None))

    def test_bare_digit_run_is_not_a_phone(self):
        # a 10-digit tracking id with no separators must NOT be read as a phone,
        # but a real separated number on the same page still is
        got = bc.extract_contacts("id 9001708350 call 614.224.2400 today")
        self.assertEqual(got["phones"], ["(614) 224-2400"])

    def test_extract_contacts(self):
        html = ('<a href="tel:1-614-559-3350">call</a>'
                '<a href="mailto:info@lim.com">e</a> ryan.mcgreevy@ohioequities.com'
                ' logo@2x.png sentry@sentry.io')
        got = bc.extract_contacts(html)
        self.assertEqual(got["phones"], ["(614) 559-3350"])
        self.assertIn("info@lim.com", got["emails"])
        self.assertIn("ryan.mcgreevy@ohioequities.com", got["emails"])
        self.assertNotIn("logo@2x.png", got["emails"])       # asset filtered
        self.assertNotIn("sentry@sentry.io", got["emails"])  # junk domain filtered

    def test_classify_emails(self):
        personal, generic = bc.classify_emails(
            ["info@lim.com", "ryan.mcgreevy@lim.com", "off@other.com"], "lim.com")
        self.assertEqual(personal, ["ryan.mcgreevy@lim.com"])
        self.assertEqual(generic, ["info@lim.com"])           # off-domain dropped

    def test_infer_pattern(self):
        self.assertEqual(bc.infer_pattern(["ryan.mcgreevy@x.com", "d.smith@x.com"], "x.com"),
                         "first.last")
        self.assertEqual(bc.infer_pattern(["dmcgreevy@x.com"], "x.com"), "flast")
        self.assertIsNone(bc.infer_pattern([], "x.com"))


class TestEnrichBrokerVerification(unittest.TestCase):
    """The verified-vs-guess split — the core of the 'never write a bare guess to
    the CRM' rule."""

    def _run(self, broker, site_contact):
        async def go():
            enr = bc.BrokerContactEnricher()

            async def fake_site(_website):
                return site_contact

            enr.site_contact = fake_site
            return await enr.enrich_broker(broker)

        return asyncio.run(go())

    def test_guess_when_not_published(self):
        broker = {"firstName": "Dan", "lastName": "Sheeran",
                  "brokerage": {"website": "https://ohioequities.com"}}
        got = self._run(broker, {"domain": "ohioequities.com", "office_phone": "(614) 224-2400",
                                 "personal_emails": [], "generic_emails": ["info@ohioequities.com"]})
        self.assertIsNone(got["email_verified"])
        self.assertEqual(got["email_guess"], "dsheeran@ohioequities.com")
        self.assertEqual(got["office_phone"], "(614) 224-2400")
        self.assertEqual(got["brokerage_email"], "info@ohioequities.com")

    def test_verified_when_published(self):
        broker = {"firstName": "Dan", "lastName": "Sheeran",
                  "brokerage": {"website": "https://ohioequities.com"}}
        got = self._run(broker, {"domain": "ohioequities.com", "office_phone": None,
                                 "personal_emails": ["dsheeran@ohioequities.com"],
                                 "generic_emails": []})
        self.assertEqual(got["email_verified"], "dsheeran@ohioequities.com")
        self.assertIsNone(got["email_guess"])   # promoted, so not also a guess

    def test_no_website_returns_empty(self):
        got = self._run({"firstName": "Dan", "lastName": "Sheeran", "brokerage": {}}, {})
        self.assertEqual(got, {})


# --------------------------------------------------------------------------- #
# crexi.py capture path
# --------------------------------------------------------------------------- #
class TestCrexiHelpers(unittest.TestCase):
    def test_license_phone_scans_all_brokers(self):
        # phone is on the SECOND broker; must still be found
        self.assertEqual(C._license_phone(_BROKERS), "(614) 559-3350")
        self.assertIsNone(C._license_phone([_BROKERS[0]]))

    def test_primary_license(self):
        self.assertEqual(C._primary_license(_BROKERS[0]), ("311236", "OH"))

    def test_office_address(self):
        self.assertEqual(C._brokerage_office_address(_BROKERS[0]["brokerage"]),
                         "4608 Sawmill Road, Columbus, OH 43220")


class TestCrexiEnrichAsset(unittest.TestCase):
    def test_api_only_capture(self):
        """Without website enrichment, we still capture license phone + website +
        office + license from the API payload — where before we got nothing."""
        row = _enrich(_BROKERS, enricher=None)
        self.assertEqual(row["broker_name"], "Randy Best")
        self.assertEqual(row["broker_phone"], "(614) 559-3350")   # from state license
        self.assertIsNone(row["broker_email"])                    # gated → None
        rd = row["raw_data"]
        self.assertEqual(rd["broker_brokerage_website"], "http://www.bestcorporaterealestate.com")
        self.assertEqual(rd["broker_office_address"], "4608 Sawmill Road, Columbus, OH 43220")
        self.assertEqual(rd["broker_license"], "311236")
        self.assertEqual(rd["broker_license_state"], "OH")
        self.assertEqual(rd["broker_profile_url"], "https://www.crexi.com/profile/randybes")
        self.assertEqual(rd["all_broker_names"], ["Randy Best", "Noah Kahkonen"])
        self.assertEqual(len(rd["all_brokers"]), 2)
        self.assertIsNone(rd["broker_email_guess"])               # enricher off

    def test_website_office_phone_backfills_when_no_license_phone(self):
        """No license phone on the listing → the firm-site office phone fills in."""
        enr = _FakeEnricher({"office_phone": "(614) 224-2400", "email_verified": None,
                             "email_guess": "rbest@x.com", "pattern": "flast",
                             "brokerage_email": "info@x.com"})
        row = _enrich([_BROKERS[0]], enricher=enr)     # broker[0] has no license phone
        self.assertEqual(row["broker_phone"], "(614) 224-2400")
        self.assertIsNone(row["broker_email"])
        self.assertEqual(row["raw_data"]["broker_email_guess"], "rbest@x.com")
        self.assertEqual(row["raw_data"]["broker_office_phone"], "(614) 224-2400")

    def test_license_phone_preferred_over_website(self):
        """When both exist, the state-license line wins (authoritative)."""
        enr = _FakeEnricher({"office_phone": "(999) 999-9999", "email_verified": "r@x.com",
                             "email_guess": None, "pattern": "flast", "brokerage_email": None})
        row = _enrich(_BROKERS, enricher=enr)
        self.assertEqual(row["broker_phone"], "(614) 559-3350")   # license, not website
        self.assertEqual(row["broker_email"], "r@x.com")          # verified → surfaced


if __name__ == "__main__":
    unittest.main()
