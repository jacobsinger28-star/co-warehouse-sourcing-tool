"""Dataclasses for the outreach pipeline.

Kept intentionally flat and JSON-serializable so these can later back an API
response / DB row without reshaping.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Optional


# Channels drive both enrichment strategy and email template.
CHANNEL_OWNER = "owner"        # principal behind a property-owning LLC
CHANNEL_ATTORNEY = "attorney"  # closing attorney on a past sale


@dataclass
class OutreachLead:
    """One contactable person tied to a target property.

    Most fields are optional because real-world inputs are ragged — a county
    record might give us only an LLC name + mailing address, while an attorney
    lead might give us a name + firm but no address.
    """
    # Who
    name: Optional[str] = None
    company: Optional[str] = None        # firm (attorney) or operating co. (owner)
    domain: Optional[str] = None         # company web domain — Apollo's best key
    title: Optional[str] = None
    linkedin_url: Optional[str] = None
    seed_email: Optional[str] = None     # email we already have, if any
    mailing_address: Optional[str] = None  # owner's mailing addr — skip-trace key

    # The property the outreach is *about* (drives personalization)
    property_address: Optional[str] = None
    property_context: Optional[str] = None  # free text: SF, asset type, last sale, etc.

    # Provenance / routing
    channel: str = CHANNEL_OWNER
    llc_name: Optional[str] = None       # owner-of-record LLC (owner channel)
    source_record: Optional[str] = None  # e.g. "Hamilton County assessor parcel 123"

    def display_name(self) -> str:
        return self.name or self.llc_name or self.company or "(unknown)"


@dataclass
class Enrichment:
    """What the waterfall found for a lead."""
    email: Optional[str] = None
    phone: Optional[str] = None
    linkedin_url: Optional[str] = None
    # Which step in the waterfall produced the email: "seed" | "apollo" |
    # "skiptrace" | None (nobody found one).
    source: Optional[str] = None
    # 0..1 rough confidence the contact is real / deliverable.
    confidence: float = 0.0
    # Personalization material (education, employment history, interests, ...).
    personal_context: dict = field(default_factory=dict)
    # Whether the providers ran live or as stubs (so reports don't overclaim).
    live: bool = False

    @property
    def has_email(self) -> bool:
        return bool(self.email)


@dataclass
class DraftedEmail:
    subject: str
    body: str
    hook: Optional[str] = None      # the one personal hook used, for QA
    model_used: str = "template"    # "claude-opus-4-8" when live, else "template"


@dataclass
class OutreachResult:
    lead: OutreachLead
    enrichment: Enrichment
    draft: Optional[DraftedEmail] = None

    def to_dict(self) -> dict:
        return {
            "lead": asdict(self.lead),
            "enrichment": asdict(self.enrichment),
            "draft": asdict(self.draft) if self.draft else None,
        }
