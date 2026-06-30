"""End-to-end smoke test for the outreach pipeline.

Runs a small mixed sample (owner + attorney leads) through enrich -> draft and
prints the coverage report plus a couple of sample drafts.

    cd backend
    ./.venv/bin/python -m scripts.smoke_outreach

Runs fully offline against stubs. To exercise the real paths, set any of:
    APOLLO_API_KEY, SKIPTRACE_API_KEY, ANTHROPIC_API_KEY
"""
from __future__ import annotations

import json

from outreach import OutreachLead, run_outreach, coverage_report
from outreach.models import CHANNEL_OWNER, CHANNEL_ATTORNEY


# A deliberately ragged sample — mirrors what real sourcing produces:
#   - business-like owners (Apollo should win)
#   - bare private owners behind LLCs (skip-trace territory)
#   - attorneys (Apollo's sweet spot)
SAMPLE_LEADS = [
    OutreachLead(
        name="David Reuben",
        company="Reuben Industrial Partners",
        domain="reubenindustrial.com",
        title="Managing Principal",
        property_address="4200 Logistics Pkwy, Columbus, OH",
        property_context="118,000 SF distribution, last sold 2014",
        channel=CHANNEL_OWNER,
        llc_name="4200 Logistics Holdings LLC",
        source_record="Franklin County assessor parcel 010-2241",
    ),
    OutreachLead(
        name="Marlene Otto",
        mailing_address="88 Pinehurst Ln, Cannon Falls, MN 55009",
        property_address="15 Industrial Dr, Cannon Falls, MN",
        property_context="92,000 SF warehouse, owner-occupied 22 yrs",
        channel=CHANNEL_OWNER,
        llc_name="Otto Family Holdings LLC",
        source_record="Goodhue County assessor parcel 52-119",
    ),
    OutreachLead(
        name="Priya Nair",
        company="Nair & Associates",
        domain="nairlaw.com",
        title="Partner, Real Estate",
        property_address="900 Commerce Ct, Nashville, TN",
        property_context="closing attorney on 2019 sale, 140,000 SF",
        channel=CHANNEL_ATTORNEY,
        source_record="Davidson County recorder deed bk 4821",
    ),
    OutreachLead(
        name="Gene Halvorsen",
        mailing_address="PO Box 1182, Waterloo, IA 50704",
        property_address="3300 Foundry Rd, Waterloo, IA",
        property_context="older manufacturing building, 175,000 SF",
        channel=CHANNEL_OWNER,
        llc_name="Halvorsen Real Estate LLC",
        source_record="Black Hawk County assessor parcel 8810",
    ),
    OutreachLead(
        name="Susan Briggs",
        company="Briggs Title & Closing",
        domain="briggstitle.com",
        title="Closing Attorney",
        property_address="50 Rail Yard Way, Memphis, TN",
        property_context="closing attorney on 2016 sale, 210,000 SF",
        channel=CHANNEL_ATTORNEY,
        source_record="Shelby County recorder deed bk 3390",
    ),
]


def main() -> None:
    results = run_outreach(SAMPLE_LEADS)
    report = coverage_report(results)

    print("=== COVERAGE REPORT ===")
    print(json.dumps(report, indent=2))
    if not report["providers_live"]:
        print("\n(! providers running as STUBS — set APOLLO_API_KEY / "
              "SKIPTRACE_API_KEY for real coverage numbers)")

    print("\n=== PER-LEAD ===")
    for r in results:
        e = r.enrichment
        print(
            f"- {r.lead.display_name():<22} [{r.lead.channel:<8}] "
            f"email={'Y' if e.has_email else '—'} via {e.source or '—':<9} "
            f"conf={e.confidence:.2f}"
        )

    print("\n=== SAMPLE DRAFTS (first 2 with email) ===")
    shown = 0
    for r in results:
        if not r.draft:
            continue
        print(f"\n--- to {r.lead.display_name()} ({r.lead.channel}) "
              f"via {r.enrichment.source}, model={r.draft.model_used} ---")
        print(f"Subject: {r.draft.subject}")
        print(r.draft.body)
        shown += 1
        if shown >= 2:
            break


if __name__ == "__main__":
    main()
