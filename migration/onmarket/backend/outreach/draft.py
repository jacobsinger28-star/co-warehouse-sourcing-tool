"""Cold-email drafting via the Claude API, with an offline template fallback.

Brief (from the Aaron/Jacob call):
  * 3-5 sentences, plain text.
  * ENGAGEMENT, not an offer — gauge willingness to sell. No price in v1.
  * One personal/professional hook when we have the material, else lean on
    the property itself.
  * Different framing for owner vs. attorney channel.

If ANTHROPIC_API_KEY is set we draft with claude-opus-4-8; otherwise we emit a
deterministic template so the pipeline runs end-to-end offline.
"""
from __future__ import annotations

import os
from typing import Optional

from .models import OutreachLead, Enrichment, DraftedEmail, CHANNEL_ATTORNEY

MODEL = "claude-opus-4-8"

_SYSTEM = """You write short, human cold-outreach emails for an industrial \
real-estate acquisitions team. Rules, always:
- 3 to 5 sentences. Plain text. No subject line in the body.
- This first touch is ENGAGEMENT ONLY: gauge whether they'd consider selling. \
Never state a price, offer, or LOI.
- Warm and specific, not salesy. No emoji, no buzzwords, no "I hope this finds \
you well".
- Use at most ONE personal/professional hook, and only if it is provided and \
genuine. If none is provided, anchor on the specific property instead.
- Sound like one person emailing another, signed "— Kory".
Return ONLY the email body."""


def _hook_from(enrichment: Enrichment, lead: OutreachLead) -> Optional[str]:
    ctx = enrichment.personal_context or {}
    if ctx.get("employment_history"):
        return "professional background"
    if lead.title:
        return f"role as {lead.title}"
    return None


class EmailDrafter:
    def __init__(self, api_key: Optional[str] = None, model: str = MODEL):
        self.api_key = api_key or os.getenv("ANTHROPIC_API_KEY")
        self.model = model
        self.live = bool(self.api_key)

    def draft(self, lead: OutreachLead, enrichment: Enrichment) -> DraftedEmail:
        if self.live:
            drafted = self._draft_live(lead, enrichment)
            if drafted:
                return drafted
        return self._draft_template(lead, enrichment)

    # --- live ---------------------------------------------------------------
    def _draft_live(self, lead: OutreachLead, enrichment: Enrichment) -> Optional[DraftedEmail]:
        try:
            import anthropic
        except ImportError:
            return None

        is_attorney = lead.channel == CHANNEL_ATTORNEY
        who = lead.display_name()
        ctx = enrichment.personal_context or {}
        user = f"""Draft the email.

Channel: {"closing attorney on a past sale of this property" if is_attorney else "owner / principal behind the property"}
Recipient: {who}{f", {lead.title}" if lead.title else ""}{f" at {lead.company}" if lead.company else ""}
Property: {lead.property_address or "(address withheld)"}
Property context: {lead.property_context or "industrial / warehouse asset"}
Personal context (use at most one hook, only if genuine): {ctx or "none available"}
{"Angle: the attorney handled a past sale here and may know the owner's current appetite." if is_attorney else "Angle: we buy and hold industrial; ask if they'd ever consider selling."}"""

        try:
            client = anthropic.Anthropic(api_key=self.api_key)
            resp = client.messages.create(
                model=self.model,
                max_tokens=1024,
                thinking={"type": "adaptive"},
                output_config={"effort": "medium"},
                system=_SYSTEM,
                messages=[{"role": "user", "content": user}],
            )
        except Exception:
            return None

        body = "".join(b.text for b in resp.content if b.type == "text").strip()
        if not body:
            return None
        subject = self._subject(lead)
        return DraftedEmail(
            subject=subject,
            body=body,
            hook=_hook_from(enrichment, lead),
            model_used=self.model,
        )

    # --- template fallback --------------------------------------------------
    def _draft_template(self, lead: OutreachLead, enrichment: Enrichment) -> DraftedEmail:
        who = (lead.name or "there").split(" ")[0]
        prop = lead.property_address or "your industrial property"
        if lead.channel == CHANNEL_ATTORNEY:
            body = (
                f"Hi {who}, I'm reaching out because you handled the sale of {prop} "
                f"a while back. We're an industrial acquisitions group still active "
                f"in that market and would love your read on whether the current "
                f"owner might ever consider selling. No agenda beyond a quick "
                f"conversation if it's useful. Worth a short call?\n\n— Kory"
            )
        else:
            body = (
                f"Hi {who}, I came across {prop} and wanted to reach out directly. "
                f"We're a group that buys and holds industrial assets long-term, and "
                f"we're always interested in connecting with owners who might consider "
                f"selling down the road. No pressure at all — just gauging whether "
                f"that's a conversation you'd ever be open to. Mind if I follow up?\n\n— Kory"
            )
        return DraftedEmail(
            subject=self._subject(lead),
            body=body,
            hook=_hook_from(enrichment, lead),
            model_used="template",
        )

    @staticmethod
    def _subject(lead: OutreachLead) -> str:
        if lead.property_address:
            return f"Quick question about {lead.property_address}"
        return "Quick question about your property"
