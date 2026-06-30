"""Contact enrichment — the Apollo -> skip-trace waterfall.

This is the value-determining step of the whole project (see SESSION_HANDOFF /
the data-sourcing decision). Two providers, two different strengths:

  * Apollo      — B2B database keyed on people-at-companies-with-a-web-presence.
                  Excellent for attorneys and professional/institutional owners.
                  Whiffs on private individuals behind anonymous holding LLCs.
  * Skip-trace  — consumer/property append (BatchData / PropStream / REISkip /
                  IDI). Takes name + mailing address -> personal email + cell.
                  Catches the long tail Apollo can't.

The waterfall tries the cheapest/best source first and falls back. Every
Enrichment records *which* source hit, so the coverage report can show the
mix — which is exactly the number that gates spending on either provider.

LIVE vs STUB
------------
Both clients run as deterministic stubs unless their API key is in the env:
  APOLLO_API_KEY        -> ApolloClient goes live
  SKIPTRACE_API_KEY     -> SkipTraceClient goes live
The stubs model real-world coverage shape (Apollo hits business-looking leads,
skip-trace hits address-bearing leads) so the pipeline and report are
exercisable today. Going live is a one-line swap inside `_match_live`.
"""
from __future__ import annotations

import hashlib
import os
from typing import Optional

from .models import OutreachLead, Enrichment


def _stable_unit(*parts: str) -> float:
    """Deterministic pseudo-random in [0,1) from the given strings.

    Lets the stubs make reproducible 'found / not found' calls without
    Math.random-style nondeterminism (so repeated runs match).
    """
    h = hashlib.sha1("|".join(p or "" for p in parts).encode()).hexdigest()
    return int(h[:8], 16) / 0xFFFFFFFF


def _slugify_email(name: str, domain: str) -> str:
    first, _, last = (name or "lead").strip().lower().partition(" ")
    last = last.replace(" ", "") or "x"
    return f"{first}.{last}@{domain}"


class ApolloClient:
    """Apollo People Enrichment.

    Real endpoint: POST https://api.apollo.io/api/v1/people/match
    Auth header:   X-Api-Key: <APOLLO_API_KEY>
    Best keys:     first_name + last_name + (domain or organization_name).
    """

    BASE_URL = "https://api.apollo.io/api/v1/people/match"

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("APOLLO_API_KEY")
        self.live = bool(self.api_key)

    def match(self, lead: OutreachLead) -> Optional[Enrichment]:
        if not lead.name and not lead.domain:
            return None  # Apollo needs at least a name or a company key
        if self.live:
            return self._match_live(lead)
        return self._match_stub(lead)

    # --- live ---------------------------------------------------------------
    def _match_live(self, lead: OutreachLead) -> Optional[Enrichment]:
        import requests  # already a project dependency

        first, _, last = (lead.name or "").partition(" ")
        payload = {
            "first_name": first or None,
            "last_name": last or None,
            "organization_name": lead.company or None,
            "domain": lead.domain or None,
            "email": lead.seed_email or None,
            # Apollo gates personal emails behind a flag + extra credits.
            "reveal_personal_emails": True,
        }
        try:
            resp = requests.post(
                self.BASE_URL,
                json={k: v for k, v in payload.items() if v is not None},
                headers={
                    "X-Api-Key": self.api_key,
                    "Content-Type": "application/json",
                    "Cache-Control": "no-cache",
                },
                timeout=20,
            )
            resp.raise_for_status()
            person = (resp.json() or {}).get("person") or {}
        except Exception:
            return None
        if not person:
            return None

        phones = person.get("phone_numbers") or []
        return Enrichment(
            email=person.get("email"),
            phone=(phones[0].get("raw_number") if phones else None),
            linkedin_url=person.get("linkedin_url"),
            source="apollo",
            confidence=0.8 if person.get("email") else 0.3,
            personal_context={
                "title": person.get("title"),
                "employment_history": person.get("employment_history"),
                "city": person.get("city"),
            },
            live=True,
        )

    # --- stub ---------------------------------------------------------------
    def _match_stub(self, lead: OutreachLead) -> Optional[Enrichment]:
        # Apollo's real strength: leads that look like business professionals
        # (have a company/domain/title). Model ~85% coverage there, ~15% for
        # bare-name private owners.
        business_like = bool(lead.domain or lead.company or lead.title)
        roll = _stable_unit("apollo", lead.name or "", lead.company or "")
        hit_rate = 0.85 if business_like else 0.15
        if roll > hit_rate:
            return None

        domain = lead.domain or (
            (lead.company or "firm").lower().replace(" ", "").replace(",", "")[:18] + ".com"
        )
        return Enrichment(
            email=_slugify_email(lead.name or "lead", domain),
            phone=None,
            linkedin_url=lead.linkedin_url
            or f"https://www.linkedin.com/in/{(lead.name or 'lead').lower().replace(' ', '-')}",
            source="apollo",
            confidence=0.75 if business_like else 0.4,
            personal_context={
                "title": lead.title,
                "note": "STUB — set APOLLO_API_KEY for real data",
            },
            live=False,
        )


