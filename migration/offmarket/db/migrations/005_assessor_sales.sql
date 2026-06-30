-- 005_assessor_sales.sql
-- Staging for per-parcel assessor sales history scraped from a county record-card portal
-- (Charleston County `prcweb` today; any market with a queryable record card later). Safe to
-- re-run. See docs/BUILD_LOG.md.
--
-- Why this exists: the GIS parcel feed carries only ONE sale (a single RECORDED_DATE/SALE_PRICE),
-- which is frequently a recent NOMINAL intra-entity transfer ($1-$10 quitclaim). That understates
-- the true hold period — the strongest signal Charleston has. The record card exposes the FULL
-- deed history, so we stage every sale and recompute hold_years from the most-recent ARM'S-LENGTH
-- (non-nominal) sale. `is_nominal` flags the throwaway transfers so the promote step can skip them.

CREATE TABLE IF NOT EXISTS staging_assessor_sales (
  apn         TEXT    NOT NULL,            -- parcel id (= our parcels.apn / energov PID / TMS)
  sale_date   DATE,                        -- deed/sale date
  sale_price  NUMERIC,                     -- as published ($1-$10 nominal transfers included)
  deed        TEXT,                        -- deed book-page reference (e.g. 'L643-200')
  is_nominal  BOOLEAN DEFAULT FALSE,       -- TRUE for <= nominal-threshold transfers (skip for hold)
  loaded_at   TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (apn, sale_date, deed)       -- a parcel can have many sales; dedupe on the deed event
);
CREATE INDEX IF NOT EXISTS idx_staging_sales_apn ON staging_assessor_sales (apn);
