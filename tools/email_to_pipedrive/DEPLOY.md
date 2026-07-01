# Deploy the watcher to Railway (always-on, hands-off)

Goal: Andrew forwards a broker email with `#pipedrive` → it's in Pipedrive a
couple minutes later, with nobody starting anything. The watcher runs 24/7 on
Railway (`graph_watch.py --live --loop 30`).

These steps need your Railway login, so **you run them** — I can't sign into
your Railway account. It's ~5 commands.

## Prereqs
- A Railway account + `npm i -g @railway/cli` (or use the Railway dashboard).
- You've already done the one-time Graph sign-in locally, so
  `.graph_token_cache.json` exists in this folder (it holds the refresh token).

## 1. Create the service
```bash
cd tools/email_to_pipedrive
railway init            # or link to an existing project: railway link
```
In the service **Settings**, set **Root Directory** to
`tools/email_to_pipedrive` so Railway builds just this tool. `railway.json` here
sets the start command and `restartPolicyType: ALWAYS`.

## 2. Set the secrets (values never leave your machine)
```bash
railway variables --set "PIPEDRIVE_API_TOKEN=<your pipedrive token>"
railway variables --set "GRAPH_TOKEN_CACHE=$(cat .graph_token_cache.json)"   # the cached refresh token
railway variables --set "ANTHROPIC_API_KEY=<your claude key>"                # optional, richer extraction
```
`GRAPH_CLIENT_ID` / `GRAPH_AUTHORITY` are baked into the code as defaults, so
you don't need to set them unless you re-register the app.

## 3. Deploy
```bash
railway up
```
Watch it: `railway logs` — you'll see `[To Pipedrive] N message(s), M new` and
`created: <broker>` lines as forwards come in.

## Notes
- **Token lifetime:** the refresh token auto-renews on use, so a continuously
  running service stays signed in. Railway's filesystem resets on each redeploy,
  which re-seeds from `GRAPH_TOKEN_CACHE`; if a redeploy ever hits an auth error,
  re-run the one-time local sign-in and update the `GRAPH_TOKEN_CACHE` variable.
  For zero-maintenance, attach a Railway **Volume** mounted at this folder so the
  rotated token persists across redeploys.
- **Read-only:** the app only has Mail.Read — it can read your mailbox, nothing
  else. Pipedrive writes go through your Pipedrive token.
- **Change the keyword** anytime in the Outlook rule; the watcher is
  folder-driven and doesn't care what it is.
