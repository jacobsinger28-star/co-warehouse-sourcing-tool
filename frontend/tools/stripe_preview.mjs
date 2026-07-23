// tools/stripe_preview.mjs — open the REAL Stripe-hosted pages a client sees,
// without standing up the whole app. Reuses billing.mjs's createCheckout /
// createPortalSession — the exact code /api/tenant/billing/* runs — so the page
// this prints is byte-for-byte what the app redirects a client to.
//
// One-time setup (all free — TEST mode moves no real money):
//   1. Create a Stripe account, flip to Test mode (toggle, top-right of the dashboard).
//   2. Products → add "Starter" ($149/mo recurring) and "Pro" ($399/mo) → copy each
//      price id (price_…).
//   3. Developers → API keys → copy the test secret key (sk_test_…).
//   4. Put them in frontend/.env.stripe (gitignored):
//        STRIPE_SECRET_KEY=sk_test_…
//        STRIPE_PRICE_STARTER=price_…
//        STRIPE_PRICE_PRO=price_…
// Then:
//   node tools/stripe_preview.mjs checkout starter     → a checkout URL
//   node tools/stripe_preview.mjs checkout pro
//   node tools/stripe_preview.mjs portal cus_XXXX      → a Customer Portal URL
// Open the printed URL in a browser. Test card: 4242 4242 4242 4242, any future
// expiry, any CVC, any ZIP.

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Load frontend/.env.stripe into process.env (simple KEY=VALUE, does not override
// anything already exported).
const here = dirname(fileURLToPath(import.meta.url))
const envPath = join(here, '..', '.env.stripe')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && !line.trim().startsWith('#') && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const { createCheckout, createPortalSession, billingEnabled, PLANS } = await import('../billing.mjs')

const APP = 'http://localhost:5173'

async function main() {
  const [cmd, arg] = process.argv.slice(2)
  const key = process.env.STRIPE_SECRET_KEY || ''
  if (!billingEnabled() || key.includes('REPLACE_ME')) {
    console.error('✗ STRIPE_SECRET_KEY is not set yet — edit frontend/.env.stripe and replace the REPLACE_ME values (see that file\'s header).')
    process.exit(1)
  }
  if (!key.startsWith('sk_test_')) console.error('⚠ warning: not an sk_test_ key — use TEST mode so no real charges are made.\n')
  if (cmd === 'checkout') {
    const plan = arg || 'starter'
    if (!PLANS[plan]?.priceEnv) {
      console.error(`✗ '${plan}' is not a purchasable plan. Try: ${Object.keys(PLANS).filter((p) => PLANS[p].priceEnv).join(', ')}`)
      process.exit(1)
    }
    const { url } = await createCheckout({ id: 'preview-tenant' }, plan, {
      successUrl: `${APP}/?billing=success`, cancelUrl: `${APP}/?billing=canceled`,
    })
    console.log(`\n✓ ${PLANS[plan].label} ($${PLANS[plan].priceMonthly}/mo) — Stripe test checkout. Open in a browser:\n${url}\n`)
  } else if (cmd === 'portal') {
    if (!arg) { console.error('✗ usage: node tools/stripe_preview.mjs portal <stripe_customer_id>  (a cus_… id from a completed test checkout)'); process.exit(1) }
    const { url } = await createPortalSession({ id: 'preview-tenant', stripe_customer_id: arg }, { returnUrl: `${APP}/?billing=managed` })
    console.log(`\n✓ Customer Portal (test mode) for ${arg}. Open in a browser:\n${url}\n`)
  } else {
    console.error('usage: node tools/stripe_preview.mjs checkout [starter|pro]   |   portal <cus_id>')
    process.exit(1)
  }
}
main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1) })
