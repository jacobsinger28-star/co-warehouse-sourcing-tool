-- 0004_webhook_secret.sql — per-tenant PhoneBurner webhook secret (Phase 2c)
--
-- PhoneBurner posts call outcomes to /api/phoneburner/hook/<secret>/<event>. A
-- webhook can't carry our JWT, so the path <secret> is the ONLY thing that tells
-- the server which tenant a call belongs to — which in turn decides whose
-- Pipedrive a warm disposition is written into. Each tenant therefore needs its
-- own unguessable secret, distinct from the legacy env PHONEBURNER_WEBHOOK_SECRET
-- (which still serves the default/SimiCapital workspace, matched directly in the
-- server before any DB lookup).
--
-- The default auto-mints a secret for every existing and future tenant row, so no
-- backfill or app-side generation is needed. Apply after 0003_billing.sql.

alter table tenants
  add column if not exists webhook_secret text not null
    default replace(gen_random_uuid()::text, '-', '');

-- Unique so a secret resolves to exactly one tenant; indexed for the hot lookup
-- on every inbound webhook.
create unique index if not exists tenants_webhook_secret_idx on tenants (webhook_secret);

-- RLS is unchanged (inherited from 0001): no anon/authenticated policy, so only
-- the service role (the server) ever reads webhook_secret. It is never returned
-- to the browser — the Settings/masked routes don't select it.
