/**
 * Sets up both sides. Idempotent: safe to run multiple times.
 *
 *  1. Hookdeck: a RETELL source that verifies x-retell-signature with your Retell API
 *     key, a CLI destination, and a connection with a deduplicate rule and a retry rule.
 *  2. Retell: a Retell LLM (the prompt and tools) and a voice agent whose `webhook_url`
 *     is the Hookdeck source URL, so the account's own webhook setting stays untouched.
 *
 * Uses the project whose HOOKDECK_API_KEY is in .env, through the Hookdeck API
 * (see hookdeck-api.ts).
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { hookdeck, requireHookdeckApiKey } from './hookdeck-api';
const PROJECT_DIR = path.join(__dirname, '..');
import { RETELL_API_BASE } from '../src/config';

const ENV_FILE = path.join(PROJECT_DIR, '.env');
const ENV_EXAMPLE_FILE = path.join(PROJECT_DIR, '.env.example');

const RETELL_API_KEY = process.env.RETELL_API_KEY || '';
// Retell signs every webhook with the one API key that has the webhook badge. It can be a
// different key from RETELL_API_KEY; when it's the same key, RETELL_SECRET_KEY can be left empty.
const RETELL_SECRET_KEY = process.env.RETELL_SECRET_KEY || RETELL_API_KEY;
const WITH_FUNCTION = process.env.ENABLE_LIVE_INJECTION === 'true';

const fail = (message: string): never => {
  console.error(`❌ ${message}`);
  process.exit(1);
};

// ---------------------------------------------------------------- Hookdeck

interface Flow {
  name: string;
  cliPath: string;
  rules: object[];
}

const FLOWS: Flow[] = [
  {
    name: 'retell-call-events',
    cliPath: '/webhooks/retell',
    rules: [
      // Same event for the same call within 10 minutes is a duplicate. The API takes the window in milliseconds.
      { type: 'deduplicate', window: 600000, include_fields: ['body.event', 'body.call.call_id'] },
      // If the app is down or erroring, retry for about two hours (30s, 60s, 2m, 4m, ...)
      { type: 'retry', strategy: 'exponential', count: 8, interval: 30000 },
    ],
  },
];
if (WITH_FUNCTION) {
  FLOWS.push({
    name: 'retell-live-function',
    cliPath: '/webhooks/retell-function',
    // Not deduplicated: the agent can legitimately call the function more than once in a call
    rules: [{ type: 'retry', strategy: 'exponential', count: 3, interval: 30000 }],
  });
}

/**
 * Creates the flow's connection with the Hookdeck API, then turns on signature verification.
 * PUT /connections creates or updates the RETELL source, the CLI destination and the rules,
 * matched by name. PUT /sources sets the source's verification settings (config.auth).
 */
async function setupFlow(flow: Flow): Promise<string> {
  const connection = await hookdeck('PUT', '/connections', {
    name: flow.name,
    source: { name: flow.name, type: 'RETELL' },
    destination: { name: `local-${flow.name}`, type: 'CLI', config: { path: flow.cliPath } },
    rules: flow.rules,
  });
  // Retell signs every webhook with the API key that carries the webhook badge.
  await hookdeck('PUT', '/sources', {
    name: flow.name,
    type: 'RETELL',
    config: { auth: { webhook_secret_key: RETELL_SECRET_KEY } },
  });
  console.log(`✅ ${flow.name}: ${connection.source.url} -> local-${flow.name} (${flow.cliPath}), signature verification on`);
  return connection.source.url;
}

// ------------------------------------------------------------------ Retell

