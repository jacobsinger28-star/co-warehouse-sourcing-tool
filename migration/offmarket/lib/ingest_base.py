"""
Shared ingest helpers (HEALTH_AUDIT §C1 — coercer de-duplication).

The 6 `pull_parcels_*` and 4 `pull_distress_*` scripts each carried their own copy of these
epoch coercers. The copies were proven BEHAVIOURALLY IDENTICAL across a battery of inputs (the
md5 differences were only a docstring and whether `datetime` was imported inside the function) —
see tests/test_ingest_base.py, which also asserts every market module now uses THESE, so a copy
can't silently drift back. Centralised so a date/timezone fix is one edit, not ten. Pure — no
DB, no network.

NOT yet centralised (each still per-market): `STAGING_PARCEL_COLS`/`STAGING_PARCEL_TMPL` and the
`promote()` SQL — those carry real per-market differences and are DB-bound, so they need the dev
Postgres (or recorded fixtures) to refactor safely. See the §C1 note in the audit.
"""
from __future__ import annotations

from datetime import datetime, timezone


def coerce_ms(v):
    """A date field may arrive as epoch ms (int/float) or an ISO string (f=geojson vs f=json).
    Returns epoch ms as an int, or None. Never raises — unparseable input -> None."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return int(v)
    try:
        return int(datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp() * 1000)
    except Exception:
        return None


def ms_to_date(ms):
    """Epoch ms -> a UTC `date`, or None. Never raises (bad/overflowing input -> None)."""
    if ms is None:
        return None
    try:
        return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).date()
    except (TypeError, ValueError, OSError):
        return None
