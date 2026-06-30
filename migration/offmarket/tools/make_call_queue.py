#!/usr/bin/env python3
"""
make_call_queue.py — the human reach-out surface: a click-to-call queue (all markets).

The AI dialer (place_calls.py) works the list at scale; THIS is where a person picks up the
warm ones. One self-contained HTML file — open it on a phone and every number is a tap-to-dial
`tel:` link, every email a `mailto:` link — no server, no app. Mirrors make_dashboard.py:
aggregates every built market (City column + filter), DB hit only in collect(), and a
--from-json / --dump-json snapshot so it rebuilds with no Postgres.

Rows are owners with a reachable contact, ranked, and bucketed by what the human should do:
  warm     — AI got a conversation / meeting: CALL BACK NOW (top of the list)
  ready    — DNC-checked, not yet reached: a human can dial it
  attempted— voicemail / no answer: worth another try
  blocked  — number not DNC-checked yet: scrub before dialing (shown, not dialable)
'do_not_contact' / 'wrong_number' / 'not_interested' are dropped from the queue.

    python tools/make_call_queue.py [--out exports/call_queue.html] [--dump-json PATH]
    python tools/make_call_queue.py --from-json PATH    # rebuild with no DB
"""
from __future__ import annotations

import argparse
import html
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

ROWS_SQL = """
WITH latest AS (
  SELECT DISTINCT ON (apn) apn, total, grade_human FROM scores
  WHERE version LIKE '%-final' ORDER BY apn, scored_at DESC),
ent AS (
  SELECT e.entity_id, e.name_raw, e.entity_type,
         max(l.total) AS best,
         -- grade of the TOP-scored parcel, consistent with top_apn (max('A','B','C')
         -- would return 'C', the WORST letter — see place_calls.py).
         (array_agg(l.grade_human ORDER BY l.total DESC NULLS LAST))[1] AS grade,
         (array_agg(o.apn ORDER BY l.total DESC NULLS LAST))[1] AS top_apn
  FROM entities e JOIN ownerships o USING (entity_id) JOIN latest l ON l.apn=o.apn
  WHERE l.total IS NOT NULL GROUP BY e.entity_id),
best_contact AS (
  SELECT DISTINCT ON (entity_id) contact_id, entity_id, person_name, phones, emails,
         confidence, dnc_checked
  FROM contacts WHERE array_length(phones,1)>0
  ORDER BY entity_id,
           CASE confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2
                           WHEN 'low' THEN 1 ELSE 0 END DESC, contact_id),
lastcall AS (
  SELECT DISTINCT ON (contact_id) contact_id, disposition, transcript,
         recording_url, occurred_at
  FROM outreach_log WHERE contact_id IS NOT NULL
  ORDER BY contact_id, log_id DESC)
SELECT ent.best, ent.grade, ent.name_raw, ent.entity_type, ent.top_apn,
       c.person_name, c.phones, c.emails, c.confidence, c.dnc_checked,
       p.situs_address, lc.disposition, lc.transcript, lc.recording_url, lc.occurred_at
FROM ent
JOIN best_contact c ON c.entity_id = ent.entity_id
JOIN parcels p ON p.apn = ent.top_apn
LEFT JOIN lastcall lc ON lc.contact_id = c.contact_id
ORDER BY ent.best DESC
"""

DROP = {"do_not_contact", "wrong_number", "not_interested"}
WARM = {"conversation", "meeting_set"}
ATTEMPTED = {"voicemail", "no_answer"}
# Sort weight: warm first, then dialable, then attempted, then blocked.
BUCKET_ORDER = {"warm": 0, "ready": 1, "attempted": 2, "blocked": 3}


def _bucket(r: dict) -> str | None:
    disp = r.get("disposition")
    if disp in DROP:
        return None
    if disp in WARM:
        return "warm"
    if disp in ATTEMPTED:
        return "attempted"
    return "ready" if r.get("dnc_checked") else "blocked"


