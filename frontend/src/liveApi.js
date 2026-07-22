// Client for the live-scrape service, via the Node proxy (/api/live/*).
// Uses the shared authed-POST client (api.js): both auth modes work and demo
// mode is routed to /api/demo/live/* automatically.
import { postJson } from './api.js'

const call = (action, body = {}) => postJson(`live/${action}`, body)

export const liveScrape = (opts = {}) => call('scrape', opts)
export const liveStop = () => call('stop')
export const liveStatus = () => call('status')
export const liveRows = () => call('rows')
