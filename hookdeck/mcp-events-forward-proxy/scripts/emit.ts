import { parseArgs } from 'node:util';
import { loadEnv } from '../src/shared/env.js';

/*
 * Reports a new error on the stand-in sender, which delivers `error.detected`
 * to every matching subscription. Without --title, it uses the next sample error.
 *
 *   npm run emit
 *   npm run emit -- --title "TypeError: x is undefined" --culprit "src/app.ts in main" --level fatal
 *   npm run emit -- --duplicate        # same webhook-id twice, re-signed
 *   npm run emit -- --bad-signature    # signed with a secret the receiver doesn't know
 */

loadEnv();
const { values } = parseArgs({
  options: {
    title: { type: 'string' },
    culprit: { type: 'string' },
    level: { type: 'string' },
    duplicate: { type: 'boolean', default: false },
    'bad-signature': { type: 'boolean', default: false },
  },
});

const base = (process.env.SENDER_MCP_URL || 'http://localhost:3100/mcp').replace(/\/mcp$/, '');
const response = await fetch(`${base}/demo/errors`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.SENDER_TOKEN || 'demo-sender-token'}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: values.title, culprit: values.culprit, level: values.level, duplicate: values.duplicate, badSignature: values['bad-signature'] }),
});
console.log(JSON.stringify(await response.json(), null, 2));
