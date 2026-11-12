// Start call: retell-client-js-sdk (pinned, loaded as an ESM build from esm.sh, no build step).
// The server creates the web call with the private API key and hands back a short-lived access token.
const SDK = 'https://esm.sh/retell-client-js-sdk@3.0.3';
const button = document.getElementById('webCallBtn');
const status_el = document.getElementById('webCallStatus');
let client = null;

const say = (text) => { status_el.textContent = text; };

async function init() {
  let config = {};
  try { config = await (await fetch('/api/config')).json(); } catch { /* shown below */ }
  if (config.web_missing && config.web_missing.length) {
    return say(`Set ${config.web_missing.join(', ')} in .env, then restart the app.`);
  }
  button.disabled = false;
}

async function start() {
  button.disabled = true;
  say('Connecting...');
  try {
    const form = Object.fromEntries(new FormData(document.getElementById('leadForm')));
    const response = await fetch('/api/web-call', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form),
    });
    const call = await response.json();
    if (!response.ok) throw new Error(call.error || response.statusText);
    await navigator.mediaDevices.getUserMedia({ audio: true });
    const { RetellWebClient } = await import(SDK);
    client = new RetellWebClient();
    client.on('call_started', () => say(`In call (${call.call_id}). The agent speaks first; answer as the lead.`));
    client.on('call_ended', () => finish('Call ended. Webhooks arrive in a few seconds.'));
    client.on('error', (error) => { client && client.stopCall(); finish(`Error: ${error?.message || error}`); });
    await client.startCall({
      accessToken: call.access_token,
      callId: call.call_id,
      transport: call.transport,
      iceServers: call.ice_servers,
    });
    button.textContent = 'End call';
    button.disabled = false;
  } catch (error) {
    finish(`Could not start the call: ${error.message}`);
  }
}

function finish(message) {
  client = null;
  button.textContent = 'Start call in the browser';
  button.disabled = false;
  say(message);
}

button.addEventListener('click', () => {
  if (client) {
    button.disabled = true;
    client.stopCall();
  } else {
    start();
  }
});
init();
