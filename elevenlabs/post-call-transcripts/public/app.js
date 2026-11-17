const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// The active theme's wording for a key (see theme-salon.copy.js), otherwise the plain label
const wording = (key, plain) => (window.HookdeckTheme ? window.HookdeckTheme.copy(key, plain) : plain);
const EMPTY_PLAIN = 'No conversations yet. Run <code>npm run call</code>, or start a test call from your agent in the ElevenLabs dashboard.';

// Regions are re-rendered only when their markup changes, so an open hover tip, a focused control or a playing
// recording is not replaced by the 3-second refresh.
const last_html = {};
function show(id, html) {
  if (last_html[id] === html) return;
  last_html[id] = html;
  $(id).innerHTML = html;
}

function size(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const OUTCOME = {
  success: ['badge--success', 'Successful'],
  failure: ['badge--danger', 'Unsuccessful'],
  unknown: ['', 'Unknown'],
  failed_to_start: ['badge--danger', 'Failed to start'],
};

function outcomeBadge(outcome, why) {
  const [cls, label] = OUTCOME[outcome] || ['', outcome || 'Waiting for transcript'];
  const badge = `<span class="badge ${cls}">${esc(label)}</span>`;
  return why ? tip(badge, why, 'span') : badge;
}

/** Wraps a control in a hover tip that also opens on keyboard focus. A non-interactive anchor gets tabindex 0. */
function tip(anchor, text, kind) {
  tip.n = (tip.n || 0) + 1;
  const id = `tip-${tip.n}`;
  const control = kind === 'span' ? `<span class="tip-anchor" tabindex="0" aria-describedby="${id}">${anchor}</span>` : anchor.replace('<button', `<button aria-describedby="${id}"`);
  return `<span class="tip">${control}<span class="tip-bubble" id="${id}" role="tooltip">${esc(text)}</span></span>`;
}

function renderConversation(c, open) {
  const turns = c.transcript
    .map((t) => `<div class="turn body-s"><span class="role mono-xs">${esc(t.role)}</span><span>${esc(t.message)}</span></div>`)
    .join('');
  const kv = (obj, valueOf) => {
    const rows = Object.entries(obj).map(([key, v]) => `<dt class="body-xs">${esc(key)}</dt><dd class="body-s">${esc(valueOf(v))}</dd>`);
    return rows.length ? `<dl class="kv">${rows.join('')}</dl>` : '<span class="body-xs">None configured on the agent.</span>';
  };
  const sizes = Object.entries(c.payload_bytes).map(([type, bytes]) => `${type}: ${size(bytes)}`).join(' · ');
  const event_count = Object.keys(c.payload_bytes).length;
  const events_chip = tip(`<button type="button" class="chip-btn mono-xs">${event_count} event${event_count === 1 ? '' : 's'}</button>`, `Agent: ${c.agent_name || c.agent_id}. ${sizes}.`);
  const booking = Diary.bookingOf(c);
  let slot_chip = '';
  if (booking && booking.slot) slot_chip = tip(`<button type="button" class="chip-btn chip-btn--slot mono-xs">${esc(Diary.slotLabel(booking))}</button>`, `Taken from requested_time (${booking.requested_time}) once the webhook landed.`);
  else if (booking) slot_chip = tip(`<button type="button" class="chip-btn chip-btn--slot mono-xs">Unscheduled</button>`, booking.requested_time ? `requested_time (${booking.requested_time}) could not be read as a day and a time.` : 'The call did not record a requested_time.');
  const booked = c.evaluation_criteria_results && c.evaluation_criteria_results.booking_made;
  const why = c.status && !booking ? `booking_made: ${booked ? booked.result : 'not reported'}. Nothing was added to the diary.` : '';
  return `
    <details class="conversation" data-id="${esc(c.conversation_id)}" ${open ? 'open' : ''}>
      <summary>
        <span class="request-text body-s">${esc(c.summary || c.failure_reason || 'No summary yet')}</span>
        ${outcomeBadge(c.outcome, why)}
      </summary>
      <div class="request-meta body-xs">
        <code>${esc(c.conversation_id)}</code>
        ${c.call_duration_secs != null ? `<span>${c.call_duration_secs}s</span>` : ''}
        ${c.termination_reason ? `<span>${esc(c.termination_reason)}</span>` : ''}
        ${events_chip}
        ${slot_chip}
      </div>
      <div class="detail">
        ${c.audio_file ? `<audio controls src="/audio/${encodeURIComponent(c.conversation_id)}.mp3"></audio>` : ''}
        ${c.transcript.length ? `<div><h3 class="subtitle-xs">Transcript</h3>${turns}</div>` : ''}
        <div><h3 class="subtitle-xs">Data collection</h3>${kv(c.data_collection_results, (v) => (typeof v.value === 'object' ? JSON.stringify(v.value) : v.value))}</div>
        <div><h3 class="subtitle-xs">Evaluation criteria</h3>${kv(c.evaluation_criteria_results, (v) => v.result)}</div>
      </div>
    </details>`;
}

function resultBadge(result) {
  const cls = result === 'stored' ? 'badge--success' : result === 'simulated_failure' ? 'badge--danger' : '';
  return `<span class="badge ${cls}">${esc(result)}</span>`;
}

function renderDiary(conversations) {
  const diary = Diary.build(conversations);
  const cell = (day, period) => diary.slots
    .filter((b) => b.slot.day === day && b.slot.period === period)
    .map((b) => {
      const time = b.slot.minutes != null ? `<span class="slot__time mono-xs">${Diary.clockLabel(b.slot.minutes)}</span>` : '';
      const label = tip(`<button type="button" class="slot">${time}<span class="slot__who">${esc(b.name)}</span>${b.service ? `<span class="slot__what">${esc(b.service)}</span>` : ''}</button>`, `From requested_time: ${b.requested_time}.`);
      return label;
    })
    .join('');
  const head = diary.days.map((d) => `<div class="diary__day mono-xs" role="columnheader">${d}</div>`).join('');
  const rows = ['morning', 'afternoon']
    .map((period) => `<div class="diary__period mono-xs" role="rowheader">${period === 'morning' ? 'Morning' : 'Afternoon'}</div>${diary.days.map((_, day) => `<div class="diary__cell" role="cell">${cell(day, period)}</div>`).join('')}`)
    .join('');
  const unscheduled = diary.unscheduled.length
    ? `<div class="diary__unscheduled"><span class="diary__period mono-xs">Unscheduled</span>${diary.unscheduled
        .map((b) => `<span class="slot slot--unscheduled"><span class="slot__who">${esc(b.name)}</span>${b.service ? `<span class="slot__what">${esc(b.service)}</span>` : ''}<span class="slot__what">${b.requested_time ? `"${esc(b.requested_time)}"` : 'no time given'}</span></span>`)
        .join('')}</div>`
    : '';
  $('diaryCount').textContent = diary.booked ? `${diary.booked} booked` : 'Nothing booked yet';
  show('diary', `<div class="diary__wrap"><div class="diary__grid" role="table" aria-label="This week's diary"><div role="presentation"></div>${head}${rows}</div></div>${unscheduled}`);
}

async function refresh() {
  const [conversations, deliveries, state] = await Promise.all([
    fetch('/api/conversations').then((r) => r.json()),
    fetch('/api/deliveries').then((r) => r.json()),
    fetch('/api/state').then((r) => r.json()),
  ]);

  const openIds = new Set([...document.querySelectorAll('.conversation[open]')].map((el) => el.dataset.id));
  $('count').textContent = `${conversations.length} stored`;
  tip.n = 0;
  renderDiary(conversations);
  show(
    'conversations',
    conversations.length
      ? conversations.map((c, i) => renderConversation(c, openIds.has(c.conversation_id) || (i === 0 && !openIds.size))).join('')
      : `<span class="empty body-s">${wording('empty', EMPTY_PLAIN)}</span>`,
  );

  const checked = deliveries.filter((d) => d.sdk_check);
  const sdk_ok = checked.filter((d) => d.sdk_check === 'ok').length;
  const failed = deliveries.filter((d) => d.status_code >= 400).length;
  $('deliverySummary').textContent = deliveries.length
    ? `${deliveries.length} received${failed ? `, ${failed} failed on purpose or by error` : ''}`
    : 'none yet';
  $('sdkBadge').innerHTML = checked.length
    ? `<span class="badge ${sdk_ok === checked.length ? 'badge--success' : 'badge--danger'}" title="ElevenLabs SDK constructEvent run on each forwarded request">SDK check ${sdk_ok === checked.length ? 'ok' : `${sdk_ok}/${checked.length}`}</span>`
    : state.sdk_check ? '<span class="badge">SDK check: no deliveries yet</span>' : '';
  show('deliveries', deliveries.length
    ? deliveries
        .slice(0, 6)
        .map(
          (d) => `<div class="delivery">
            <span>${esc(new Date(d.received_at).toLocaleTimeString([], { hour12: false }))}</span>
            <code>${esc(d.type)}</code>
            <span>${size(d.bytes)}</span>
            ${resultBadge(d.result)}<span>${d.status_code}</span>
            ${d.hookdeck_attempt ? `<span>attempt ${esc(d.hookdeck_attempt)}</span>` : ''}
          </div>`,
        )
        .join('') + (deliveries.length > 6 ? `<div class="more">${deliveries.length - 6} older not shown.</div>` : '')
    : '<span class="empty">Nothing received yet.</span>');

  $('state').textContent = state.fail_next
    ? `The next ${state.fail_next} delivery attempt(s) will fail with a 500.`
    : 'The app is accepting deliveries.';
}

async function post(url, body) {
  await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  refresh();
}

$('deliveriesToggle').addEventListener('click', () => {
  const open = $('deliveriesToggle').getAttribute('aria-expanded') !== 'true';
  $('deliveriesToggle').setAttribute('aria-expanded', String(open));
  $('deliveries').hidden = !open;
});
$('failBtn').addEventListener('click', () => post('/api/fail-next', { count: Number($('failCount').value) || 1 }));
$('clearFailBtn').addEventListener('click', () => post('/api/fail-next', { count: 0 }));
$('resetBtn').addEventListener('click', () => confirm('Delete all stored conversations and the delivery log?') && post('/api/reset'));

// Theme switch: the empty-state wording is built here, so build it again
document.addEventListener('hookdeck-theme', () => { delete last_html.conversations; refresh(); });
refresh();
setInterval(refresh, 3000);
