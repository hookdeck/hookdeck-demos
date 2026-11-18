const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// The active theme's wording for a key (see theme-open-house.copy.js), otherwise the plain label
const wording = (key, plain) => (window.HookdeckTheme ? window.HookdeckTheme.copy(key, plain) : plain);

const BADGE = {
  new: ['', 'New'], calling: ['', 'Calling…'], in_call: ['', 'In call'], completed: ['badge--success', 'Call ended'],
  analyzed: ['badge--success', 'Analyzed'], no_answer: ['', 'No answer'], failed: ['badge--danger', 'Failed'],
  gave_up: ['badge--danger', 'Gave up'],
};
const INFO_ICON = '<svg class="info__icon" aria-hidden="true" width="18" height="18" viewBox="0 0 18 18"><circle class="ring" cx="9" cy="9" r="7.5"></circle><path class="stem" d="M9 8 V12.5"></path><circle cx="9" cy="5.2" r="1.05"></circle></svg>';

let retry = { max_attempts: 3, delay_seconds: 120 };
let last_html = null;

function say(text, kind) {
  const m = $('message');
  m.textContent = text;
  m.className = `message body-s ${kind || ''}`;
}

async function loadConfig() {
  const config = await (await fetch('/api/config')).json();
  if (config.retry) {
    retry = config.retry;
    const minutes = retry.delay_seconds / 60;
    $('retryDelay').textContent = Number.isInteger(minutes) && minutes >= 1 ? `${minutes} minute${minutes === 1 ? '' : 's'}` : `${retry.delay_seconds} seconds`;
    $('retryMax').textContent = String(retry.max_attempts);
  }
  const phone_missing = config.missing.length > 0;
  $('phoneStatus').textContent = phone_missing ? 'Phone not set up' : '';
  $('phoneStatus').hidden = !phone_missing;
  const detail = $('phoneMissing');
  detail.hidden = !phone_missing;
  detail.textContent = phone_missing ? `Phone calls are not set up. Missing: ${config.missing.join(', ')}. The browser call does not need these. See README.md.` : '';
  $('callBtn').disabled = phone_missing;
  $('chaosState').textContent = config.chaos.fail_next || config.chaos.delay_seconds
    ? `Active: fail next ${config.chaos.fail_next}, delay ${config.chaos.delay_seconds}s`
    : '';
}

// A shape and a colour for each state of an attempt, so the ladder does not rely on colour alone
const DOT = {
  missed: '<circle class="dot__fill" cx="8" cy="8" r="6"></circle><path class="dot__mark" d="M5.5 5.5 L10.5 10.5 M10.5 5.5 L5.5 10.5"></path>',
  answered: '<circle class="dot__fill" cx="8" cy="8" r="6"></circle><path class="dot__mark" d="M5 8.2 L7.2 10.4 L11 5.8"></path>',
  live: '<circle class="dot__ring" cx="8" cy="8" r="6"></circle><circle class="dot__fill" cx="8" cy="8" r="2.6"></circle>',
  next: '<circle class="dot__ring" cx="8" cy="8" r="6"></circle>',
  todo: '<circle class="dot__ring dot__ring--faint" cx="8" cy="8" r="6"></circle>',
};
const DOT_WORDS = { missed: 'no answer', answered: 'answered', live: 'in progress', next: 'next', todo: 'not yet' };

/** The state of attempt `n` (1-based) on a lead's retry ladder. */
function dotState(lead, n) {
  const attempt = lead.attempt || 1;
  if (lead.gave_up || n < attempt) return 'missed';
  if (n > attempt) return 'todo';
  if (lead.next_attempt_at) return 'next';
  if (lead.status === 'calling' || lead.status === 'in_call') return 'live';
  if (lead.status === 'failed') return 'missed';
  return lead.status === 'new' ? 'next' : 'answered';
}

function ladder(lead) {
  const states = Array.from({ length: retry.max_attempts }, (_, i) => dotState(lead, i + 1));
  const label = states.map((s, i) => `attempt ${i + 1} ${DOT_WORDS[s]}`).join(', ');
  const dots = states.map((s, i) =>
    `${i ? '<span class="ladder__link" aria-hidden="true"></span>' : ''}<svg class="dot dot--${s}" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">${DOT[s]}</svg>`).join('');
  const wait = lead.next_attempt_at
    ? `<span class="ladder__wait" data-due="${esc(lead.next_attempt_at)}">Next ring <b class="ladder__count"></b></span>`
    : '';
  return `<div class="ladder">${wait}<button type="button" class="info" data-info="retry" aria-label="About the retry ladder" aria-haspopup="dialog" aria-expanded="false">${INFO_ICON}</button>
    <span class="ladder__dots" role="img" aria-label="${esc(label)}">${dots}</span></div>`;
}

