-- 0003_billing.sql — billing skeleton (plan + Stripe linkage + usage metering)
--
-- Adds the billing state a tenant needs before any money moves:
--   * plan/billing_status columns on tenants — which tier the workspace is on.
--   * Stripe linkage columns — filled in by the checkout/webhook flow, null until
--     Stripe is actually wired live (STRIPE_SECRET_KEY on the server).
--   * usage_events — append-only meter for per-tenant consumption (today: metered
--     Deals-AI calls when a tenant runs on SimiCapital's Anthropic key instead of
--     bringing their own). Summed per month by billing.mjs, never updated in place.
--
-- Applying this migration alone changes nothing at runtime: every column defaults
-- to the free-trial state and the server only reads them once billing routes are
-- called. Apply after 0002_tenant_secrets.sql.

alter table tenants
  add column if not exists plan                   text not null default 'trial',    -- 'trial' | 'starter' | 'pro'
  add column if not exists billing_status         text not null default 'trialing', -- 'trialing' | 'active' | 'past_due' | 'canceled'
  add column if not exists stripe_customer_id     text,
  add column if not exists stripe_subscription_id text,
  add column if not exists current_period_end     timestamptz;

create table if not exists usage_events (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  kind        text not null,                  -- 'llm.deals_chat' | future meters
  qty         numeric not null default 1,
  meta        jsonb not null default '{}',    -- NON-sensitive context (model id, route)
  created_at  timestamptz not null default now()
);
create index if not exists usage_events_tenant_time_idx on usage_events (tenant_id, created_at);

-- RLS = defense-in-depth, same posture as 0001/0002: no anon/authenticated policy,
-- so only the service role (the server) touches billing state and usage.
alter table usage_events enable row level security;
