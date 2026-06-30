-- 005_ai_calling.sql — AI-dialer + CRM sync support. Safe to re-run (per-market schema).
--
-- Two additions, both idempotent:
--   1. outreach_log gains the fields an AI calling vendor returns (provider, the vendor's
--      own call id, recording, transcript, duration) so a returned call result can be tied
--      back to the row we created when we placed it.
--   2. crm_links: a generic local->remote id map so Pipedrive (or any CRM) sync is
--      idempotent — we never create a second Organization/Person/Deal/Activity for the
--      same local object, we PATCH the one we already made.

-- 1. AI-call result columns on the existing outreach_log -------------------------------
ALTER TABLE outreach_log ADD COLUMN IF NOT EXISTS provider         TEXT;  -- 'stub'|'bland'|...
ALTER TABLE outreach_log ADD COLUMN IF NOT EXISTS provider_call_id TEXT;  -- vendor's call id
ALTER TABLE outreach_log ADD COLUMN IF NOT EXISTS recording_url    TEXT;
ALTER TABLE outreach_log ADD COLUMN IF NOT EXISTS transcript       TEXT;
ALTER TABLE outreach_log ADD COLUMN IF NOT EXISTS duration_seconds INT;

-- One log row per vendor call: re-importing the same call result UPDATEs, never duplicates.
-- Partial (manual/non-AI rows leave provider_call_id NULL and are exempt).
CREATE UNIQUE INDEX IF NOT EXISTS uq_outreach_provider_call
  ON outreach_log (provider, provider_call_id)
  WHERE provider_call_id IS NOT NULL;

-- 2. Generic CRM link table (local object -> remote CRM id) ----------------------------
CREATE TABLE IF NOT EXISTS crm_links (
  crm          TEXT NOT NULL DEFAULT 'pipedrive',
  object_type  TEXT NOT NULL,             -- 'organization'|'person'|'deal'|'activity'
  local_key    TEXT NOT NULL,             -- entity_id | apn | log_id, stringified
  remote_id    TEXT NOT NULL,             -- the id Pipedrive assigned
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (crm, object_type, local_key)
);