async function retell(method: string, route: string, body: unknown): Promise<any> {
  const response = await fetch(`${RETELL_API_BASE}${route}`, {
    method,
    headers: { Authorization: `Bearer ${RETELL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) fail(`Retell ${method} ${route} -> ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

const PROMPT = `You are Sam, a friendly assistant at Acme Realty. You are making an outbound call to a lead who just asked about a property on the Acme Realty website.

Lead name: {{lead_name}}
Property they asked about: {{property_interest}}
What they wrote on the form: {{lead_notes}}

Goals, in order:
1. Confirm you are speaking to {{lead_name}}. If someone else answers, say you'll try again later and end the call.
2. Ask whether now is a good time for a one-minute call. If not, apologise and end the call.
3. Confirm they are still interested in {{property_interest}}.
4. Ask for their rough budget and when they want to move.
5. Offer to book a viewing and ask which day suits them.
{{VIEWING_STEP}}
Keep replies short and natural, one question at a time. Never invent property details; if asked something you don't know, say a colleague will follow up. When the conversation is finished, thank them and end the call.`;

const LIVE_STEP = `6. When they name a day, call the check_viewing_slots function with that day, then keep chatting. The function runs in the background and its result arrives as extra context a few seconds later. When it does, offer those times.`;

const ANALYSIS = [
  { type: 'string', name: 'budget', description: 'The lead\'s budget, if they gave one. Empty if not discussed.' },
  { type: 'string', name: 'move_in_timeline', description: 'When the lead wants to move. Empty if not discussed.' },
  { type: 'boolean', name: 'viewing_requested', description: 'True if the lead agreed to or asked for a viewing.' },
  { type: 'string', name: 'preferred_viewing_time', description: 'The viewing day or time the lead preferred. Empty if none.' },
];

async function setupRetell(events_url: string, function_url: string | undefined): Promise<{ agent_id: string; llm_id: string }> {
  const general_tools: object[] = [{ type: 'end_call', name: 'end_call', description: 'End the call when the conversation is finished.' }];
  if (function_url) {
    general_tools.push({
      type: 'custom',
      name: 'check_viewing_slots',
      description: 'Look up available viewing slots for a day. Runs in the background; the result is added to the call a few seconds later.',
      url: function_url,
      method: 'POST',
      parameters: {
        type: 'object',
        properties: { preferred_day: { type: 'string', description: 'The day the lead prefers, for example "Tuesday".' } },
        required: ['preferred_day'],
      },
      speak_during_execution: false,
      speak_after_execution: false,
      timeout_ms: 30000,
    });
  }

  const llm_body = {
    general_prompt: PROMPT.replace('{{VIEWING_STEP}}\n', function_url ? `${LIVE_STEP}\n` : ''),
    begin_message: 'Hi, is that {{lead_name}}?',
    start_speaker: 'agent',
    general_tools,
    default_dynamic_variables: { lead_name: 'there', property_interest: 'a property', lead_notes: 'none' },
  };
  const agent_body = {
    agent_name: 'Acme Realty lead caller (Hookdeck demo)',
    voice_id: process.env.RETELL_VOICE_ID || 'retell-Cimo',
    webhook_url: events_url,
    webhook_events: ['call_started', 'call_ended', 'call_analyzed'],
    post_call_analysis_data: ANALYSIS,
  };

  let llm_id = process.env.RETELL_LLM_ID;
  if (llm_id) {
    await retell('PATCH', `/update-retell-llm/${llm_id}`, llm_body);
  } else {
    llm_id = (await retell('POST', '/create-retell-llm', llm_body)).llm_id as string;
  }

  let agent_id = process.env.RETELL_AGENT_ID;
  if (agent_id) {
    await retell('PATCH', `/update-agent/${agent_id}`, { ...agent_body, response_engine: { type: 'retell-llm', llm_id } });
  } else {
    agent_id = (await retell('POST', '/create-agent', { ...agent_body, response_engine: { type: 'retell-llm', llm_id } })).agent_id as string;
  }
  console.log(`✅ Retell agent ${agent_id} (LLM ${llm_id}), webhook_url -> Hookdeck`);
  return { agent_id: agent_id!, llm_id: llm_id! };
}

// -------------------------------------------------------------------- .env

function writeEnv(values: { [key: string]: string }): void {
  if (!fs.existsSync(ENV_FILE)) {
    fs.copyFileSync(ENV_EXAMPLE_FILE, ENV_FILE);
    console.log('Created .env from .env.example');
  }
  let env = fs.readFileSync(ENV_FILE, 'utf-8');
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    env = pattern.test(env) ? env.replace(pattern, line) : `${env.trimEnd()}\n${line}\n`;
  }
  fs.writeFileSync(ENV_FILE, env);
  console.log(`Wrote ${Object.keys(values).join(', ')} to .env`);
}

async function main(): Promise<void> {
  requireHookdeckApiKey();
  if (!RETELL_API_KEY || RETELL_API_KEY.startsWith('your_')) {
    fail('RETELL_API_KEY is not set. Add a Retell API key to .env (Retell dashboard: Settings -> API Keys).');
  }

  const urls: { [name: string]: string } = {};
  for (const flow of FLOWS) urls[flow.name] = await setupFlow(flow);

  const { agent_id, llm_id } = await setupRetell(urls['retell-call-events'], urls['retell-live-function']);

  console.log('');
  writeEnv({
    RETELL_EVENTS_URL: urls['retell-call-events'],
    RETELL_FUNCTION_URL: urls['retell-live-function'] || '',
    RETELL_AGENT_ID: agent_id,
    RETELL_LLM_ID: llm_id,
  });

  console.log('\nNext:\n  npm run listen\n  npm start');
}

main().catch((error: any) => fail(`Setup failed: ${error.message}`));
