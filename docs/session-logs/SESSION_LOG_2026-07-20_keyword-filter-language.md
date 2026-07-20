# Session Log — 2026-07-20 (pt 3) · Filter search → keyword language, no LLM

*Raz: "I don't want to use an Anthropic API key" → the filter chat became a pure client-side
keyword language with a known-terms popup, multi-criteria queries, and stacking.*

## What shipped (08817d7)

- **`src/filterLang.js`** — `parseQuery()` turns plain English into a validated filter patch with
  zero network calls. Coverage: channel, score buckets (only/hide/show/bare-adjective), all 11
  markets **with aliases** (nash/clt/cbus/boca/wpb/wake/orl/…), SF min/max/range (100k / 100,000 /
  "100k+" / bare "over 100k" heuristic ≥20k), clear height (max-only per buy-box; "clear over X"
  politely refused; "low clear" = 24), year built (after/before/pre-/post-/ranges/**decades** —
  "60s and 70s" → 1960–1979), owner type + location (absentee/oos), hold ("held 10+ years",
  "owned since 2005", "long hold"), previous-sale price/year/$psf ("bought for under $5m",
  "sold after 2015", "under $80/sf"), distance ("within 5 miles"), parcel bucket, view switching,
  quoted-text search, reset. Reply line echoes exactly what applied + what was ignored.
- **Multi-criteria + stacking**: any number of terms in one query; each query MERGES onto the
  current filters (applyChatPatch semantics) so "nashville" → "over 100k sf" → "only actionable"
  narrows progressively; "reset" starts over.
- **? popup** — button beside the ask box opens "Everything the filter search understands":
  every section/keyword (driven by the exported `VOCAB` — single source, keep in sync with rules)
  plus tap-to-try examples. **Gotcha:** must `createPortal` to `document.body` — the filter
  rail's CSS `transform` made `position:fixed` center inside the 292px rail instead of the viewport.
- **LLM path removed**: `/api/filter-chat` route, `filterChat.mjs`, and its Dockerfile COPY are
  gone (404 in prod verified). Deals-chat Ask-AI is untouched and still wants ANTHROPIC_API_KEY.

## Verified

- 18-query parser battery — all correct, including the 5-criteria query and nonsense input.
- Live stacking in the browser: "nashville over 100k sf" → 118 match (rail select + Min SF
  visibly set) → "only actionable with code violations" on top → 5 match, green cluster.
- Popup centered + complete after the portal fix.
- Prod: new bundle live ~2 min after push; old API route 404s; a real Keep Sourcing run was
  in progress in prod at verification time with the 63 restored legacy listings in its counts.

## Parallel session

Second Claude session active in the repo again today (map popup flicker fix f6fd4fc — caused by
the 3s live-status poller re-renders; Orlando/Raleigh Stage-1 data). Rebased around it; no conflicts.
