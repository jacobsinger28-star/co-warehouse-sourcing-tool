#!/usr/bin/env python3
"""
call_provider.py — vendor-agnostic AI-calling adapter (the dialer is still being chosen).

The outreach loop should not care *which* AI calling product places the call. This module
defines the narrow contract any of Bland.ai / Vapi / Retell / Synthflow (etc.) can satisfy,
plus a real, no-key `stub` provider so the whole pipeline — placing calls, ingesting
results, syncing to the CRM — runs and is testable TODAY, before a vendor is picked.

Adding a real vendor later = one new CallProvider subclass + a row in PROVIDERS. Nothing
upstream (place_calls.py) or downstream (call_results.py, pipedrive_sync.py) changes.

Two normalization jobs live here so each vendor adapter stays tiny:
  * CallTask / CallOutcome — the shared shapes crossing the boundary in/out.
  * normalize_disposition() — every vendor invents its own outcome vocabulary
    ("completed", "no-answer", "machine", "transferred"...); we map to the canonical
    outreach_log.disposition set ONCE here.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from datetime import date
from typing import Optional

# Canonical dispositions — the only values that may land in outreach_log.disposition.
# (Mirrors the enum comment in db/migrations/001_schema.sql.)
DISPOSITIONS = (
    "pending", "no_answer", "voicemail", "wrong_number",
    "not_interested", "conversation", "meeting_set", "do_not_contact",
)
# Dispositions that mean "a human should follow up now" (drives the warm-lead task + queue).
WARM = frozenset({"conversation", "meeting_set"})

# Vendor outcome string -> canonical. Order matters: most specific first. Matched as a
# substring against a lower-cased vendor label, so "answering-machine" -> voicemail, etc.
_DISPOSITION_PATTERNS: tuple[tuple[str, str], ...] = (
    ("do_not_call", "do_not_contact"), ("do-not-call", "do_not_contact"),
    ("do not call", "do_not_contact"), ("do_not_contact", "do_not_contact"),
    ("dnc", "do_not_contact"), ("remove", "do_not_contact"),
    ("meeting", "meeting_set"), ("appointment", "meeting_set"),
    ("booked", "meeting_set"), ("scheduled", "meeting_set"), ("transfer", "meeting_set"),
    ("not_interested", "not_interested"), ("not interested", "not_interested"),
    ("declined", "not_interested"), ("rejected", "not_interested"),
    ("wrong", "wrong_number"), ("disconnected", "wrong_number"), ("invalid", "wrong_number"),
    ("voicemail", "voicemail"), ("machine", "voicemail"), ("vm", "voicemail"),
    ("no_answer", "no_answer"), ("no-answer", "no_answer"), ("noanswer", "no_answer"),
    ("busy", "no_answer"), ("failed", "no_answer"), ("missed", "no_answer"),
    # generic "we talked" signals — keep LAST so a more specific outcome wins first.
    ("completed", "conversation"), ("answered", "conversation"),
    ("conversation", "conversation"), ("human", "conversation"), ("success", "conversation"),
)


def normalize_disposition(raw: Optional[str]) -> str:
    """Map a vendor's free-form outcome label to a canonical disposition.

    Unknown / empty -> 'pending' (never guess a worse-than-true outcome; an unmatched
    label is surfaced, not silently dropped, by the caller storing raw_disposition too).
    """
    if not raw:
        return "pending"
    label = raw.strip().lower()
    if label in DISPOSITIONS:
        return label
    for needle, canonical in _DISPOSITION_PATTERNS:
        if needle in label:
            return canonical
    return "pending"


@dataclass
class CallTask:
    """Everything a provider needs to place one call and everything we need to log it."""
    contact_id: int
    entity_id: int
    apn: str
    to_number: str                       # 10-digit (or E.164); provider formats as needed
    owner_name: str                      # entity on title
    person_name: Optional[str]           # resolved human we expect to reach
    script: dict = field(default_factory=dict)   # built by place_calls.build_script()


@dataclass
class CallOutcome:
    """A normalized call result, ready to upsert into outreach_log."""
    provider_call_id: str
    disposition: str                     # canonical (normalize_disposition output)
    raw_disposition: Optional[str] = None
    transcript: Optional[str] = None
    recording_url: Optional[str] = None
    duration_seconds: Optional[int] = None
    occurred_on: Optional[date] = None
    # Best-effort identity carried back so result-ingest can match even if the vendor
    # drops our metadata: at least one of these or provider_call_id must resolve a row.
    contact_id: Optional[int] = None
    apn: Optional[str] = None


class CallProvider:
    """Interface every dialer adapter implements. Subclass + register in PROVIDERS."""

    name = "base"
    configured = False                   # True once the vendor's API key/env is present

    def start_call(self, task: CallTask) -> str:
        """Place the call; return the vendor's call id (stored as provider_call_id)."""
        raise NotImplementedError

    def parse_result(self, payload: dict) -> CallOutcome:
        """Normalize one vendor webhook/poll payload into a CallOutcome."""
        raise NotImplementedError


class StubProvider(CallProvider):
    """No-network provider. Used until a real vendor is wired up.

    start_call() does NOT dial — it returns a deterministic synthetic id so place_calls
    can exercise the full path (build script -> "place" -> log a pending row) and tests
    can round-trip a result without any account. parse_result() understands the synthetic
    payload shape that tests/fixtures emit.
    """

    name = "stub"
    configured = True                    # always "available" — it's the safe default

    def start_call(self, task: CallTask) -> str:
        return f"stub-{task.apn}-{task.contact_id}"

    def parse_result(self, payload: dict) -> CallOutcome:
        raw = payload.get("disposition") or payload.get("status")
        return CallOutcome(
            provider_call_id=str(payload.get("call_id") or payload.get("id") or ""),
            disposition=normalize_disposition(raw),
            raw_disposition=raw,
            transcript=payload.get("transcript"),
            recording_url=payload.get("recording_url"),
            duration_seconds=_as_int(payload.get("duration_seconds")),
            contact_id=_as_int(payload.get("contact_id")),
            apn=payload.get("apn"),
        )


def _as_int(v) -> Optional[int]:
    try:
        return int(v) if v is not None and str(v).strip() != "" else None
    except (TypeError, ValueError):
        return None


# Registry. A real adapter (e.g. BlandProvider) is added here once chosen; selecting it is
# a single env var, CALL_PROVIDER, with the stub as the always-safe default.
PROVIDERS: dict[str, type[CallProvider]] = {
    "stub": StubProvider,
}


def get_provider(name: Optional[str] = None) -> CallProvider:
    """Resolve the active provider from CALL_PROVIDER (default 'stub').

    If the named vendor is registered but not configured (missing API key), we fall back
    to the stub with a loud notice rather than dialing nothing or crashing — same honest
    posture as the imagery/Airtable stubs.
    """
    name = (name or os.environ.get("CALL_PROVIDER") or "stub").strip().lower()
    cls = PROVIDERS.get(name)
    if cls is None:
        print(f"  !! unknown CALL_PROVIDER '{name}' (have: {sorted(PROVIDERS)}) — using stub")
        cls = StubProvider
    prov = cls()
    if not prov.configured:
        print(f"  !! provider '{name}' is registered but not configured (missing API key) "
              f"— falling back to stub (no real calls placed)")
        return StubProvider()
    return prov
