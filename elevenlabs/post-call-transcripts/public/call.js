// Call the booking line: @elevenlabs/client (pinned, loaded as an ESM build from esm.sh, no build step).
// The signed URL is minted by this app's server with the private API key.
const SDK = 'https://esm.sh/@elevenlabs/client@1.32.0';
const button = document.getElementById('callBtn');
const status_el = document.getElementById('callStatus');
const pill = document.getElementById('callPill');
let conversation = null;

// The active theme's wording for a key (see theme-salon.copy.js), otherwise the plain label
const wording = (key, plain) => (window.HookdeckTheme ? window.HookdeckTheme.copy(key, plain) : plain);

// The status line and the button are built here, so they are built again when the theme changes
let status = { key: '', plain: '', args: [] };
let state = 'ready';
const PILL = { ready: 'Ready', ringing: 'Ringing', in_call: 'In call', ended: 'Call ended', error: 'Error', setup: 'Not set up' };

const fill = (text, args) => args.reduce((out, value, i) => out.replace(`{${i}}`, value), text);
function render() {
  button.textContent = conversation ? wording('end_btn', 'End call') : wording('call_btn', 'Call Hookdeck Hair');
  status_el.textContent = status.key ? fill(wording(status.key, status.plain), status.args) : status.plain;
  pill.textContent = PILL[state];
}
function say(plain, key = '', ...args) {
  status = { key, plain, args };
  render();
}
const set_state = (value) => { state = value; render(); };
document.addEventListener('hookdeck-theme', render);

async function init() {
  let config = {};
  try { config = await (await fetch('/api/config')).json(); } catch { /* shown below */ }
  document.getElementById('suggested').textContent = config.suggested_line || '';
  if (!config.agent_configured) {
    set_state('setup');
    return say('Set ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID in .env, then restart the app.');
  }
  button.disabled = false;
  render();
}

async function start() {
  button.disabled = true;
  set_state('ringing');
  say('Connecting...', 'call_connecting');
  try {
    const response = await fetch('/api/signed-url', { method: 'POST' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || response.statusText);
    await navigator.mediaDevices.getUserMedia({ audio: true });
    const { Conversation } = await import(SDK);
    conversation = await Conversation.startSession({
      signedUrl: body.signed_url,
      connectionType: 'websocket',
      onConnect: ({ conversationId }) => { set_state('in_call'); say(`In call (${conversationId}). Speak now.`, 'call_in', conversationId); },
      onModeChange: ({ mode }) => say(mode === 'speaking' ? 'The assistant is speaking...' : 'Listening...'),
      onDisconnect: () => finish('Call ended. Webhooks arrive in a few seconds.', 'call_ended'),
      onError: (message) => finish(`Error: ${message}`, '', 'error'),
    });
    button.disabled = false;
    render();
  } catch (error) {
    finish(`Could not start the call: ${error.message}`, '', 'error');
  }
}

function finish(message, key = '', next = 'ended') {
  conversation = null;
  button.disabled = false;
  state = next;
  say(message, key);
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
