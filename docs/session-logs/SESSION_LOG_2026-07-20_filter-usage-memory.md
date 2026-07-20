# Session Log — 2026-07-20 (pt 6) · Filter modal remembers usage

*Raz: "remember what was searched and couldn't be filtered. see the most searched/filtered filter
and adjust the filters modal accordingly."*

## Shipped (commit d04f3bf — filterUsage.js new, FilterChat.jsx)

- **`src/filterUsage.js`** — device-local usage memory in localStorage
  (`sc.filterUsage.v1`), never sent anywhere (same privacy posture as the rest of the app; the
  data lives only in the already-unlocked browser). API: `recordApply` (count each applied
  term/query), `recordUnmatched` (remember a typed query the parser couldn't fully handle — empty
  patch or leftover tokens), `topTerms` / `unmatchedList` / `clearUsage`. Deduped, capped (24
  unmatched, 80-char keys), "reset" not counted.
- **FilterChat** — every `apply()` records; opening the modal refreshes the two new rows:
  - **Frequent** (top): most-used terms/queries with their counts, clickable to re-apply, lit when
    currently active. This is the "adjust the modal to the most-searched filter" surface.
  - **Searched but not filtered**: recent queries that matched nothing / had ignored words, with
    the leftover tokens highlighted, plus a **Clear** button. This is the "remember what couldn't
    be filtered" surface — a visible to-add list for growing the vocabulary.

## Verified

- **In-browser** (local, 1440×900): applied `vacant nashville over 100k sf`, `llc`, `nashville` →
  all appeared under **FREQUENT** with counts and lit state; a nonsense query
  `sprinklered esfr rail served` landed in **SEARCHED BUT NOT FILTERED** with its four leftover
  tokens highlighted; **Clear** wiped the store to `{}`; localStorage persisted across reopen.
- **Module unit test** (Node + localStorage shim): frequency ordering, dedup, reset-ignored.
- **Deployed**: live bundle serves "Searched but not filtered". Isolated `git stash -u` build
  confirmed the committed tree builds without the parallel session's files.

## Scope / notes

- Only the **ASK modal** is tracked (chips + typed queries), not the legacy rail chips — keeps the
  "frequent" data coherent and re-clickable.
- Concurrent parallel session was busy again (PropTable sort, PhoneBurner dialer, coltest
  scratch files). Clean rebase this time, no duplicate commits; only my two files staged.
- Idea surfaced for later: the "Searched but not filtered" list is exactly the queue of parser
  synonyms to add — a periodic pass over it would keep the keyword vocab ahead of real usage.
