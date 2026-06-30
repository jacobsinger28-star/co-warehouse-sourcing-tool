-- 001_schema.sql — Nashville sourcing MVP
-- Postgres + PostGIS (Supabase: enable postgis extension first)

CREATE EXTENSION IF NOT EXISTS postgis;

-- The land. Primary anchor for everything.
CREATE TABLE parcels (
  apn TEXT PRIMARY KEY,                      -- Davidson County Map & Parcel number
  geom GEOMETRY(MULTIPOLYGON, 4326),
  situs_address TEXT,                        -- the property's street address
  situs_norm TEXT,                           -- normalized for joins
  land_sf NUMERIC,
  zoning_code TEXT,                          -- stored verbatim, no logic at MVP
  land_use_code TEXT,
  in_target_submarket BOOLEAN DEFAULT FALSE  -- point-in-polygon vs founder GeoJSON
);

-- The building(s) + sale history.
CREATE TABLE properties (
  property_id SERIAL PRIMARY KEY,
  apn TEXT REFERENCES parcels(apn),
  building_sf NUMERIC,                       -- assessor; noisy
  footprint_sf NUMERIC,                      -- computed from GIS, cross-check
  sf_confidence TEXT DEFAULT 'ok',           -- 'ok' | 'mismatch'
  year_built INT,
  last_sale_date DATE,
  last_sale_price NUMERIC,
  assessed_value NUMERIC,
  hold_years NUMERIC,
  clear_height_est NUMERIC,                  -- usually NULL at MVP
  clear_height_source TEXT                   -- 'listing'|'vlm_guess'|'call'|NULL
);

-- Who owns it on paper.
CREATE TABLE entities (
  entity_id SERIAL PRIMARY KEY,
  name_raw TEXT,
  name_norm TEXT,
  mailing_address TEXT,
  mailing_state TEXT,
  is_out_of_state BOOLEAN,                   -- mailing_state <> 'TN'
  portfolio_group_id INT,                    -- same normalized mailing addr = same group
  entity_type TEXT                           -- 'llc'|'trust'|'individual'|'corp' (regex on name)
);

CREATE TABLE ownerships (
  apn TEXT REFERENCES parcels(apn),
  entity_id INT REFERENCES entities(entity_id),
  source TEXT,
  PRIMARY KEY (apn, entity_id)
);

-- One row per motivation/distress event. Evidence, not conclusions.
CREATE TABLE distress_signals (
  signal_id SERIAL PRIMARY KEY,
  apn TEXT REFERENCES parcels(apn),
  entity_id INT NULL,
  type TEXT NOT NULL,        -- 'code_violation'|'permit_anomaly'|'stale_listing'|'withdrawn_listing'
                             -- note: tax_delinquency is founder-sourced CSV only (trustee file), NOT a distress_signals type
  detail TEXT,               -- e.g. '2 years delinquent, $48,211 owed'
  event_date DATE,
  source_ref TEXT NOT NULL,  -- URL or import filename. REQUIRED — no unsourced signals.
  verified BOOLEAN DEFAULT FALSE
);

-- VLM/imagery output. Raw model JSON kept alongside extracted fields.
CREATE TABLE site_observations (
  apn TEXT PRIMARY KEY REFERENCES parcels(apn),
  image_paths TEXT[],
  captured_at DATE,                          -- Street View capture date if available
  vlm_json JSONB,                            -- full raw model output
  dock_doors_est INT,
  drive_ins_est INT,
  parking_fullness TEXT,                     -- 'empty'|'sparse'|'moderate'|'full'|'not_visible'
  signage_present TEXT,                      -- 'yes'|'no'|'not_visible'
  condition TEXT,                            -- 'good'|'fair'|'poor'|'not_visible'
  divisibility TEXT,                         -- 'single_box'|'some_separation'|'multi_entry'|'not_visible'
  truck_access TEXT,                         -- 'easy'|'tight'|'bad'|'not_visible'
  model_version TEXT,
  human_verified BOOLEAN DEFAULT FALSE
);

-- Explainable scores. components JSON must sum to total.
CREATE TABLE scores (
  apn TEXT REFERENCES parcels(apn),
  scored_at TIMESTAMPTZ DEFAULT now(),
  version TEXT,
  total NUMERIC,
  components JSONB,          -- {"vacancy_evidence":20,"tax_delinquency":15,...}
  grade_human TEXT,          -- 'A'|'B'|'C' pulled back from Airtable
  PRIMARY KEY (apn, scored_at)
);

-- People behind entities, from manual SOS lookups + skip tracing.
CREATE TABLE contacts (
  contact_id SERIAL PRIMARY KEY,
  entity_id INT REFERENCES entities(entity_id),
  person_name TEXT,
  role TEXT,                 -- 'registered_agent'|'officer'|'owner'
  phones TEXT[],
  emails TEXT[],
  source TEXT,               -- 'sos_manual'|'batchskiptracing'
  confidence TEXT,           -- 'high'|'medium'|'low'
  dnc_checked BOOLEAN DEFAULT FALSE
);

-- Every founder touch. disposition is mandatory — this is future training data.
CREATE TABLE outreach_log (
  log_id SERIAL PRIMARY KEY,
  apn TEXT REFERENCES parcels(apn),
  contact_id INT REFERENCES contacts(contact_id),
  channel TEXT,              -- 'call' (only channel at MVP)
  occurred_at DATE,
  disposition TEXT NOT NULL DEFAULT 'pending',
  -- suggested values: 'no_answer'|'voicemail'|'wrong_number'|'not_interested'|
  --                   'conversation'|'meeting_set'|'do_not_contact'
  notes TEXT
);

-- Pipeline observability.
CREATE TABLE job_runs (
  run_id SERIAL PRIMARY KEY,
  job_name TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  status TEXT,               -- 'ok'|'failed'|'partial'
  rows_affected INT,
  error TEXT
);

-- NOTE: No listings table. Pipeline targets off-market properties only.
-- Anything on Crexi/LoopNet is already broker-controlled. Vacancy is inferred
-- from VLM imagery (parking fullness, signage) and assessor/Socrata signals only.

CREATE INDEX idx_parcels_geom ON parcels USING GIST (geom);
CREATE INDEX idx_signals_apn ON distress_signals (apn);
CREATE INDEX idx_entities_portfolio ON entities (portfolio_group_id);
