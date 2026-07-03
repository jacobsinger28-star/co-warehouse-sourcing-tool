"""Pull a broker (and the deals they mention) out of a raw email.

Live path uses Claude (mirrors general-scraping/backend/outreach/draft.py: same
SDK, same claude-opus-4-8, same ANTHROPIC_API_KEY env var). If no key is set we
fall back to a deterministic regex pass so the pipeline runs end-to-end offline
for testing — same philosophy as draft.py's template fallback.

Returns a Broker dataclass ready for pipedrive_sync.upsert_broker().
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

MODEL = "claude-opus-4-8"

# Where we look for ANTHROPIC_API_KEY if it isn't already an env var: a local
# gitignored .env here, then the general-scraping backend .env. You put the key
# in one of these once; the watcher and CLI both read it. Never commit it.
_ENV_FILES = [Path(__file__).resolve().parent / ".env"]
try:  # local dev fallback — the sibling general-scraping repo; absent on Railway
    _ENV_FILES.append(
        Path(__file__).resolve().parents[2].parent / "general-scraping" / "backend" / ".env")
except IndexError:
    pass


def _env(name: str) -> Optional[str]:
    v = os.getenv(name)
    if v:
        return v
    for f in _ENV_FILES:
        try:
            if f.exists():
                for line in f.read_text().splitlines():
                    line = line.strip()
                    if line.startswith(f"{name}="):
                        return line.split("=", 1)[1].strip().strip('"').strip("'")
        except OSError:
            pass
    return None

_SYSTEM = """You extract a commercial real estate BROKER (or deal intermediary) \
and the deals they mention out of a forwarded email. The email is often a messy \
off-market "deal sheet". Return ONLY JSON, no prose, matching exactly:

{
  "name": string|null,            // the broker/sender's full name
  "company": string|null,         // their firm / entity (e.g. "JMS Premier Builder's")
  "email": string|null,           // their best contact email
  "phone": string|null,           // office/work number if given
  "cell": string|null,            // mobile/cell if given
  "title": string|null,           // e.g. "broker", "developer", null if unknown
  "markets": [string],            // cities/markets the deals are in
  "deals": [ {"summary": string, "address": string|null, "price": string|null} ],
  "context": string|null          // 1 short line describing who they are / the deal flow
}

