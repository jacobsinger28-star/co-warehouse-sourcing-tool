#!/usr/bin/env node
/*
 * verify_lock.js — assert that a locked HTML page actually opens with a given password.
 *
 *   node tools/verify_lock.js <locked.html> <password>
 *
 * Extracts the embedded AES-256-GCM blob and decrypts it exactly the way the browser's
 * Web Crypto path does (PBKDF2-SHA256 -> AES-256-GCM). Exit 0 + "OK" if the password opens
 * the file; exit 1 + "FAIL" if GCM authentication fails (wrong password). This is the guard
 * that catches a page locked with the WRONG DASHBOARD_PASSWORD *before* it ships — the bug
 * that silently locked colleagues out of the live table on 2026-06-19 (see docs/BUILD_LOG.md).
 *
 * Pairs with tools/lock_html.js (the encryptor). Run via `make verify-locks` over the whole
 * deploy dir, or directly on a single file.
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');

const [, , file, password] = process.argv;
if (!file || password === undefined) {
  console.error('usage: node tools/verify_lock.js <locked.html> <password>');
  process.exit(2);
}

const html = fs.readFileSync(file, 'utf8');
const m = html.match(/const ENC=(\{.*?\});/s);
if (!m) { console.error(`FAIL ${file}: no encrypted blob found (not a locked file?)`); process.exit(3); }

const ENC = JSON.parse(m[1]);
const salt = Buffer.from(ENC.salt, 'base64');
const iv = Buffer.from(ENC.iv, 'base64');
const blob = Buffer.from(ENC.ct, 'base64');           // ciphertext || 16-byte GCM tag
const ct = blob.subarray(0, blob.length - 16);
const tag = blob.subarray(blob.length - 16);
const key = crypto.pbkdf2Sync(password, salt, ENC.iter, 32, 'sha256');

try {
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  const pt = Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  const looksHtml = /<html|<!DOCTYPE|<table|<body/i.test(pt);
  if (!looksHtml) { console.error(`FAIL ${file}: decrypted but content is not HTML`); process.exit(4); }
  console.log(`OK ${file}: opens with password (${pt.length} bytes, iter=${ENC.iter})`);
  process.exit(0);
} catch (e) {
  console.error(`FAIL ${file}: wrong password (GCM auth failed)`);
  process.exit(1);
}
