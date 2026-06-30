# Deals Database + Chatbot — Architecture & Rollout

> Design doc. Operator-level, tradeoff-first. Last updated June 16, 2026.
> Personal/internal — keep out of anything team-facing until reviewed.

## Purpose

One place to ask "have we seen this deal before, and what happened." Today that knowledge is
split across LOI PDFs in people's folders, Pipedrive records, and individual memory. The cost of
that: we re-contact owners we already passed on, we can't answer "what did we offer on X in 2022,"
and a departing teammate takes deal history with them.

## Design principle: one canonical store, two consumers

Build the deal record **once**. Two things read it:

```
                       ┌──────────────────────┐
  LOI docs ───────────►│                      │──► Chatbot  ("what did we offer on Park Ave?")
  Pipedrive records ──►│  Canonical deal store │
  (later) enrichment ─►│                      │──► Dedupe spine (F4)  previously_contacted(owner,addr)
                       └──────────────────────┘
```

The chatbot answers humans in plain English. The dedupe spine is a structured lookup the sourcing
engine calls before any outreach. Same underlying records, two access modes. Designing them
together now avoids two overlapping deal stores later.

**Tradeoff:** this is slightly more upfront thinking than a chatbot-only corpus. The payoff is that
the F4 dedupe spine in the internship plan falls out of the same data, instead of being a second
build.

## Rollout — three stages, each shippable on its own

### Stage 0 — Consolidation (the actual unlock, not optional)

Get every past deal + LOI into one place, in a consistent shape. See
[`../claude-project/deal-archive-spec.md`](../claude-project/deal-archive-spec.md). Nothing
downstream is better than this input. **This is the gating dependency**, and it's worth doing even
if we never build the bot.

- **Cost:** labor only. Storage already exists (shared drive / Pipedrive).
- **Blocker:** *where does the LOI history actually live today?* (see Open Questions).

### Stage 1 — Claude Project (this week, zero code)

A Claude Project loaded with the consolidated archive + the system prompt in
[`../claude-project/INSTRUCTIONS.md`](../claude-project/INSTRUCTIONS.md). Andrew can try it the day
the docs are in one place.

- **Gets right:** proves value immediately, no infra, no spend beyond the Claude seat we already
  pay for, reversible.
- **Costs / limits:** bounded by Claude Project knowledge size; no live Pipedrive sync (you re-upload
  a fresh export periodically); retrieval is good-not-great vs. a real RAG; one shared project, not
  per-user auth.
- **Wrong for:** large archives (hundreds of deals with long docs) or daily-changing data.

### Stage 2 — Private `/ask` web page (only if Andrew wants it)

A single login-protected page only Simi people can reach. Same corpus, nicer surface, can be
embedded/linked. Build only on demand.

- **Cost:** Vercel (already budgeted ~$20/mo) + Claude API usage.
- **Gets right:** per-user access, shareable link, no "open the Claude Project" friction.
- **Costs:** now it's code to maintain; auth to get right; still not real RAG unless Stage 3.

### Stage 3 — Real RAG (when corpus + usage justify it)

The modern stack from the internship plan: **Neon Postgres + pgvector**, **Voyage** embeddings,
**Cohere** rerank, **Claude API**, with Anthropic's contextual-retrieval + hybrid search. This is
also where the dedupe spine becomes a real API.

- **Trigger to build:** archive too big for a Claude Project, or the team uses it enough that
  retrieval quality and freshness matter.
- **Cost (small scale):** Neon ~$19/mo, Voyage ~$0.18/M tokens, Cohere ~$2/1k searches, Claude API
  usage — roughly $50–100/mo to start.
- **Gets right:** scales, stays fresh via ingestion, powers both chatbot and dedupe from one DB.
- **Costs:** real engineering + eval harness; don't pay this before Stages 0–1 prove the value.

**Do not skip to Stage 3.** Each stage de-risks the next and most of the value is in Stage 0.

## The canonical deal record

One record per deal. Rich enough for the chatbot, structured enough for the dedupe lookup. Full
fill-in template lives in the archive spec; the shape:

| Field | Purpose | Used by |
|---|---|---|
| `deal_id` (slug) | stable handle, e.g. `park-ave-bayharbor-2022` | both |
| property: address, city, state, submarket, asset_type, sqft/units | identify + filter | both |
| owner: entity (LLC), principal(s) | dedupe by owner | dedupe + chatbot |
| broker / listing_source (on-market only) | dedupe by broker; relationship hygiene | dedupe |
| engagement: stage, first_touch, last_touch, relationship_owner (teammate) | "have we touched this, who owns it" | dedupe + chatbot |
| economics: ask_price, our_offer (LOI), cap_rate, $/sqft, key terms | "what did we offer" | chatbot |
| outcome: status, why_passed (tag + free text), date | "what did we pass on and why" | chatbot |
| source_docs: filenames | citations | chatbot |
| pipedrive_id | link back to CRM | both |

The dedupe spine is just a query over this: `previously_contacted(owner|address) → {yes/no, when,
outcome, who}`.

## Bus-factor

- Canonical docs live in the **shared drive / Pipedrive**, never a personal laptop.
- The Claude Project is reproducible from `INSTRUCTIONS.md` + the archive — anyone can rebuild it.
- Stage 3 is a standard, documented stack. No bespoke magic.
- This repo is the runbook.

## Open questions / blockers

1. **Where does Simi's LOI history actually live today?** (internship-plan open question #3 / F4
   blocker). Pipedrive attachments? A shared drive? Scattered in inboxes? This decides the Stage 0
   ingestion step. *Default assumption until answered: scattered — so consolidation is real work.*
2. **Pipedrive plan tier + API token** — needed to export deal records cleanly; later for live sync.
3. **Is RenomyHelper / `NashbilleSourcing` deal data in scope** for the archive, or only closed/LOI'd
   deals? (Affects how much sourcing-stage noise enters the corpus.)
4. **PII handling** — owner phone/email enrichment is sensitive. Internal-only, access-controlled.

## Anti-goals

- Not replacing Pipedrive — read from it, build memory beside it.
- Not reading anyone's inbox — archive + Pipedrive only (email threads = explicit opt-in later).
- Nothing auto-sends or auto-acts. The bot answers; humans decide.
- Not building Stage 3 before consolidation is done and Andrew has said "yes, keep going."
