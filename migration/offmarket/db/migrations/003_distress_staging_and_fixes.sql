-- 003_distress_staging_and_fixes.sql
-- Staging for the distress feeds + idempotency/staleness fixes from the Day-2
-- self-review (see docs/BUILD_LOG.md). Safe to re-run.

-- ---------- raw staging: violations / permits / trustee tax file ----------
CREATE TABLE IF NOT EXISTS staging_violations (
  request_nbr     TEXT PRIMARY KEY,         -- Socrata-era "Request #", still unique
  apn             TEXT,                     -- Property_APN, verbatim
  prop_address    TEXT,
  date_received   DATE,
  reported_problem TEXT,
  status          TEXT,
  last_activity_date DATE,
  last_activity_result TEXT,
  violations_noted TEXT,
  property_owner  TEXT,
  raw             JSONB,
  loaded_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_staging_vio_apn ON staging_violations (apn);

CREATE TABLE IF NOT EXISTS staging_permits (
  permit_nbr      TEXT,
  apn             TEXT,                     -- "Parcel" field, verbatim
  permit_type     TEXT,
  date_entered    DATE,
  date_issued     DATE,
  const_cost      NUMERIC,
  address         TEXT,
  purpose         TEXT,
  raw             JSONB,
  loaded_at       TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (permit_nbr, apn)
);
CREATE INDEX IF NOT EXISTS idx_staging_per_apn ON staging_permits (apn);

-- Trustee delinquent-tax file (founder-supplied CSV; importer is generic).
-- Joined to properties AT SCORE TIME — deliberately NOT a distress_signals type.
CREATE TABLE IF NOT EXISTS staging_tax_delinquency (
  id              SERIAL PRIMARY KEY,
  apn_raw         TEXT,
  apn_norm        TEXT,                     -- uppercased, non-alphanumerics stripped
  owner_name      TEXT,
  amount_owed     NUMERIC,
  years_delinquent INT,                     -- best-effort parse; founder file calibrates
  tax_years       TEXT,                     -- raw years string if present
  source_file     TEXT NOT NULL,
  raw             JSONB,
  loaded_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_staging_tax_apn ON staging_tax_delinquency (apn_norm);

-- ---------- idempotency: distress_signals needs a natural key ----------
-- pull_violations / pull_permits upsert on (apn, type, source_ref); without this
-- index every weekly refresh would duplicate every signal row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_signals_apn_type_ref
  ON distress_signals (apn, type, source_ref);

-- ---------- entities: normalized mailing addr + upsert key ----------
ALTER TABLE entities ADD COLUMN IF NOT EXISTS mailing_norm TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_entities_name_mailing
  ON entities (name_norm, COALESCE(mailing_norm, ''));

-- ---------- staleness tracking ----------
-- Upserts never delete: a parcel that leaves the industrial band (or is retired)
-- would otherwise linger forever. last_seen_at lets build_universe ignore rows
-- not present in the latest pull instead of silently keeping them.
ALTER TABLE parcels    ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