def collect(markets: list | None = None) -> dict:
    """Query every built market schema; skip ones with no parcels/universe yet."""
    from lib.db import cursor
    from lib.market import MARKETS_DIR, db_schema, load_market
    if markets is None:
        markets = sorted(p.stem for p in MARKETS_DIR.glob("*.yaml"))
    rows: list[dict] = []
    for name in markets:
        schema = db_schema(name)
        cfg = load_market(name)
        city = cfg.get("market", name).title()
        state = (cfg.get("home_state") or cfg.get("gates", {}).get("home_state") or "").upper()
        with cursor(dict_rows=True, commit=False) as cur:
            cur.execute("SELECT to_regclass(%s) AS reg", (f"{schema}.parcels",))
            if not cur.fetchone()["reg"]:
                continue
            cur.execute(f'SET search_path TO "{schema}", public')
            cur.execute(ROWS_SQL)
            for r in cur.fetchall():
                b = _bucket(r)
                if b is None:
                    continue
                rows.append({
                    "city": city, "state": state, "bucket": b,
                    "score": round(float(r["best"]), 0) if r["best"] is not None else None,
                    "grade": r["grade"], "owner": r["name_raw"],
                    "person": r["person_name"], "phones": list(r["phones"] or []),
                    "emails": list(r["emails"] or []), "confidence": r["confidence"],
                    "dnc_checked": bool(r["dnc_checked"]), "address": r["situs_address"],
                    "apn": r["top_apn"], "disposition": r["disposition"],
                    "transcript": r["transcript"], "recording": r["recording_url"],
                    "occurred": r["occurred_at"].isoformat() if r["occurred_at"] else None,
                })
    rows.sort(key=lambda r: (BUCKET_ORDER[r["bucket"]], -(r["score"] or 0)))
    return {"generated": date.today().isoformat(), "rows": rows}


def _tel(p: str) -> str:
    digits = "".join(ch for ch in p if ch.isdigit())
    pretty = f"({p[0:3]}) {p[3:6]}-{p[6:]}" if len(digits) == 10 else p
    return (f'<a class="call" href="tel:+1{digits}">📞 {html.escape(pretty)}</a>'
            if len(digits) == 10 else f'<span class=call-dead>{html.escape(p)}</span>')


def _row_html(r: dict) -> str:
    badge = {"warm": "🔥 WARM", "ready": "✅ READY", "attempted": "↻ RETRY",
             "blocked": "⛔ DNC?"}[r["bucket"]]
    # Compliance gate, fail-SAFE: a number is tap-to-dial ONLY if it's been DNC-scrubbed.
    # Not-yet-scrubbed numbers render as plain text (shown, never a live tel: link) — keyed
    # on dnc_checked itself, not the bucket, so a warm/attempted-but-unscrubbed row can't slip
    # through. The CSS .b-blocked rule is now only a redundant visual cue, not the gate.
    if r["dnc_checked"]:
        phones = "".join(_tel(p) for p in r["phones"]) or "—"
    else:
        phones = "".join(f'<span class=call-dead>📵 {html.escape(p)}</span>'
                         for p in r["phones"]) or "—"
    emails = "".join(f'<a class="mail" href="mailto:{html.escape(e)}">✉︎ {html.escape(e)}</a>'
                     for e in r["emails"])
    sub = []
    if r["disposition"]:
        sub.append(f"last: {html.escape(r['disposition'].replace('_', ' '))}"
                   + (f" ({r['occurred']})" if r["occurred"] else ""))
    if r["recording"]:
        sub.append(f'<a href="{html.escape(r["recording"])}">▶ recording</a>')
    if r["transcript"]:
        sub.append(html.escape(r["transcript"][:160]))
    who = html.escape(r["person"] or r["owner"] or "?")
    owner_extra = (f' · <span class=mut>{html.escape(r["owner"])}</span>'
                   if r["person"] and r["owner"] else "")
    grade = f' <b>{html.escape(r["grade"])}</b>' if r["grade"] else ""
    q = html.escape((who + " " + (r["address"] or "") + " " + (r["owner"] or "")).lower())
    return (
        f'<div class="card b-{r["bucket"]}" data-city="{html.escape(r["city"])}" '
        f'data-bucket="{r["bucket"]}" data-q="{q}">'
        f'<div class=top><span class=bdg>{badge}</span>'
        f'<span class=sc>{int(r["score"]) if r["score"] is not None else "—"}{grade}</span>'
        f'<span class=city>{html.escape(r["city"])}</span></div>'
        f'<div class=who><b>{who}</b>{owner_extra}</div>'
        f'<div class=addr>{html.escape(r["address"] or "—")}</div>'
        f'<div class=actions>{phones}{emails}</div>'
        f'{("<div class=sub>" + " · ".join(sub) + "</div>") if sub else ""}'
        f'</div>')


def render(data: dict) -> str:
    rows = data["rows"]
    cities = sorted({r["city"] for r in rows})
    counts = {b: sum(1 for r in rows if r["bucket"] == b)
              for b in ("warm", "ready", "attempted", "blocked")}
    city_opts = "".join(f'<option value="{html.escape(c)}">{html.escape(c)}</option>'
                        for c in cities)
    body = "\n".join(_row_html(r) for r in rows) or \
        '<div class=empty>No reachable contacts yet — add contacts, ' \
        'DNC-scrub, then place calls.</div>'
    return TEMPLATE.replace("{{GEN}}", data["generated"]) \
        .replace("{{N}}", str(len(rows))) \
        .replace("{{WARM}}", str(counts["warm"])).replace("{{READY}}", str(counts["ready"])) \
        .replace("{{ATT}}", str(counts["attempted"])).replace("{{BLK}}", str(counts["blocked"])) \
        .replace("{{CITY_OPTS}}", city_opts).replace("{{ROWS}}", body)


