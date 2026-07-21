-- 0001_tenants.sql — multi-tenant identity boundary (Phase 0)
--
-- Introduces the tenant concept the app has never had. Until the server is given
-- SUPABASE_SERVICE_ROLE_KEY, requireAuth ignores these tables and keeps using the
-- legacy global ALLOWED_EMAILS allowlist, so applying this migration alone changes
-- nothing at runtime. Flip tenancy on only AFTER seeding tenant-1 (see
-- tools/seed_tenant.mjs) so today's users keep their access via membership.
--
-- Apply: Supabase Dashboard → SQL editor (paste this file), or the Supabase CLI
-- (`supabase db push`). These live in the `public` schema on purpose: the Express
-- server reaches them through PostgREST with the service-role key, which requires
-- an exposed schema. RLS (below) keeps the anon key and any user JWT out.

create table if not exists tenants (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,            -- stable machine name, e.g. 'simicapital'
  name        text not null,                   -- display name shown in the UI
  status      text not null default 'active',  -- active | suspended
  deployment  text not null default 'shared',  -- shared | dedicated (future clone tier)
  created_at  timestamptz not null default now()
);

-- Membership drives who reaches which tenant. `email` holds EITHER an exact
-- address ('raz@x.com') OR a whole-domain wildcard ('@simicap.com'), mirroring the
-- semantics of the old ALLOWED_EMAILS env var so tenant-1 seeds 1:1 from it. The
-- resolver prefers an exact match over a domain match.
create table if not exists tenant_members (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  email       text not null,                   -- lowercased 'a@b.com' OR '@b.com'
  role        text not null default 'member',  -- owner | admin | member | viewer
  created_at  timestamptz not null default now(),
  primary key (tenant_id, email)
);
create index if not exists tenant_members_email_idx on tenant_members (email);

-- RLS = defense-in-depth. The server uses the service-role key, which BYPASSES RLS
-- and enforces tenant scoping in application code. Enabling RLS with no anon/
-- authenticated policy means a direct hit with the public anon key or a user JWT
-- reads NOTHING here — so a leaked anon key can't enumerate tenants or members. A
-- later phase may add membership-scoped SELECT policies if we ever expose these
-- tables to the browser directly; today nothing does.
alter table tenants        enable row level security;
alter table tenant_members enable row level security;
