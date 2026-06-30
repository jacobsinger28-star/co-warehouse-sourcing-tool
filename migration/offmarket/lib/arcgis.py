"""
Minimal ArcGIS REST client. Replaces the brief's `sodapy`/Socrata path — Nashville
moved to ArcGIS Hub (see DATA_NOTES.md). Used by all three ingest scripts.

Handles the two things that bite you with ArcGIS REST:
  * paging — layers cap at 1000-2000 rows/request; we page with resultOffset until
    the server stops setting exceededTransferLimit.
  * transient failures — retried with backoff via tenacity.
"""
from __future__ import annotations

from typing import Any, Iterator

import requests
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

TIMEOUT = 60


class ArcGISError(RuntimeError):
    pass


@retry(
    retry=retry_if_exception_type((requests.RequestException, ArcGISError)),
    wait=wait_exponential(multiplier=1, min=2, max=20),
    stop=stop_after_attempt(5),
    reraise=True,
)
def _request(url: str, params: dict) -> dict:
    # POST, not GET: batched `WHERE ... IN (hundreds of APNs)` blows past the server's
    # URL-length limit and comes back 404. ArcGIS /query accepts form-encoded POST.
    r = requests.post(url, data={**params, "f": params.get("f", "json")}, timeout=TIMEOUT)
    r.raise_for_status()
    data = r.json()
    if isinstance(data, dict) and "error" in data:
        # ArcGIS returns HTTP 200 with an {"error": {...}} body — treat as retryable.
        raise ArcGISError(f"{url}: {data['error']}")
    return data


def query(
    layer_url: str,
    where: str = "1=1",
    out_fields: str = "*",
    *,
    geojson: bool = False,
    out_sr: int = 4326,
    return_geometry: bool = False,
    page_size: int = 1000,
    order_by: str | None = None,
    extra: dict | None = None,
) -> Iterator[dict[str, Any]]:
    """
    Yield features from an ArcGIS layer, paging transparently.

    geojson=True returns GeoJSON features ({'properties':..., 'geometry':...}); else
    esri JSON features ({'attributes':..., 'geometry':...}). Geometry is only fetched
    when return_geometry=True (it roughly triples payload size).
    """
    fmt = "geojson" if geojson else "json"
    base = {
        "where": where,
        "outFields": out_fields,
        "returnGeometry": "true" if return_geometry else "false",
        "outSR": out_sr,
        "f": fmt,
    }
    if order_by:
        base["orderByFields"] = order_by
    if extra:
        base.update(extra)

    offset = 0
    while True:
        params = {**base, "resultOffset": offset, "resultRecordCount": page_size}
        data = _request(layer_url + "/query", params)
        feats = data.get("features", [])
        if not feats:
            break
        yield from feats
        # GeoJSON responses don't echo exceededTransferLimit reliably; fall back to
        # "got a full page -> probably more".
        more = data.get("exceededTransferLimit") or data.get("properties", {}).get(
            "exceededTransferLimit"
        )
        if more is None:
            more = len(feats) == page_size
        if not more:
            break
        offset += len(feats)


def query_by_in(
    layer_url: str,
    field: str,
    values: list[str],
    out_fields: str = "*",
    *,
    batch: int = 200,
    quote: bool = True,
    **kw,
) -> Iterator[dict[str, Any]]:
    """Query `field IN (...)` over a large value list, batched to keep URLs short."""
    for i in range(0, len(values), batch):
        chunk = values[i : i + batch]
        if quote:
            inlist = ",".join("'" + str(v).replace("'", "''") + "'" for v in chunk)
        else:
            inlist = ",".join(str(v) for v in chunk)
        yield from query(layer_url, where=f"{field} IN ({inlist})", out_fields=out_fields, **kw)


def count(layer_url: str, where: str = "1=1") -> int:
    data = _request(layer_url + "/query", {"where": where, "returnCountOnly": "true"})
    return int(data.get("count", -1))
