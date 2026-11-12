// Start call in the browser: Retell's current web SDK, retell-client-js-sdk 3.x `RetellClient`
// (the `RetellWebClient` + server-minted access token flow is deprecated). The page authenticates
// with a Retell *public key*, which is meant for browser code and is limited to the domains you
// allow. The Retell API key stays on the server and is never needed for this call.
// https://docs.retellai.com/deploy/web-call
// Pinned exact versions, loaded as an ES module from esm.sh (no build step).
const SDK = 'https://esm.sh/retell-client-js-sdk@3.0.4?deps=livekit-client@2.24.0,eventemitter3@5.0.4';
const button = document.getElementById('webCallBtn');
const status_el = document.getElementById('webCallStatus');
const help_el = document.getElementById('webCallHelp');
let config = {};
let session = null;

const say = (text) => { status_el.textContent = text; };

async function init() {
  try { config = await (await fetch('/api/config')).json(); } catch { /* shown below */ }
  const missing = config.web_missing || ['RETELL_PUBLIC_KEY'];
  if (missing.length) {
    const others = missing.filter((m) => m !== 'RETELL_PUBLIC_KEY');
    help_el.hidden = false;
    help_el.textContent = [
      missing.includes('RETELL_PUBLIC_KEY')
        ? 'Add RETELL_PUBLIC_KEY to .env: in the Retell dashboard open API Keys, then Public Keys, create a key, add "localhost" to its allowed domains, and copy the key (starts with public_key_). '
        + 'It is safe in the browser; it only works on the domains you allow.'
        : '',
      others.length ? `Also missing: ${others.join(', ')}.` : '',
      'Then restart the app.',
    ].filter(Boolean).join(' ');
    return say('Browser call not set up yet.');
  }
  button.disabled = false;
}

async function report(lead_id, body) {
  try {
    await fetch(`/api/web-leads/${lead_id}/call`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
  } catch { /* the webhooks still find the lead through metadata.lead_id */ }
}

async function start() {
  button.disabled = true;
  say('Creating the lead...');
  let lead_id;
  try {
    const form = Object.fromEntries(new FormData(document.getElementById('leadForm')));
    const response = await fetch('/api/web-leads', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form),
    });
    const lead = await response.json();
    if (!response.ok) throw new Error(lead.error || response.statusText);
    lead_id = lead.id;

    say('Connecting...');
    const { RetellClient } = await import(SDK);
    const client = new RetellClient({ key: config.retell_public_key });
    session = client.createWebCall({
      agent_id: lead.agent_id,
      retell_llm_dynamic_variables: lead.retell_llm_dynamic_variables,
      metadata: lead.metadata,
      hooks: {
        onStatus: (state) => {
          if (state === 'live') {
            report(lead_id, { call_id: session && session.callId });
            say(`In call (${session && session.callId}). The agent speaks first; answer as the lead.`);
            button.textContent = 'End call';
            button.disabled = false;
          }
          if (state === 'ended') finish('Call ended. Webhooks arrive in a few seconds.');
        },
        onError: (error) => {
          const message = (error && error.message) || String(error);
          report(lead_id, { error: message });
          finish(`Error: ${message}`);
        },
      },
    });
    await session.ready;
  } catch (error) {
    if (lead_id) report(lead_id, { error: error.message });
    finish(`Could not start the call: ${error.message}`);
  }
}

function finish(message) {
  session = null;
  button.textContent = 'Start call in the browser';
  button.disabled = false;
  say(message);
}

button.addEventListener('click', () => {
  if (session) {
    button.disabled = true;
    session.end();
  } else {
    start();
  }
});
init();
