"""Owner / attorney cold-outreach layer.

This package is deliberately decoupled from the brokerage-listing scrapers
(`scrapers/`). It takes a *lead* — an owner principal, an attorney, or any
contactable person tied to a target property — and runs it through:

    enrich (Apollo -> skip-trace waterfall)  ->  draft (Claude)  ->  result

The point of v0 is to answer the project's gating question with our own tools:
*what % of leads can we actually get an email for, and by which source?*

Both enrichment providers run as deterministic STUBS until their API keys are
present in the environment (`APOLLO_API_KEY`, skip-trace key). Swapping to live
is a one-line change — see `enrich.py`. Drafting falls back to a template when
`ANTHROPIC_API_KEY` is absent, so the whole pipeline runs offline.
"""

from .models import OutreachLead, Enrichment, DraftedEmail, OutreachResult
from .pipeline import run_outreach, coverage_report

__all__ = [
    "OutreachLead",
    "Enrichment",
    "DraftedEmail",
    "OutreachResult",
    "run_outreach",
    "coverage_report",
]
