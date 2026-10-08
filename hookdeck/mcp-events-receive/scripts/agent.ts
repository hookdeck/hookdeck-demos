import { parseArgs } from 'node:util';
import { loadEnv } from '../src/shared/env.js';

/*
 * Talks to the agent's demo endpoints.
 *
 *   npm run agent:status          # subscription, counters, handled events
 *   npm run agent:fail            # answer 503 to every delivery (Event Gateway holds and retries)
 *   npm run agent:fail -- --off   # back to normal
 */

loadEnv();
const { positionals, values } = parseArgs({ allowPositionals: true, options: { off: { type: 'boolean', default: false } } });
const base = (process.env.AGENT_URL || process.env.AGENT_PUBLIC_URL || `http://localhost:${process.env.AGENT_PORT || 3200}`).replace(/\/$/, '');
const headers = { Authorization: `Bearer ${process.env.AGENT_TOKEN || 'demo-agent-token'}`, 'Content-Type': 'application/json' };

const command = positionals[0] ?? 'status';
const response =
  command === 'fail'
    ? await fetch(`${base}/demo/fail`, { method: 'POST', headers, body: JSON.stringify({ failing: !values.off }) })
    : await fetch(`${base}/demo/status`, { headers });
console.log(JSON.stringify(await response.json(), null, 2));
