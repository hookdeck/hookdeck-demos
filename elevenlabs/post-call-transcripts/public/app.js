const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

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

function outcomeBadge(outcome) {
  const [cls, label] = OUTCOME[outcome] || ['', outcome || 'Waiting for transcript'];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
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
  return `
    <details class="conversation" data-id="${esc(c.conversation_id)}" ${open ? 'open' : ''}>
      <summary>
        <span class="request-text body-s">${esc(c.summary || c.failure_reason || 'No summary yet')}</span>
        ${outcomeBadge(c.outcome)}
      </summary>
      <div class="request-meta body-xs">
        <code>${esc(c.conversation_id)}</code>
        <span>${esc(c.agent_name || c.agent_id)}</span>
        ${c.call_duration_secs != null ? `<span>${c.call_duration_secs}s</span>` : ''}
        ${c.termination_reason ? `<span>${esc(c.termination_reason)}</span>` : ''}
        <span>${esc(sizes)}</span>
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

async function refresh() {
  const [conversations, deliveries, state] = await Promise.all([
    fetch('/api/conversations').then((r) => r.json()),
    fetch('/api/deliveries').then((r) => r.json()),
    fetch('/api/state').then((r) => r.json()),
  ]);

  const openIds = new Set([...document.querySelectorAll('.conversation[open]')].map((el) => el.dataset.id));
  $('count').textContent = `${conversations.length} stored`;
  $('conversations').innerHTML = conversations.length
    ? conversations.map((c, i) => renderConversation(c, openIds.has(c.conversation_id) || (i === 0 && !openIds.size))).join('')
    : '<span class="empty body-s">No conversations yet. Run <code>npm run call</code>, or start a test call from your agent in the ElevenLabs dashboard.</span>';

  const checked = deliveries.filter((d) => d.sdk_check);
  const sdk_ok = checked.filter((d) => d.sdk_check === 'ok').length;
  const failed = deliveries.filter((d) => d.status_code >= 400).length;
  $('deliverySummary').textContent = deliveries.length
    ? `${deliveries.length} received${failed ? `, ${failed} failed on purpose or by error` : ''}`
    : 'none yet';
  $('sdkBadge').innerHTML = checked.length
    ? `<span class="badge ${sdk_ok === checked.length ? 'badge--success' : 'badge--danger'}" title="ElevenLabs SDK constructEvent run on each forwarded request">SDK check ${sdk_ok === checked.length ? 'ok' : `${sdk_ok}/${checked.length}`}</span>`
    : state.sdk_check ? '<span class="badge">SDK check: no deliveries yet</span>' : '';
  $('deliveries').innerHTML = deliveries.length
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
    : '<span class="empty">Nothing received yet.</span>';

  $('state').textContent = state.fail_next
    ? `The next ${state.fail_next} delivery attempt(s) will fail with a 500.`
    : 'The app is accepting deliveries.';
}

async function post(url, body) {
  await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  refresh();
}

$('failBtn').addEventListener('click', () => post('/api/fail-next', { count: Number($('failCount').value) || 1 }));
$('clearFailBtn').addEventListener('click', () => post('/api/fail-next', { count: 0 }));
$('resetBtn').addEventListener('click', () => confirm('Delete all stored conversations and the delivery log?') && post('/api/reset'));

refresh();
setInterval(refresh, 3000);
