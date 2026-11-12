/**
 * One command to wire the whole demo. Idempotent: safe to run again.
 *
 * Hookdeck (project for HOOKDECK_API_KEY), per client:
 *   source (type VAPI, HMAC verification on) -> connection -> CLI destination (the client's route)
 * Vapi (account for VAPI_API_KEY):
 *   one HMAC custom credential, one async function tool, one assistant per client whose
 *   Server URL is that client's Hookdeck source URL
 *
 * Writes the Source URLs, IDs and the generated signing secret to .env.
 */
import 'dotenv/config';
import * as crypto from 'crypto';
import { CLIENTS, Client } from '../src/clients';
import { createHookdeckCli } from './hookdeck-cli';
import { writeEnv } from './env-file';
import { vapi, requireVapiKey } from './vapi-api';

const CREDENTIAL_NAME = 'hookdeck-demo-hmac';
const TOOL_NAME = 'lookup_customer';
// Set VAPI_SIGNATURE_PREFIX=sha256= to have Vapi send `sha256=<hex>` instead of the bare hex digest
const SIGNATURE_PREFIX = process.env.VAPI_SIGNATURE_PREFIX || '';
// Set TRIM_PAYLOAD=true to have Hookdeck strip system prompts from payloads after verification
const TRIM_PAYLOAD = process.env.TRIM_PAYLOAD === 'true';
const MODEL = { provider: 'openai', model: process.env.VAPI_MODEL || 'gpt-4o' };

// Production would use a longer interval (and more attempts). Short here so a retry is visible in the drawer.
const RETRY_RULES = [{ type: 'retry', strategy: 'exponential', count: 4, interval: 10000 }];

const cli = createHookdeckCli();

async function setupHookdeck(client: Client, secret: string): Promise<string> {
  const destination = cli.upsertCliDestination({ name: client.destination, path: client.path });
  // Verification (`auth`) is applied through the API by upsertSource: the CLI's --source-config
  // ignores VAPI auth settings silently, which leaves verification off.
  const source = await cli.upsertSource({
    name: client.source,
    type: 'VAPI',
    config: { trim_payload: TRIM_PAYLOAD },
    auth: { webhook_secret_key: secret, algorithm: 'sha256', encoding: 'hex', header_key: 'x-signature' },
  });
  const connection = cli.upsertConnection({
    name: client.source,
    sourceId: source.id,
    destinationId: destination.id,
    // Event Gateway answers Vapi at once, then delivers to the app. If the app answers 5xx or is down, retry
    // with short demo intervals: attempt #2 after about 10s, #3 after 20s, #4 after 40s, #5 after 80s.
    rules: RETRY_RULES,
  });
  if (connection.destination.id !== destination.id) {
    console.error(`Connection ${client.source} points at destination ${connection.destination.name}, not ${client.destination}.`);
    console.error(`A connection's destination can't be changed. Delete it and run this script again:`);
    console.error(`  hookdeck gateway connection delete ${connection.id} --force`);
    process.exit(1);
  }
  console.log(`Hookdeck ${client.name}: ${source.url} -> ${client.path} (verification: ${source.auth_type ?? 'set'})`);
  return source.url;
}

async function upsertByName(list_path: string, name_of: (x: any) => string, name: string, create: () => Promise<any>, update: (id: string) => Promise<any>): Promise<any> {
  const existing = ((await vapi('GET', list_path)) as any[]).find((x) => name_of(x) === name);
  return existing ? update(existing.id) : create();
}