TEMPLATE = """<!DOCTYPE html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Call queue</title><style>
:root{--bg:#0f1115;--card:#171a21;--mut:#8a93a6;--line:#262b36;--fg:#e7ecf3}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);
font:15px/1.45 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif}
header{padding:14px 16px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:2}
h1{margin:0 0 4px;font-size:18px}.meta{color:var(--mut);font-size:13px}
.pills{margin-top:8px;display:flex;gap:6px;flex-wrap:wrap}
.pill{background:var(--card);border:1px solid var(--line);border-radius:99px;padding:3px 10px;font-size:12px}
.controls{display:flex;gap:8px;padding:10px 16px;flex-wrap:wrap;position:sticky;top:74px;background:var(--bg);z-index:1}
select,input{background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:9px 10px;font-size:14px}
input{flex:1;min-width:160px}
#tb{padding:4px 12px 48px;max-width:760px;margin:0 auto}
.card{background:var(--card);border:1px solid var(--line);border-left-width:4px;border-radius:12px;padding:12px 14px;margin:10px 0}
.card.b-warm{border-left-color:#ff8a5b}.card.b-ready{border-left-color:#54d18c}
.card.b-attempted{border-left-color:#e6c35c}.card.b-blocked{border-left-color:#3a4150}
.top{display:flex;gap:10px;align-items:center;font-size:12px;margin-bottom:6px}
.bdg{font-weight:700}.card.b-warm .bdg{color:#ff8a5b}.card.b-ready .bdg{color:#54d18c}
.card.b-attempted .bdg{color:#e6c35c}.card.b-blocked .bdg{color:#8a93a6}
.sc{font-weight:700;font-size:15px}.city{color:var(--mut);margin-left:auto}
.who{font-size:16px}.who b{font-weight:700}.mut{color:var(--mut);font-weight:400;font-size:14px}
.addr{color:var(--mut);font-size:13px;margin:2px 0 10px}
.actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
a{color:#6ea8fe;text-decoration:none}
a.call{display:inline-block;background:#1f6feb22;border:1px solid #2d6fd6;border-radius:10px;
padding:11px 15px;font-weight:700;color:#9cc4ff;font-size:15px}
.call-dead{color:var(--mut);font-size:14px}
a.mail{display:inline-block;padding:11px 4px;font-size:14px}
.card.b-blocked a.call{opacity:.45;pointer-events:none}
.sub{color:var(--mut);font-size:12.5px;margin-top:9px;border-top:1px solid var(--line);padding-top:8px}
.empty{color:var(--mut);text-align:center;padding:48px 16px}
</style></head><body>
<header><h1>Call queue <span class=meta>· warm leads first</span></h1>
<div class=meta>{{N}} reachable owners · generated {{GEN}}</div>
<div class=pills><span class=pill>🔥 warm {{WARM}}</span><span class=pill>✅ ready {{READY}}</span>
<span class=pill>↻ retry {{ATT}}</span><span class=pill>⛔ DNC? {{BLK}}</span></div></header>
<div class=controls>
<select id=city onchange=flt()><option value="">All cities</option>{{CITY_OPTS}}</select>
<select id=bucket onchange=flt()><option value="">All statuses</option>
<option value=warm>🔥 warm</option><option value=ready>✅ ready</option>
<option value=attempted>↻ retry</option><option value=blocked>⛔ DNC?</option></select>
<input id=q placeholder="search owner / address…" oninput=flt()></div>
<div id=tb>{{ROWS}}</div>
<script>
function flt(){var c=city.value,b=bucket.value,s=q_.value.toLowerCase();
document.querySelectorAll('#tb .card').forEach(function(t){
 var ok=(!c||t.dataset.city===c)&&(!b||t.dataset.bucket===b)&&(!s||(t.dataset.q||'').indexOf(s)>-1);
 t.style.display=ok?'':'none';});}
var q_=document.getElementById('q');
</script></body></html>"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="exports/call_queue.html")
    ap.add_argument("--from-json", default=None, help="rebuild from a snapshot (no DB)")
    ap.add_argument("--dump-json", default=None, help="also write the data snapshot")
    args = ap.parse_args()

    if args.from_json:
        data = json.loads(Path(args.from_json).read_text(encoding="utf-8"))
    else:
        data = collect()
        if args.dump_json:
            Path(args.dump_json).parent.mkdir(parents=True, exist_ok=True)
            Path(args.dump_json).write_text(json.dumps(data, indent=2), encoding="utf-8")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render(data), encoding="utf-8")
    n = len(data["rows"])
    warm = sum(1 for r in data["rows"] if r["bucket"] == "warm")
    print(f"  call queue: {out} ({n} owners, {warm} warm) — open on a phone to tap-to-dial")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
