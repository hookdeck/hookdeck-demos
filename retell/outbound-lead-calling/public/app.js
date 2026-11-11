const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const BADGE = {
  new: ['', 'New'], calling: ['', 'Calling…'], in_call: ['', 'In call'], completed: ['badge--success', 'Call ended'],
  analyzed: ['badge--success', 'Analyzed'], no_answer: ['', 'No answer'], failed: ['badge--danger', 'Failed'],
};

function say(text, kind) {
  const m = $('message');
  m.textContent = text;
  m.className = `message body-s ${kind || ''}`;
}

async function loadConfig() {
  const config = await (await fetch('/api/config')).json();
  const box = $('config');
  box.textContent = config.missing.length
    ? `Not ready to place calls yet. Missing: ${config.missing.join(', ')}. See README.md.`
    : '';
  $('callBtn').disabled = config.missing.length > 0;
  $('chaosState').textContent = config.chaos.fail_next || config.chaos.delay_seconds
    ? `Active: fail next ${config.chaos.fail_next}, delay ${config.chaos.delay_seconds}s`
    : '';
}

function render(leads) {
  if (!leads.length) {
    $('leads').innerHTML = '<div class="empty body-s">No leads yet.</div>';
    return;
  }
  $('leads').innerHTML = leads.map((lead) => {
    const [cls, label] = BADGE[lead.status] || ['', lead.status];
    const analysis = lead.analysis && Object.keys(lead.analysis).length
      ? Object.entries(lead.analysis).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(' · ')
      : '';
    return `<div class="request">
      <div class="request-head">
        <strong class="request-text">${esc(lead.name)} · ${esc(lead.property_interest)}</strong>
        <span class="badge ${cls}">${label}</span>
      </div>
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
      <ul class="timeline body-xs">${lead.timeline.map((t) =>
        `<li class="${t.note && t.note.startsWith('duplicate') ? 'dup' : ''}"><code>${new Date(t.at).toLocaleTimeString()}</code> ${esc(t.event)}${t.note ? ` (${esc(t.note)})` : ''}${t.hookdeck_event_id ? ` <code>${esc(t.hookdeck_event_id)}</code>` : ''}</li>`).join('')}</ul>
    </div>`;
  }).join('');
}

async function refresh() {
  render(await (await fetch('/api/leads')).json());
}

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
  say('Added a lead with a simulated call. Run npm run simulate to send it signed events.', 'info');
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
setInterval(() => { if ($('autoRefresh').checked) { refresh(); loadConfig(); } }, 2000);
