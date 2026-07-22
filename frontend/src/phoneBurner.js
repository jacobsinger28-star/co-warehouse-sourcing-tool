// Client for the PhoneBurner integration, via the Node proxy (/api/phoneburner/*).
// Uses the shared authed-POST client (api.js): both auth modes work and demo
// mode is routed to /api/demo/phoneburner/* automatically.
import { postJson } from './api.js'

const call = (action, body = {}) => postJson(`phoneburner/${action}`, body)

export const pbStatus = () => call('status')
export const pbPush = (contacts) => call('push', { contacts })
export const pbDial = (contactIds) => call('dial', { contactIds })
export const pbRecent = () => call('recent')
