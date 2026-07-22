// Client for the Pipedrive write integration, via the Node proxy (/api/pipedrive/*).
// Uses the shared authed-POST client (api.js): both auth modes work and demo mode
// routes to /api/demo/pipedrive/* (simulated — never a real CRM write).
import { postJson } from './api.js'

const call = (action, body = {}) => postJson(`pipedrive/${action}`, body)

export const pdStatus = () => call('status')
export const pdSyncBroker = (broker) => call('broker', { broker })
export const pdPushLead = (prop) => call('lead', { prop })
export const pdPushLeads = (props) => call('leads', { props })
