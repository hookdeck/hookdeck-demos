import { parseArgs } from 'node:util';
import { loadEnv } from '../src/shared/env.js';

/*
 * Opens an incident on the stand-in sender, which delivers `incident.created`
 * to every matching subscription.
 *
 *   npm run emit -- --severity P1 --title "Database connection pool exhausted"
 *   npm run emit -- --duplicate        # same webhook-id twice, re-signed
 *   npm run emit -- --bad-signature    # signed with a secret the receiver doesn't know
 */

loadEnv();
const { values } = parseArgs({
  options: {
    severity: { type: 'string', default: 'P2' },
    title: { type: 'string' },
    duplicate: { type: 'boolean', default: false },
    'bad-signature': { type: 'boolean', default: false },
  },
});

const base = (process.env.SENDER_MCP_URL || 'http://localhost:3100/mcp').replace(/\/mcp$/, '');
const response = await fetch(`${base}/demo/incidents`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.SENDER_TOKEN || 'demo-sender-token'}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ severity: values.severity, title: values.title, duplicate: values.duplicate, badSignature: values['bad-signature'] }),
});
console.log(JSON.stringify(await response.json(), null, 2));