Rules: never invent a phone/email that isn't in the text. If a field is unknown, \
use null (or [] for lists). Prefer the sender's own signature for contact info."""

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
# Forwarded-message headers — the real broker is the ORIGINAL sender inside a
# forward, not whoever forwarded it. "From: Name <email>" (Outlook) and
# "On <date>, Name <email> wrote:" (reply-style).
_FWD_FROM_RE = re.compile(
    r"From:\s*([^<\n]+?)\s*<([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})>", re.I)
_FWD_WROTE_RE = re.compile(
    r"On\b.{0,80}?<([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})>\s*wrote:", re.I)
# US phone. Separators allow spaces AND dashes/dots together, so spaced forms
# like "(347) 472 - 9085" match, not just "(347) 472-9085".
_PHONE_RE = re.compile(
    r"(?:\+?1[\s.\-]{0,2})?(?:\(\d{3}\)|\d{3})[\s.\-]{0,3}\d{3}[\s.\-]{0,3}\d{4}"
)


@dataclass
class Broker:
    name: Optional[str] = None
    company: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    cell: Optional[str] = None
    title: Optional[str] = None
    markets: list[str] = field(default_factory=list)
    deals: list[dict] = field(default_factory=list)
    context: Optional[str] = None
    source_email: str = ""            # full forwarded email, saved as a note
    extractor: str = "regex"          # "claude" or "regex"

    def as_dict(self) -> dict:
        return asdict(self)

    def is_actionable(self) -> bool:
        # Enough to create/dedupe a Pipedrive person.
        return bool(self.email or self.phone or self.cell or self.name)


class BrokerExtractor:
    def __init__(self, api_key: Optional[str] = None, model: str = MODEL):
        self.api_key = api_key or _env("ANTHROPIC_API_KEY")
        self.model = model
        self.live = bool(self.api_key)

    def extract(self, *, subject: str = "", body: str = "",
                from_name: str = "", from_email: str = "") -> Broker:
        b = None
        if self.live:
            b = self._extract_live(subject, body, from_name, from_email)
            if not (b and b.is_actionable()):
                b = None
        if b is None:
            b = self._extract_regex(subject, body, from_name, from_email)
        b.source_email = f"{subject}\n\n{body}".strip()[:5000]   # saved as the note
        return b

    # --- live (Claude) -----------------------------------------------------
    def _extract_live(self, subject, body, from_name, from_email) -> Optional[Broker]:
        try:
            import anthropic
        except ImportError:
            return None
        user = (
            f"From: {from_name} <{from_email}>\n"
            f"Subject: {subject}\n\n"
            f"{body}\n\n---\nExtract the broker + deals as JSON."
        )
        try:
            client = anthropic.Anthropic(api_key=self.api_key)
            resp = client.messages.create(
                model=self.model,
                max_tokens=1500,
                thinking={"type": "adaptive"},
                output_config={"effort": "low"},
                system=_SYSTEM,
                messages=[{"role": "user", "content": user}],
            )
        except Exception:
            return None
        text = "".join(b.text for b in resp.content if b.type == "text").strip()
        data = _first_json(text)
        if not data:
            return None
        b = Broker(
            name=data.get("name") or from_name or None,
            company=data.get("company"),
            email=data.get("email") or (from_email or None),
            phone=data.get("phone"),
            cell=data.get("cell"),
            title=data.get("title"),
            markets=list(data.get("markets") or []),
            deals=list(data.get("deals") or []),
            context=data.get("context"),
            extractor="claude",
        )
        return b

    # --- fallback (regex) --------------------------------------------------
    def _extract_regex(self, subject, body, from_name, from_email) -> Broker:
        text = f"{subject}\n{body}"
        # If this is a forward, the broker is the original sender in the body,
        # not the forwarder. Prefer an external-domain original sender.
        orig_name, orig_email = _original_sender(body, from_email)
        eff_name = orig_name or from_name
        eff_email = orig_email or from_email
        emails = [e for e in _EMAIL_RE.findall(text) if not e.lower().endswith(("png", "jpg", "gif"))]
        phones = _dedupe_phones(_PHONE_RE.findall(text))
        email = eff_email or (emails[0] if emails else None)
        cell = phones[0] if phones else None
        phone = phones[1] if len(phones) > 1 else None
        company = _guess_company(text, email)
        return Broker(
            name=eff_name or _guess_name(text) or None,
            company=company,
            email=email,
            phone=phone,
            cell=cell,
            markets=_guess_markets(text),
            deals=[],
            context="(regex fallback — set ANTHROPIC_API_KEY for full extraction)",
            extractor="regex",
        )


def _first_json(text: str) -> Optional[dict]:
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.M).strip()
    try:
        return json.loads(text)
    except Exception:
        m = re.search(r"\{.*\}", text, re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                return None
    return None


def _original_sender(body: str, forwarder_email: Optional[str]):
    """From a forwarded/replied body, return the (name, email) of the ORIGINAL
    sender — the first forwarded 'From:' whose address isn't the forwarder's.
    Prefers a sender on a different domain (an outside broker)."""
    fwd = (forwarder_email or "").lower()
    fdom = fwd.split("@")[-1] if "@" in fwd else ""
    cands: list[tuple[str, str]] = []
    for name, email in _FWD_FROM_RE.findall(body or ""):
        e = email.strip().lower()
        if e and e != fwd:
            cands.append((name.strip(), email.strip()))
    for email in _FWD_WROTE_RE.findall(body or ""):
        e = email.strip().lower()
        if e and e != fwd and not any(c[1].lower() == e for c in cands):
            cands.append(("", email.strip()))
    if not cands:
        return None, None
    for name, email in cands:                       # prefer an external sender
        if email.split("@")[-1].lower() != fdom:
            return (name or None), email
    return (cands[0][0] or None), cands[0][1]


def _dedupe_phones(raw: list[str]) -> list[str]:
    out, seen = [], set()
    for p in raw:
        digits = re.sub(r"\D", "", p)
        if len(digits) == 11 and digits.startswith("1"):
            digits = digits[1:]
        if len(digits) != 10 or digits in seen:
            continue
        seen.add(digits)
        out.append(f"({digits[:3]}) {digits[3:6]}-{digits[6:]}")
    return out


def _guess_company(text: str, email: Optional[str]) -> Optional[str]:
    m = re.search(r"\b([A-Z][A-Za-z&.,'\- ]{2,40}(?:LLC|Inc|Group|Realty|Builders|Partners|Capital|Advisors|Company|Co\.?))\b", text)
    if m:
        return m.group(1).strip(" ,.")
    if email and "@" in email:
        dom = email.split("@", 1)[1].split(".")[0]
        if dom not in ("gmail", "yahoo", "outlook", "hotmail", "icloud", "aol"):
            return dom.replace("-", " ").title()
    return None


def _guess_name(text: str) -> Optional[str]:
    for line in reversed([l.strip() for l in text.splitlines() if l.strip()][-8:]):
        m = re.match(r"^([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)$", line)
        if m:
            return m.group(1)
    return None


_MARKET_HINTS = [
    "Cape Coral", "North Miami Beach", "North Miami", "Miami Beach", "Miami",
    "West Palm Beach", "Fort Lauderdale", "Tampa", "Orlando", "Naples",
    "Fort Myers", "Boca Raton", "Jacksonville",
]


def _guess_markets(text: str) -> list[str]:
    out = []
    for m in _MARKET_HINTS:
        if re.search(rf"\b{re.escape(m)}\b", text, re.I) and m not in out:
            out.append(m)
    return out


# --------------------------- deals (the #track flow) ---------------------------
@dataclass
class Deal:
    title: str
    value: Optional[float] = None
    note: str = ""
    markets: list = field(default_factory=list)


_PRICE_RE = re.compile(r"\$\s*([\d,]+(?:\.\d+)?)\s*(mm|m|million|k)?\b", re.I)


def extract_deal(subject: str = "", body: str = "", from_name: str = "", from_email: str = "") -> Deal:
    """Turn a forwarded email into a trackable Deal: a title (the subject, stripped
    of Fw:/Re:/#track, else the first real body line), the first dollar value, and
    the whole email saved as the note. Deterministic — runs anywhere, no Claude."""
    t = re.sub(r"(?i)^\s*(fw|fwd|re)\s*:\s*", "", subject or "").strip()
    t = re.sub(r"(?i)#?track\b", "", t).strip(" -–|")
    if not t or len(t) < 3:
        for line in (body or "").splitlines():
            line = line.strip()
            if len(line) > 8 and not re.match(r"(?i)^(from|sent|to|subject|on)\b", line):
                t = line[:90]
                break
    t = t or "Tracked deal"
    value = None
    m = _PRICE_RE.search(body or "")
    if m:
        n = float(m.group(1).replace(",", ""))
        suf = (m.group(2) or "").lower()
        if suf in ("m", "mm", "million"):
            n *= 1_000_000
        elif suf == "k":
            n *= 1_000
        value = n
    note = f"{subject}\n\n{body}".strip()[:5000]
    return Deal(title=t, value=value, note=note, markets=_guess_markets(f"{subject}\n{body}"))
