# Deals Database + Chatbot

Internal tool for Simi Capital: a consolidated archive of past deals (LOI documents + Pipedrive
records) and a chatbot that answers plain-English questions over it — e.g. "have we ever LOI'd
this owner," "what did we offer on the Park Ave property in 2022," "list every deal we passed on
for cap rate."

Status: **v0 in progress (June 16, 2026)** — design + Claude Project assets drafted; Stage 0
consolidation not yet started (blocked on where LOIs live).

## What's here

```
deals-database/
├── README.md                         ← you are here
├── docs/
│   └── ARCHITECTURE.md               ← design, 3-stage rollout, canonical record, costs, open Qs
├── claude-project/                   ← Stage 1: the "prove it this week, zero code" package
│   ├── INSTRUCTIONS.md               ← system prompt to paste into the Claude Project
│   ├── deal-archive-spec.md          ← Stage 0: how to consolidate the archive (the real unlock)
│   └── how-to-use.md                 ← step-by-step setup + smoke tests + how to show Andrew
├── data/
│   └── deal-index.example.csv        ← the master deal-index format, with example rows
└── tools/                            ← Stage 0 data-hygiene (stdlib Python, no venv)
    ├── validate_index.py             ← lints deal-index.csv against the quality bar
    ├── scaffold_index.py             ← scaffolds the index from the /deals folders + reconciles drift
    ├── test_validate.py              ← tests for the linter
    └── test_scaffold.py              ← tests for the scaffolder
```

## The plan in one paragraph

Build the deal record **once** as a canonical store; two things read it — the chatbot (humans, plain
English) and the F4 dedupe spine (the sourcing engine's "have we touched this" check). Roll out in
stages: **Stage 0** consolidate every deal/LOI into one place (the actual unlock), **Stage 1** a
Claude Project over it this week with zero code, **Stage 2** a private `/ask` page only if Andrew
wants it, **Stage 3** real RAG (Neon/pgvector + Voyage + Cohere + Claude API) when scale justifies.
Most of the value is in Stage 0. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Locked scope (from `../easybay-demo/.private/in-flight.md`)

- **Sources** = deal archive (LOI PDFs/Word) + Pipedrive records. **Not** inboxes. Email threads
  only as a deliberate, policy-backed opt-in.
- **Build path** = Claude Project first → private `/ask` site → real RAG. (above)
- **Nothing auto-sends or auto-acts.** Internal and confidential.

## Next moves

> **Blocked on inputs from people?** The full list of what's needed from Raz / Aaron / Andrew to
> unblock Stage 0 is in [`docs/STAGE-0-INPUTS-NEEDED.md`](docs/STAGE-0-INPUTS-NEEDED.md).


1. **Answer the blocker:** where does Simi's LOI history actually live? (open question #3 / F4).
   Until then, Stage 0 is a guess. Ask Aaron in the week-1 PRD call.
2. **Get Pipedrive API access + plan tier** to export deal records into `deal-index.csv`.
3. Run Stage 0 consolidation per [`claude-project/deal-archive-spec.md`](claude-project/deal-archive-spec.md).
   Once the `/deals/<deal_id>/` folders exist, scaffold the index from them
   (`python3 tools/scaffold_index.py "/path/to/Deal Archive"`), fill the blanks, then gate on
   `python3 tools/validate_index.py data/deal-index.csv` (must exit clean) and
   `… scaffold_index.py "/path/to/Deal Archive" --check data/deal-index.csv` (index matches the folders).
4. Stand up the Claude Project per [`claude-project/how-to-use.md`](claude-project/how-to-use.md),
   smoke-test it, show Andrew.

## Context docs (under `../easybay-demo/.private/`)

- `in-flight.md` — locked decisions on this project
- `email-to-andrew-sourcing-greenlight-jun-11-2026.md` — the chatbot explained to Andrew
- `internship-plan-jun-9-2026.md` — phased plan, F4 dedupe spine, tool/cost table
- `company-data.md` — Simi + EasyBay facts, buy box context

> Those notes currently live inside the EasyBay repo. If shared across projects, consider hoisting
> `.private/` to the umbrella level or copying the deals-relevant ones here.
