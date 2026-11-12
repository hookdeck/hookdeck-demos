// Start call: @elevenlabs/client (pinned, loaded as an ESM build from esm.sh, no build step).
// The signed URL is minted by this app's server with the private API key.
const SDK = 'https://esm.sh/@elevenlabs/client@1.32.0';
const button = document.getElementById('callBtn');
const status_el = document.getElementById('callStatus');
let conversation = null;

const say = (text) => { status_el.textContent = text; };

async function init() {
  let config = {};
  try { config = await (await fetch('/api/config')).json(); } catch { /* shown below */ }
  document.getElementById('suggested').textContent = config.suggested_line || '';
  if (!config.agent_configured) return say('Set ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID in .env, then restart the app.');
  button.disabled = false;
}

async function start() {
  button.disabled = true;
  say('Connecting...');
  try {
    const response = await fetch('/api/signed-url', { method: 'POST' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || response.statusText);
    await navigator.mediaDevices.getUserMedia({ audio: true });
    const { Conversation } = await import(SDK);
    conversation = await Conversation.startSession({
      signedUrl: body.signed_url,
      connectionType: 'websocket',
      onConnect: ({ conversationId }) => say(`In call (${conversationId}). Speak now.`),
      onModeChange: ({ mode }) => say(mode === 'speaking' ? 'Agent is speaking...' : 'Listening...'),
      onDisconnect: () => finish('Call ended. Webhooks arrive in a few seconds.'),
      onError: (message) => finish(`Error: ${message}`),
    });
    button.textContent = 'End call';
    button.disabled = false;
  } catch (error) {
    finish(`Could not start the call: ${error.message}`);
  }
}

function finish(message) {
  conversation = null;
  button.textContent = 'Start call';
  button.disabled = false;
  say(message);
}

button.addEventListener('click', async () => {
  if (conversation) {
    const active = conversation;
    button.disabled = true;
    await active.endSession();
  } else {
    start();
  }
});
init();
