import { loadEnv, requireEnv } from '../src/shared/env.js';
import { HookdeckApi } from '../src/agent/hookdeck.js';
import { findEndpoints, releaseEndpoint } from '../src/agent/proxy.js';

/*
 * Deletes every source, connection and destination the agent created (by name
 * prefix), for example after an agent was killed without cleaning up. It does
 * not unsubscribe: the sender's subscriptions expire on their own.
 */

loadEnv();
const api = new HookdeckApi(requireEnv('HOOKDECK_API_KEY'), process.env.HOOKDECK_API_BASE || undefined);
const prefix = process.env.AGENT_NAME || 'mcp-events-agent';
const endpoints = await findEndpoints(api, prefix);
for (const endpoint of endpoints) {
  await releaseEndpoint(api, endpoint);
  console.log(`deleted ${endpoint.connectionId} and source ${endpoint.sourceId}`);
}
console.log(`${endpoints.length} endpoint(s) removed`);