function timelineRow(lead, t, i) {
  const dup = t.note && t.note.startsWith('duplicate');
  const tip_id = `dup-${lead.id}-${i}`;
  const note = !t.note ? '' : dup
    ? ` (<span class="tip"><button type="button" class="dupbtn" aria-describedby="${tip_id}">${esc(t.note)}</button><span class="tip-bubble" id="${tip_id}" role="tooltip">The app saw <code>${esc(t.event)}</code> twice and ignored the repeat.</span></span>)`
    : ` (${esc(t.note)})`;
  return `<li class="${dup ? 'dup' : ''}"><code>${new Date(t.at).toLocaleTimeString()}</code> ${esc(t.event)}${note}${t.hookdeck_event_id ? ` <code>${esc(t.hookdeck_event_id)}</code>` : ''}</li>`;
}

function render(leads) {
  window.retell_leads = leads;
  const html = !leads.length ? '<div class="empty body-s">No leads yet.</div>' : leads.map((lead) => {
    // A missed call whose next attempt is scheduled reads as "No answer", even after its call_analyzed arrived
    const key = lead.gave_up ? 'gave_up' : lead.next_attempt_at ? 'no_answer' : lead.status;
    const [cls, plain] = BADGE[key] || ['', lead.status];
    const label = wording(`badge_${key}`, plain);
    const analysis = lead.analysis && Object.keys(lead.analysis).length
      ? Object.entries(lead.analysis).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(' · ')
      : '';
    const laddered = (lead.attempt || 1) > 1 || lead.next_attempt_at || lead.gave_up;
    return `<div class="request">
      <div class="request-head">
        <strong class="request-text">${esc(lead.name)} · ${esc(lead.property_interest)}</strong>
        <span class="request-badges">
          ${laddered ? `<span class="pill">Attempt ${lead.attempt || 1} of ${retry.max_attempts}</span>` : ''}
          <span class="badge ${cls}">${esc(label)}</span>
        </span>
      </div>
      ${laddered ? ladder(lead) : ''}
      <div class="request-meta body-xs">
        <span>${esc(lead.phone_masked)}</span>
        ${lead.call_id ? `<span>call <code>${esc(lead.call_id)}</code></span>` : ''}
        ${lead.duration_seconds != null ? `<span>${lead.duration_seconds}s</span>` : ''}
        ${lead.disconnection_reason ? `<span>${esc(lead.disconnection_reason)}</span>` : ''}
        ${lead.sentiment ? `<span>sentiment ${esc(lead.sentiment)}</span>` : ''}
      </div>
      ${lead.summary ? `<div class="summary body-s">${esc(lead.summary)}</div>` : ''}
      ${analysis ? `<div class="body-xs muted">${analysis}</div>` : ''}
      ${lead.error ? `<div class="error body-s">${esc(lead.error)}</div>` : ''}
      <ul class="timeline body-xs">${lead.timeline.map((t, i) => timelineRow(lead, t, i)).join('')}</ul>
    </div>`;
  }).join('');
  // Skip an identical render, so an open tip or a focused ⓘ in the list is not replaced every second
  if (html !== last_html) { last_html = html; $('leads').innerHTML = html; }
  tick();
  document.dispatchEvent(new CustomEvent('leads', { detail: leads }));
}

const clock = (ms) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

// The countdowns tick on their own, so they keep running with auto-refresh off
function tick() {
  document.querySelectorAll('.ladder__wait[data-due]').forEach((el) => {
    const left = Date.parse(el.dataset.due) - Date.now();
    if (left > 0) el.querySelector('.ladder__count').textContent = clock(left);
    else el.textContent = 'Ready to ring again';
  });
}

async function refresh() {
  render(await (await fetch('/api/leads')).json());
}

document.addEventListener('hookdeck-theme', () => { last_html = null; if (window.retell_leads) render(window.retell_leads); });

$('leadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('callBtn').disabled = true;
  say('Creating the call…', 'info');
  const body = Object.fromEntries(new FormData(e.target));
  const response = await fetch('/api/leads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  say(response.ok ? 'Call created. Your phone should ring shortly.' : data.error, response.ok ? 'success' : 'error');
  $('callBtn').disabled = false;
  refresh();
});

$('demoBtn').addEventListener('click', async () => {
  await fetch('/api/leads/demo', { method: 'POST' });
  say('Added a lead with a simulated call.', 'info');
  refresh();
});

$('chaosBtn').addEventListener('click', async () => {
  await fetch('/api/chaos', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fail_next: $('failNext').value, delay_seconds: $('delay').value }),
  });
  loadConfig();
});

loadConfig();
refresh();
setInterval(tick, 1000);
setInterval(() => { if ($('autoRefresh').checked) { refresh(); loadConfig(); } }, 1000);