class SkipTraceClient:
    """Property/consumer skip-trace append (BatchData-style).

    Real providers take name + mailing address -> personal email + cell.
    Stubbed until SKIPTRACE_API_KEY is set; `_trace_live` is where the real
    provider call goes.
    """

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("SKIPTRACE_API_KEY")
        self.live = bool(self.api_key)

    def trace(self, lead: OutreachLead) -> Optional[Enrichment]:
        if not lead.mailing_address and not lead.property_address:
            return None  # skip-trace is address-keyed
        if self.live:
            return self._trace_live(lead)
        return self._trace_stub(lead)

    def _trace_live(self, lead: OutreachLead) -> Optional[Enrichment]:
        # TODO: wire the chosen provider (BatchData / REISkip / IDI). Request
        # shape is name + parsed mailing address -> personal email + cell.
        raise NotImplementedError(
            "Set SKIPTRACE_API_KEY and implement the chosen provider call."
        )

    def _trace_stub(self, lead: OutreachLead) -> Optional[Enrichment]:
        # Skip-trace catches a chunk of the address-bearing long tail Apollo
        # missed — model ~55% coverage when we have an address.
        roll = _stable_unit("skiptrace", lead.name or lead.llc_name or "", lead.mailing_address or "")
        if roll > 0.55:
            return None
        handle = (lead.name or lead.llc_name or "owner").lower().split()[0]
        return Enrichment(
            email=f"{handle}{int(roll * 1000)}@gmail.com",
            phone=f"+1{int(roll * 9_000_000_000) + 1_000_000_000}",
            linkedin_url=None,
            source="skiptrace",
            confidence=0.5,
            personal_context={"note": "STUB — set SKIPTRACE_API_KEY for real data"},
            live=False,
        )


class EnrichmentWaterfall:
    """Try seed email -> Apollo -> skip-trace, return the first hit."""

    def __init__(
        self,
        apollo: Optional[ApolloClient] = None,
        skiptrace: Optional[SkipTraceClient] = None,
    ):
        self.apollo = apollo or ApolloClient()
        self.skiptrace = skiptrace or SkipTraceClient()

    def enrich(self, lead: OutreachLead) -> Enrichment:
        # 0. We already had an email on the way in.
        if lead.seed_email:
            return Enrichment(
                email=lead.seed_email,
                linkedin_url=lead.linkedin_url,
                source="seed",
                confidence=0.9,
                live=True,
            )
        # 1. Apollo (great for pros/attorneys).
        hit = self.apollo.match(lead)
        if hit and hit.has_email:
            return hit
        # 2. Skip-trace fallback (the private-owner long tail).
        traced = self.skiptrace.trace(lead)
        if traced and traced.has_email:
            return traced
        # 3. Nothing. Keep any non-email signal Apollo returned (LinkedIn, etc.).
        return hit or Enrichment(source=None, live=self.apollo.live)
