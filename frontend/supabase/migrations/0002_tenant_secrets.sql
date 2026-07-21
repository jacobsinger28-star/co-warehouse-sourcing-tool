-- 0002_tenant_secrets.sql — BYOK secret layer (Phase 1)
--
-- Per-tenant provider credentials, envelope-encrypted at rest. Two-tier crypto so
-- a database dump alone leaks nothing:
--   * KEK (master key) lives ONLY in Railway env SECRETS_KEK — never in Postgres.
--   * DEK (per-tenant) is random, wrapped by the KEK, stored on the tenant row.
--   * Each secret field is encrypted with its tenant's DEK.
-- Decryption happens only in the server's SecretResolver (secrets.mjs). Offboarding
-- a tenant = drop its dek_wrapped (crypto-shred: every secret becomes undecryptable).
--
-- Ciphertext is stored base64 in TEXT columns (not bytea) so it round-trips cleanly
-- over PostgREST/JSON. Apply after 0001_tenants.sql.

-- Per-tenant DEK, wrapped by the active KEK. Null until the tenant first stores a secret.
alter table tenants
  add column if not exists dek_wrapped text,          -- base64(iv|ciphertext|tag) of the 32-byte DEK
  add column if not exists kek_version int not null default 1;

create table if not exists tenant_secrets (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  provider    text not null,   -- 'crm.pipedrive' | 'dialer.phoneburner' | 'llm.anthropic' | ...
  field       text not null,   -- 'api_token' | 'domain' | 'access_token' | 'client_id' | ...
  ciphertext  text not null,   -- base64(iv|ciphertext|tag), encrypted with the tenant DEK
  auth_model  text not null default 'static',  -- 'static' | 'oauth2' | 'basic'
  expires_at  timestamptz,     -- oauth2 access-token expiry; null otherwise
  meta        jsonb not null default '{}',     -- NON-secret only: health, last_validated_at, scopes
  rotated_at  timestamptz not null default now(),
  primary key (tenant_id, provider, field)
);

-- RLS = defense-in-depth, same posture as 0001: no anon/authenticated policy, so
-- only the service role (the server) can read ciphertext. A DB dump is inert without
-- the KEK, and the anon key can't even enumerate rows.
alter table tenant_secrets enable row level security;
