// Have Sam call the lead in the browser: Retell's current web SDK, retell-client-js-sdk 3.x `RetellClient`
// (the `RetellWebClient` + server-minted access token flow is deprecated). The page authenticates
// with a Retell *public key*, which is meant for browser code and is limited to the domains you
// allow. The Retell API key stays on the server and is never needed for this call.
// https://docs.retellai.com/deploy/web-call
// Pinned exact versions, loaded as an ES module from esm.sh (no build step).
//
// The page shows two roles, Sam (the caller) and the lead (you), and one status between them:
// ready -> ringing -> in call -> ended. A real call's status follows the SDK; a simulated one follows the lead.
// When a call ends without an answer, the app schedules the next attempt (src/retry.ts). The countdown
// ends in a ready button, and the button rings the lead again on the same lead.
const SDK = 'https://esm.sh/retell-client-js-sdk@3.0.4?deps=livekit-client@2.24.0,eventemitter3@5.0.4';
const $ = (id) => document.getElementById(id);
const button = $('webCallBtn');
const end_button = $('endCallBtn');
const no_answer_button = $('noAnswerBtn');
const status_el = $('webCallStatus');
const pill = $('callPill');
const name_input = $('leadName');
const property_input = $('leadProperty');
let config = {};
let session = null;
let phase = 'ready'; // ready | ringing | in call | ended
let target_id = null; // the lead this page is calling, and would ring again
let note = ''; // the last thing worth saying beside the button
let leads = [];

const who = () => name_input.value.trim() || 'the lead';
const BUTTON_LABEL = {
  ready: (name) => `Have Sam call ${name}`,
  ringing: (name) => `Sam is calling ${name}…`,
  'in call': (name) => `Sam and ${name} are talking`,
  ended: (name) => `Have Sam call ${name} again`,
};
const target = () => leads.find((l) => l.id === target_id);
const is_due = (lead) => !!lead.next_attempt_at && Date.parse(lead.next_attempt_at) <= Date.now();
const clock = (ms) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

// Leave a live region alone when its text has not changed, so a screen reader is not told again every second
const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };

function setPhase(next) {
  phase = next;
  paint();
}

// Everything on the page that depends on the lead's name, the call status or the retry schedule
function paint() {
  const name = who();
  const lead = target();
  const waiting = phase === 'ended' && lead && lead.next_attempt_at && !is_due(lead);
  document.querySelectorAll('[data-lead-name]').forEach((el) => { el.textContent = name; });
  $('leadCardName').textContent = name;
  $('leadInitial').textContent = name.charAt(0).toUpperCase();
  $('leadCardProperty').textContent = property_input.value.trim() || 'a property';

  button.textContent = BUTTON_LABEL[phase](name);
  button.disabled = !config.ready || phase === 'ringing' || phase === 'in call' || waiting;
  end_button.hidden = phase !== 'in call';
  end_button.disabled = false;
  no_answer_button.disabled = !config.simulate_ready || !!session;

  setText(pill, `Sam → ${name} · ${phase}`);
  pill.className = `pill pill--${phase.replace(' ', '-')}`;

  // One short status beside the button
  if (!config.ready) setText(status_el, 'Browser call not set up yet');
  else if (phase === 'ended' && lead && lead.next_attempt_at) {
    const left = Date.parse(lead.next_attempt_at) - Date.now();
    setText(status_el, `Attempt ${lead.attempt} of ${config.max_attempts}: ${left > 0 ? `next ring ${clock(left)}` : 'ready'}`);
  } else if (phase === 'ended' && lead && lead.gave_up) setText(status_el, 'Gave up');
  else setText(status_el, note || 'Browser call ready');
  status_el.className = `tag ${config.ready ? '' : 'tag--bad'}`;
}

async function init() {
  try { config = await (await fetch('/api/config')).json(); } catch { /* shown below */ }
  const missing = config.web_missing || ['RETELL_PUBLIC_KEY'];
  config.ready = missing.length === 0;
  config.simulate_ready = !(config.simulate_missing || ['x']).length;
  config.max_attempts = (config.retry && config.retry.max_attempts) || 3;
  if (missing.length) {
    const others = missing.filter((m) => m !== 'RETELL_PUBLIC_KEY');
    const detail = $('setupMissing');
    detail.hidden = !others.length;
    detail.textContent = others.length ? `Also missing: ${others.join(', ')}.` : '';
  }
  paint();
}

async function report(lead_id, body) {
  try {
    await fetch(`/api/web-leads/${lead_id}/call`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
  } catch { /* the webhooks still find the lead through metadata.lead_id */ }
}

async function post(url, body) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

async function start() {
  button.disabled = true;
  note = '';
  setPhase('ringing');
  let lead_id;
  try {
    // Ring the lead again when the retry ladder says it is time; otherwise this is a new enquiry
    const lead_before = target();
    const request = lead_before && is_due(lead_before)
      ? await post(`/api/leads/${lead_before.id}/retry`)
      : await post('/api/web-leads', Object.fromEntries(new FormData($('leadForm'))));
    lead_id = request.id;
    target_id = lead_id;
    if (request.simulated) {
      // A simulated lead has no Retell call to start: its outcome comes from "Lead does not answer" or npm run simulate
      note = 'Simulated ring, no call placed';
      return paint();
    }

    note = 'Connecting…';
    paint();
    const { RetellClient } = await import(SDK);
    const client = new RetellClient({ key: config.retell_public_key });
    session = client.createWebCall({
      agent_id: request.agent_id,
      retell_llm_dynamic_variables: request.retell_llm_dynamic_variables,
      metadata: request.metadata,
      hooks: {
        onStatus: (state) => {
          if (state === 'live') {
            report(lead_id, { call_id: session && session.callId });
            note = 'In call. Sam speaks first.';
            setPhase('in call');
          }
          if (state === 'ended') finish('Call ended. Webhooks follow.');
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
    if (lead_id && !target()?.simulated) report(lead_id, { error: error.message });
    finish(`Could not start the call: ${error.message}`);
  }
}

function finish(message) {
  session = null;
  note = message;
  setPhase('ended');
}

button.addEventListener('click', start);
end_button.addEventListener('click', () => {
  end_button.disabled = true;
  if (session) session.end();
});

// "Lead does not answer": a signed no-answer event goes through the real Hookdeck source. No call is placed.
no_answer_button.addEventListener('click', async () => {
  no_answer_button.disabled = true;
  note = 'Simulated ring, no call placed';
  try {
    const sent = await post('/api/simulate/no-answer', Object.fromEntries(new FormData($('leadForm'))));
    target_id = sent.id;
    setPhase('ringing');
  } catch (error) {
    note = `Error: ${error.message}`;
    paint();
  }
});

// The lead list drives the status of a simulated ring, and the retry countdown
document.addEventListener('leads', (event) => {
  leads = event.detail;
  const lead = target();
  if (phase === 'ringing' && lead && lead.simulated && lead.status !== 'calling') {
    note = '';
    setPhase('ended');
  } else paint();
});
if (window.retell_leads) leads = window.retell_leads;
setInterval(paint, 1000);
[name_input, property_input].forEach((input) => input.addEventListener('input', paint));
document.addEventListener('hookdeck-theme', paint);
init();
