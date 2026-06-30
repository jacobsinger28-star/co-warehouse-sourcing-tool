"""
Database access + pipeline observability.

Thin wrapper over psycopg2. Every ingest/transform stage runs inside a `job_run`
context so we get the brief's required observability (job_runs table) and the
">20% of rows failed -> abort the stage" rule in one place.
"""
from __future__ import annotations

import os
from contextlib import contextmanager

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ.get("DATABASE_URL")


def _active_schema() -> str:
    """The active market's Postgres schema (Nashville=public, others isolated)."""
    from lib.market import db_schema
    schema = db_schema()
    # Identifier guard: config-sourced, but never interpolate an unchecked name.
    return schema if schema and all(c.isalnum() or c == "_" for c in schema) else "public"


def connect():
    """Open a new connection, scoped to the active market's schema via search_path.
    Nashville lives in `public` (no-op); other markets (e.g. columbus) get their own
    schema so the two markets' data never collide. Caller owns commit/close (or use
    the `cursor` cm)."""
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL not set — copy .env.example to .env and fill it in")
    conn = psycopg2.connect(DATABASE_URL)
    schema = _active_schema()
    if schema != "public":
        with conn.cursor() as cur:
            cur.execute(f'SET search_path TO "{schema}", public')
        conn.commit()
    return conn


@contextmanager
def cursor(commit: bool = True, dict_rows: bool = False):
    """Connection+cursor context manager. Commits on clean exit, rolls back on error."""
    conn = connect()
    cur_factory = psycopg2.extras.RealDictCursor if dict_rows else None
    try:
        cur = conn.cursor(cursor_factory=cur_factory)
        yield cur
        if commit:
            conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


class FailureRateExceeded(RuntimeError):
    """Raised when a stage's per-row failure rate crosses the abort threshold."""


class JobRun:
    """
    Context manager that records one pipeline stage to job_runs and enforces the
    failure-rate gate.

        with JobRun("pull_parcels") as job:
            for row in rows:
                try:
                    upsert(row); job.ok()
                except Exception as e:
                    job.fail(e, ref=row["APN"])   # logged + counted, not raised
            # on exit: aborts if failed/total > max_fail_rate, else records 'ok'/'partial'

    On a clean exit it writes status 'ok' (no failures) or 'partial' (some, under
    threshold). On an exception it writes 'failed'. Over-threshold raises
    FailureRateExceeded so the Makefile stage stops.
    """

    def __init__(self, job_name: str, max_fail_rate: float = 0.20):
        self.job_name = job_name
        self.max_fail_rate = max_fail_rate
        self.ok_count = 0
        self.fail_count = 0
        self.errors: list[str] = []
        self.run_id: int | None = None

    @property
    def total(self) -> int:
        return self.ok_count + self.fail_count

    def ok(self, n: int = 1) -> None:
        self.ok_count += n

    def fail(self, err: Exception | str, ref: str | None = None) -> None:
        self.fail_count += 1
        msg = f"{ref or '?'}: {err}"
        self.errors.append(msg)
        # Keep the log bounded; first 50 distinct errors are plenty to debug.
        if len(self.errors) > 50:
            self.errors = self.errors[:50]

    def __enter__(self) -> "JobRun":
        with cursor() as cur:
            cur.execute(
                "INSERT INTO job_runs (job_name, started_at, status) "
                "VALUES (%s, now(), 'running') RETURNING run_id",
                (self.job_name,),
            )
            self.run_id = cur.fetchone()[0]
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        if exc_type is not None:
            self._record("failed", error=f"{exc_type.__name__}: {exc}")
            return False  # re-raise

        rate = (self.fail_count / self.total) if self.total else 0.0
        if rate > self.max_fail_rate:
            self._record("failed",
                         error=f"failure rate {rate:.0%} > {self.max_fail_rate:.0%}; "
                               f"{self.fail_count}/{self.total} rows. "
                               f"sample: {' | '.join(self.errors[:5])}")
            raise FailureRateExceeded(
                f"{self.job_name}: {self.fail_count}/{self.total} rows failed "
                f"({rate:.0%} > {self.max_fail_rate:.0%}) — aborting stage"
            )
        status = "partial" if self.fail_count else "ok"
        self._record(status,
                     error="; ".join(self.errors[:10]) if self.errors else None)
        return False

    def _record(self, status: str, error: str | None = None) -> None:
        with cursor() as cur:
            cur.execute(
                "UPDATE job_runs SET finished_at=now(), status=%s, rows_affected=%s, "
                "error=%s WHERE run_id=%s",
                (status, self.ok_count, error, self.run_id),
            )


def ping() -> str:
    """Smoke test: returns the PostGIS version string, proving DB + extension are live."""
    with cursor(commit=False) as cur:
        cur.execute("SELECT postgis_lib_version()")
        return cur.fetchone()[0]
