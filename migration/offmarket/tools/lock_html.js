#!/usr/bin/env node
/*
 * lock_html.js — wrap a finished HTML file in a client-side password gate by ENCRYPTING it.
 *
 *   DASHBOARD_PASSWORD='your passphrase' node tools/lock_html.js in.html out.html
 *
 * The output is a tiny self-contained page: a password box + the input HTML encrypted with
 * AES-256-GCM (key derived from the password via PBKDF2-SHA256, 250k iterations, random salt).
 * The plaintext (and the owner PII inside it) is NEVER in the output — only ciphertext — so the
 * file is safe to email or host on ANY static host (no server, no Vercel plan, no middleware).
 * The correct password decrypts it in the browser and renders it in an iframe; a wrong password
 * gets nothing (GCM auth fails). Same approach as the well-known "StatiCrypt" tool.
 *
 * The encryptor is written in JS on purpose: it must match the browser's Web Crypto decryption
 * exactly, so keeping both sides in one language avoids interop bugs. Verify with Node's own
 * crypto.webcrypto (see tools/ verification) — that's the same API the browser uses.
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');

const ITER = 250000;
const [, , inPath, outPath] = process.argv;
const password = process.env.DASHBOARD_PASSWORD;

if (!inPath || !outPath) {
  console.error('usage: DASHBOARD_PASSWORD=... node tools/lock_html.js <in.html> <out.html>');
  process.exit(2);
}
if (!password) {
  console.error('refusing to lock: set the DASHBOARD_PASSWORD env var (kept out of argv/history)');
  process.exit(2);
}

const plaintext = fs.readFileSync(inPath);
const salt = crypto.randomBytes(16);
const iv = crypto.randomBytes(12);
const key = crypto.pbkdf2Sync(password, salt, ITER, 32, 'sha256');
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const tag = cipher.getAuthTag();
// Web Crypto's AES-GCM expects the 16-byte tag appended to the ciphertext.
const blob = Buffer.concat([ct, tag]);

const ENC = {
  v: 1, iter: ITER,
  salt: salt.toString('base64'),
  iv: iv.toString('base64'),
  ct: blob.toString('base64'),
};

const WRAP = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Protected — enter password</title>
<style>
:root{--ink:#1a1a18;--mut:#6b6a64;--line:#e4e2da;--bg:#faf9f5;--card:#fff;--teal:#0f6e56;--red:#a32d2d}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;font:14px/1.55 -apple-system,'Segoe UI',sans-serif;color:var(--ink);background:var(--bg);
display:flex;align-items:center;justify-content:center}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:26px 26px 22px;
width:340px;max-width:92vw;box-shadow:0 1px 3px rgba(0,0,0,.04)}
h1{font-size:16px;margin:0 0 3px}.sub{color:var(--mut);font-size:12.5px;margin:0 0 16px}
label{display:block;font-size:12px;color:var(--mut);margin:0 0 5px}
input{width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:8px;font-size:14px;background:#fff}
button{margin-top:12px;width:100%;padding:9px;border:0;border-radius:8px;background:var(--teal);color:#fff;
font-size:14px;font-weight:600;cursor:pointer}button:disabled{opacity:.6;cursor:default}
.err{color:var(--red);font-size:12.5px;margin-top:10px;min-height:16px}
.lock{font-size:22px}.note{color:var(--mut);font-size:11px;margin-top:14px;line-height:1.5}
iframe{position:fixed;inset:0;width:100%;height:100%;border:0;background:#faf9f5}
</style></head><body>
<div class="card" id="gate">
<div class="lock">🔒</div>
<h1>Protected file</h1>
<div class="sub">Enter the password to view this dashboard.</div>
<form id="f"><label for="pw">Password</label>
<input id="pw" type="password" autocomplete="current-password" autofocus>
<button id="go" type="submit">Unlock</button></form>
<div class="err" id="err"></div>
<div class="note">Owner PII — internal, do not publish. This file is encrypted; the data
cannot be read without the password (View&nbsp;Source shows only ciphertext).</div>
</div>
<script>
const ENC=__ENC__;
const b64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const gate=document.getElementById('gate'),errEl=document.getElementById('err'),go=document.getElementById('go');
async function unlock(pw){
  const subtle=(window.crypto&&window.crypto.subtle);
  if(!subtle)throw new Error('This browser context can\\'t decrypt. Open the file in Chrome, Firefox or Safari (or over https).');
  const base=await subtle.importKey('raw',new TextEncoder().encode(pw),{name:'PBKDF2'},false,['deriveKey']);
  const key=await subtle.deriveKey({name:'PBKDF2',salt:b64(ENC.salt),iterations:ENC.iter,hash:'SHA-256'},
    base,{name:'AES-GCM',length:256},false,['decrypt']);
  const buf=await subtle.decrypt({name:'AES-GCM',iv:b64(ENC.iv)},key,b64(ENC.ct));
  return new TextDecoder().decode(buf);
}
document.getElementById('f').addEventListener('submit',async e=>{
  e.preventDefault();errEl.textContent='';go.disabled=true;go.textContent='Decrypting…';
  try{
    const html=await unlock(document.getElementById('pw').value);
    const ifr=document.createElement('iframe');
    document.body.innerHTML='';document.body.appendChild(ifr);ifr.srcdoc=html;
  }catch(ex){
    errEl.textContent=(ex&&ex.message&&!/operation/i.test(ex.message))?ex.message:'Wrong password — try again.';
    go.disabled=false;go.textContent='Unlock';
  }
});
</script></body></html>`;

const out = WRAP.replace('__ENC__', JSON.stringify(ENC));
fs.writeFileSync(outPath, out);
const kb = Math.round(Buffer.byteLength(out) / 1024);
console.log(`locked: ${outPath} (${kb} KB, AES-256-GCM, ${ITER} PBKDF2 iters) — plaintext PII not present`);