async function setupVapi(secret: string, urls: { [slug: string]: string }) {
  // 1. HMAC custom credential. Hookdeck's VAPI source verifies an HMAC of the raw body, so the
  //    payload format is `{body}` and the timestamp is left out of the signed content.
  const authentication_plan: any = {
    type: 'hmac',
    secretKey: secret,
    algorithm: 'sha256',
    signatureHeader: 'x-signature',
    signatureEncoding: 'hex',
    includeTimestamp: false,
    payloadFormat: '{body}',
  };
  if (SIGNATURE_PREFIX) authentication_plan.signaturePrefix = SIGNATURE_PREFIX;
  const credential_body = { provider: 'custom-credential', name: CREDENTIAL_NAME, authenticationPlan: authentication_plan };
  const credential = await upsertByName(
    '/credential', (x) => x.name, CREDENTIAL_NAME,
    () => vapi('POST', '/credential', credential_body),
    (id) => vapi('PATCH', `/credential/${id}`, { name: CREDENTIAL_NAME, authenticationPlan: authentication_plan }),
  );
  console.log(`Vapi credential ${CREDENTIAL_NAME}: ${credential.id}`);

  // 2. One async function tool with no server of its own: tool-calls go to the Server URL of
  //    the assistant making the call, so each client's calls reach that client's source.
  const tool_body = {
    type: 'function',
    async: true,
    function: {
      name: TOOL_NAME,
      description: 'Look up a customer in the business CRM by name. Runs in the background; the result is added to the conversation a few seconds later.',
      parameters: {
        type: 'object',
        properties: { customer_name: { type: 'string', description: 'The caller\'s full name' } },
        required: ['customer_name'],
      },
    },
  };
  const tool = await upsertByName(
    '/tool', (x) => x.function?.name, TOOL_NAME,
    () => vapi('POST', '/tool', tool_body),
    (id) => vapi('PATCH', `/tool/${id}`, { async: true, function: tool_body.function }),
  );
  console.log(`Vapi tool ${TOOL_NAME} (async): ${tool.id}`);

  // 3. One assistant per client
  const ids: { [key: string]: string } = {};
  for (const client of CLIENTS) {
    const assistant_body = {
      name: client.assistant_name,
      firstMessage: client.first_message,
      model: { ...MODEL, messages: [{ role: 'system', content: client.system_prompt }], toolIds: [tool.id] },
      voice: { provider: 'vapi', voiceId: 'Elliot' },
      server: { url: urls[client.slug], credentialId: credential.id, timeoutSeconds: 20 },
      serverMessages: ['status-update', 'end-of-call-report', 'tool-calls'],
      monitorPlan: { controlEnabled: true, listenEnabled: false },
    };
    const assistant = await upsertByName(
      '/assistant', (x) => x.name, client.assistant_name,
      () => vapi('POST', '/assistant', assistant_body),
      (id) => vapi('PATCH', `/assistant/${id}`, assistant_body),
    );
    ids[client.env_assistant_id] = assistant.id;
    console.log(`Vapi assistant ${client.assistant_name}: ${assistant.id}`);
  }
  return { ids, credential_id: credential.id, tool_id: tool.id };
}

async function main() {
  requireVapiKey();
  cli.login();
  console.log((cli.whoami() || '') + '\n');

  const secret = process.env.VAPI_WEBHOOK_SECRET && !process.env.VAPI_WEBHOOK_SECRET.startsWith('your_')
    ? process.env.VAPI_WEBHOOK_SECRET
    : crypto.randomBytes(32).toString('hex');

  const env: { [key: string]: string } = { VAPI_WEBHOOK_SECRET: secret };
  const urls: { [slug: string]: string } = {};
  for (const client of CLIENTS) {
    urls[client.slug] = await setupHookdeck(client, secret);
    env[client.env_source_url] = urls[client.slug];
  }
  console.log('');
  const vapi_result = await setupVapi(secret, urls);
  Object.assign(env, vapi_result.ids, { VAPI_HMAC_CREDENTIAL_ID: vapi_result.credential_id, VAPI_TOOL_ID: vapi_result.tool_id });

  console.log('');
  writeEnv(env);
  console.log('\nNext:\n  npm run listen\n  npm start\nThen talk to either assistant in the Vapi dashboard (see README).');
}

main().catch((error: any) => {
  console.error('Setup failed:', error.stderr?.toString().trim() || error.message);
  process.exit(1);
});
