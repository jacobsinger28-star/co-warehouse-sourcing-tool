"""Orchestrate enrich -> draft over a batch of leads, and report coverage.

The coverage report is the point: it's the gating number for the whole project
(*what % of leads do we get an email for, and from which source?*). Run this on
a real sample before committing to Apollo, a skip-trace provider, or Reonomy.
"""
from __future__ import annotations

from collections import Counter
from typing import Iterable

from .models import OutreachLead, OutreachResult
from .enrich import EnrichmentWaterfall
from .draft import EmailDrafter


def run_outreach(
    leads: Iterable[OutreachLead],
    *,
    draft: bool = True,
    waterfall: EnrichmentWaterfall | None = None,
    drafter: EmailDrafter | None = None,
) -> list[OutreachResult]:
    waterfall = waterfall or EnrichmentWaterfall()
    drafter = drafter or EmailDrafter()

    results: list[OutreachResult] = []
    for lead in leads:
        enrichment = waterfall.enrich(lead)
        # Only spend a draft on leads we can actually reach.
        drafted = drafter.draft(lead, enrichment) if (draft and enrichment.has_email) else None
        results.append(OutreachResult(lead=lead, enrichment=enrichment, draft=drafted))
    return results


def coverage_report(results: list[OutreachResult]) -> dict:
    """Aggregate the gating metrics."""
    total = len(results)
    with_email = [r for r in results if r.enrichment.has_email]
    by_source = Counter(r.enrichment.source for r in with_email)
    by_channel = Counter(r.lead.channel for r in results)
    channel_hits = Counter(r.lead.channel for r in with_email)
    live = any(r.enrichment.live for r in results)

    return {
        "total_leads": total,
        "with_email": len(with_email),
        "coverage_pct": round(100 * len(with_email) / total, 1) if total else 0.0,
        "by_source": dict(by_source),  # seed / apollo / skiptrace
        "by_channel": {
            ch: {
                "leads": by_channel[ch],
                "with_email": channel_hits[ch],
                "coverage_pct": round(100 * channel_hits[ch] / by_channel[ch], 1)
                if by_channel[ch]
                else 0.0,
            }
            for ch in by_channel
        },
        "providers_live": live,  # False => numbers are from stubs, not real data
    }
