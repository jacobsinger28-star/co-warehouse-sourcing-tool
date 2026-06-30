-- 004_outreach.sql — constraints the Day-9/10 outreach loop needs. Safe to re-run.

-- skiptrace_import upserts one contact per (entity, data source).
CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_entity_source
  ON contacts (entity_id, source);
