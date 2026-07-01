#!/usr/bin/env node
/*
 * encrypt_data.mjs — encrypt the real-data export so it can ride along on a PUBLIC
 * static deploy as ciphertext (the browser decrypts it with the gate password).
 *
 *   DASHBOARD_PASSWORD='…' node tools/encrypt_data.mjs [in=public/data.real.json] [out=public/data.enc.json]
 *
 * AES-256-GCM, key via PBKDF2-SHA256 (250k iters, random salt), random IV, 16-byte
 * auth tag appended to the ciphertext (what Web Crypto's AES-GCM expects). Output is
 * {v,iter,salt,iv,ct} — NO plaintext / no owner PII. Mirrors the proven scheme in
 * ../../offmarket-scraping/tools/lock_html.js so the browser side (src/crypto.js) matches.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'

const ITER = 250000
const inPath = process.argv[2] || 'public/data.real.json'
const outPath = process.argv[3] || 'public/data.enc.json'
// No hardcoded default — a committed password is a public password. Fails LOUDLY
// (not a silent skip) so a forgotten env var can't quietly ship stale/sample data.
const password = process.env.DASHBOARD_PASSWORD
if (!password) {
  console.error(
    '\n⛔ DASHBOARD_PASSWORD is not set — nothing was encrypted.\n' +
    '   Re-run with the gate password, e.g.:\n\n' +
    "     DASHBOARD_PASSWORD='SimiCap1170!' node tools/encrypt_data.mjs\n"
  )
  process.exit(2)
}
if (!fs.existsSync(inPath)) {
  console.error(`input not found: ${inPath}`)
  process.exit(2)
}

const plaintext = fs.readFileSync(inPath)
const salt = crypto.randomBytes(16)
const iv = crypto.randomBytes(12)
const key = crypto.pbkdf2Sync(password, salt, ITER, 32, 'sha256')
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
const ct = Buffer.concat([cipher.update(plaintext), cipher.final()])
const tag = cipher.getAuthTag()
const blob = Buffer.concat([ct, tag]) // Web Crypto expects the tag appended

const ENC = {
  v: 1,
  iter: ITER,
  salt: salt.toString('base64'),
  iv: iv.toString('base64'),
  ct: blob.toString('base64'),
}
fs.writeFileSync(outPath, JSON.stringify(ENC))
const kb = Math.round(fs.statSync(outPath).size / 1024)
console.log(`encrypted ${inPath} -> ${outPath} (${kb} KB, AES-256-GCM, ${ITER} PBKDF2 iters) — plaintext PII not present`)
