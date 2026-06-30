-- 002_staging_and_universe.sql
-- Raw landing tables (brief: "raw responses land in staging before any transform")
-- + columns the brief/weights.yaml reference that 001 was missing.

-- ---------- raw staging ----------
-- Ownership/assessor rows, verbatim from ArcGIS. Truncated + reloaded each pull.
CREATE TABLE IF NOT EXISTS staging_parcels (
  apn           TEXT PRIMARY KEY,
  owner         TEXT,
  own_addr      TEXT,
  own_city      TEXT,
  own_state     TEXT,
  own_zip       TEXT,
  own_date_ms   BIGINT,          -- ArcGIS epoch milliseconds
  sale_price    NUMERIC,
  prop_addr     TEXT,
  prop_city     TEXT,
  prop_zip      TEXT,
  lu_code       TEXT,
  lu_desc       TEXT,
  acres         NUMERIC,
  totl_appr     NUMERIC,
  totl_assd     NUMERIC,
  geom          GEOMETRY(MULTIPOLYGON, 4326),
  raw           JSONB,
  loaded_at     TIMESTAMPTZ DEFAULT now()
);

-- CAMA building rows (one per AssessorCardNumber). Truncated + reloaded each pull.
CREATE TABLE IF NOT EXISTS staging_building_chars (
  id             SERIAL PRIMARY KEY,
  apn            TEXT,
  card           INTEGER,
  structure_type TEXT,
  finished_area  NUMERIC,
  year_built     INTEGER,
  raw            JSONB,
  loaded_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_staging_bc_apn ON staging_building_chars (apn);

-- ---------- columns missing from 001 ----------
-- weights.yaml proximity_score implementation_note populates this in build_universe.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS distance_miles_icbd NUMERIC;
-- Founder decision (2026-06-11): building_sf is the SUM of buildings; keep the
-- largest single structure + count alongside so a "75k across 4 sheds" parcel is
-- distinguishable from "one 100k box" during manual review / on call sheets.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS building_sf_largest NUMERIC;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS building_count INTEGER;

-- properties is one row per parcel (aggregated). Needed for upsert-on-apn.
-- DO-block guard: ADD CONSTRAINT has no IF NOT EXISTS, and migrations must be
-- safely re-runnable (same file gets applied to Supabase later).
-- Schema-aware guard: conname alone is NOT unique across schemas, so a bare
-- `WHERE conname='uq_properties_apn'` finds public's copy and wrongly skips creating
-- it in every other market schema (columbus/charlotte). Qualify by the table's schema.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.conname = 'uq_properties_apn' AND n.nspname = current_schema()
  ) THEN
    ALTER TABLE properties ADD CONSTRAINT uq_properties_apn UNIQUE (apn);
  END IF;
END $$;

-- Universe membership, set by build_universe.py (gate outcome per parcel).
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS land_use_desc TEXT;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS in_universe    BOOLEAN DEFAULT FALSE;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS manual_review  BOOLEAN DEFAULT FALSE;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS gate_reason    TEXT;
