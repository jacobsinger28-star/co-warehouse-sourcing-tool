#!/usr/bin/env node
// seed_secret.mjs — encrypt + store one provider credential for a tenant.
//
// Used at rollout to migrate SimiCapital's current env-var keys into tenant_secrets
// once it becomes a real tenant, and any time you need to set a key from the CLI.
// The VALUE is read from an env var (--from-env), never passed on argv, so it never
// lands in shell history or `ps` output.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SECRETS_KEK=… \
//   PIPEDRIVE_API_TOKEN='…' \
//     node tools/seed_secret.mjs --tenant simicapital \
//       --provider crm.pipedrive --field api_token --from-env PIPEDRIVE_API_TOKEN
//
// --tenant accepts a slug ('simicapital') or a tenant uuid. --auth-model defaults
// to 'static' (use 'oauth2' / 'basic' for those providers).
import { parseArgs } from 'node:util'
import { tenancyEnabled, dbSelect } from '../db.mjs'
import { secretsEnabled, writeSecret } from '../secrets.mjs'

const { values } = parseArgs({
  options: {
    tenant: { type: 'string' },
    provider: { type: 'string' },
    field: { type: 'string' },
    'from-env': { type: 'string' },
    'auth-model': { type: 'string', default: 'static' },
  },
})

if (!tenancyEnabled()) { console.error('⛔ set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY'); process.exit(2) }
if (!secretsEnabled()) { console.error('⛔ set SECRETS_KEK (base64 of 32 bytes)'); process.exit(2) }
if (!values.tenant || !values.provider || !values.field || !values['from-env']) {
  console.error('usage: node tools/seed_secret.mjs --tenant <slug|id> --provider <p> --field <f> --from-env <ENV_VAR> [--auth-model static|oauth2|basic]')
  process.exit(2)
}

const value = process.env[values['from-env']]
if (!value) { console.error(`⛔ env var ${values['from-env']} is empty — nothing to store`); process.exit(2) }

// Resolve a slug to its tenant id (a uuid is used as-is).
const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(values.tenant)
let tenantId = values.tenant
if (!isUuid) {
  const rows = await dbSelect('tenants', `select=id&slug=eq.${encodeURIComponent(values.tenant)}&limit=1`)
  if (!rows.length) { console.error(`⛔ no tenant with slug '${values.tenant}' (seed it first with seed_tenant.mjs)`); process.exit(1) }
  tenantId = rows[0].id
}

await writeSecret(tenantId, values.provider, values.field, value, { authModel: values['auth-model'] })
console.log(`✓ stored ${values.provider}/${values.field} for tenant ${values.tenant} (value read from ${values['from-env']}, encrypted at rest)`)
