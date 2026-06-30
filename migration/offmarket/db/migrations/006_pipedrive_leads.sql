-- 006_pipedrive_leads.sql — separate idempotency map for the ranked-lead → Pipedrive push.
-- Safe to re-run (per-market schema).
--
-- The lead-queue push (sync/pipedrive_leads.py) loads the scored *universe* into Pipedrive's
-- Leads Inbox as prospects to qualify. This is a DIFFERENT flow from the call-outcome sync
-- (sync/pipedrive_sync.py), which lands completed AI calls as Deals via `crm_links`. They are
-- deliberately kept on separate link tables (founder, 2026-06-22): a property may exist as
-- both a prospecting Lead now and, later, a worked Deal — and the two syncs must never fight
-- over a single local->remote mapping row.
--
--   object_type : 'organization' | 'person' | 'lead' | 'note'
--   local_key   : entity_id | contact_id or 'entity-<id>' | apn | apn   (stringified per object)
--
-- sync/pipedrive_leads.py also CREATEs this table on the fly (IF NOT EXISTS) in whatever
-- market schema it runs against, so a pilot works before this migration is hand-applied to a
-- new market's schema. This file is the canonical record + the path for `make migrate`.

CREATE TABLE IF NOT EXISTS crm_lead_links (
  crm          TEXT NOT NULL DEFAULT 'pipedrive',
  object_type  TEXT NOT NULL,
  local_key    TEXT NOT NULL,
  remote_id    TEXT NOT NULL,
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (crm, object_type, local_key)
);
