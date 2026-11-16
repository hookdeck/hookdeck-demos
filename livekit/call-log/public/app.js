const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const time = (ms) => (ms ? new Date(ms).toLocaleTimeString() : '?');
const dur = (s) => (s === undefined ? 'in progress' : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);
// Only link recordings that are web URLs; show s3:// and gs:// locations as text
const link = (l) => (/^https?:\/\//.test(l.url) ? `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>` : `${esc(l.label)} <code>${esc(l.url)}</code>`);

function callCard(c) {
  const people = Object.values(c.participants);
  const recs = Object.values(c.recordings);
  return `<div class="request">
    <div class="request-head">
      <span class="request-text subtitle-s">${esc(c.room_name)}</span>
      <span class="badge ${c.status === 'ended' ? 'badge--success' : 'badge--warning'}">${c.status}</span>
    </div>
    <div class="request-meta body-xs">
      <span>Started ${time(c.started_at)}</span><span>Ended ${time(c.ended_at)}</span><span>Duration ${dur(c.duration_s)}</span>
      <span>Room <code>${esc(c.room_sid || 'unknown')}</code></span>
    </div>
    <ul class="people body-s">${people.map((p) => `<li>${esc(p.name || p.identity)}${p.kind === 'AGENT' ? ' <span class="badge">story agent</span>' : p.kind === 'INGRESS' ? ' <span class="badge">soundtrack</span>' : ''} <span class="request-meta">joined ${time(p.joined_at)}${p.left_at ? `, left ${time(p.left_at)}` : ''}${p.disconnect_reason ? ` (${esc(p.disconnect_reason)})` : ''}</span></li>`).join('') || '<li>No participants seen yet</li>'}</ul>
    ${recs.length ? `<ul class="recs body-s">${recs.map((r) => `<li>Recording ${esc(r.egress_id)}: ${esc((r.status || '').replace('EGRESS_', '').toLowerCase())}${r.links.map((l) => ` - ${link(l)}`).join('')}${r.error ? ` <span class="error">${esc(r.error)}</span>` : ''}</li>`).join('')}</ul>` : ''}
  </div>`;
}

function chronicleCard(c) {
  return `<div class="request">
    <div class="request-head">
      <span class="request-text subtitle-s">${esc(c.room_name)}</span>
      <span class="badge ${c.status === 'ended' ? 'badge--success' : 'badge--warning'}">${c.status}</span>
    </div>
    <div class="request-meta body-xs">
      <span>Players: ${c.players.length ? c.players.map(esc).join(', ') : 'none yet'}</span><span>Scenes: ${c.scenes}</span>${c.length_s !== undefined ? `<span>Length ${dur(c.length_s)}</span>` : ''}
    </div>
    <ul class="timeline body-s">${c.lines.map((l) => `<li class="${l.kind === 'drop' ? 'dup' : ''}"><code>${new Date(l.at).toLocaleTimeString()}</code> ${esc(l.text)}</li>`).join('')}</ul>
  </div>`;
}

async function refresh() {
  const [calls, deliveries, chronicle] = await Promise.all([fetch('/api/calls').then((r) => r.json()), fetch('/api/deliveries').then((r) => r.json()), fetch('/api/chronicle').then((r) => r.json())]);
  document.getElementById('chronicle').innerHTML = chronicle.length ? chronicle.map(chronicleCard).join('') : '<p class="empty body-s">No session yet. Join a call and the chronicle fills in as the webhooks arrive.</p>';
  document.getElementById('calls').innerHTML = calls.length ? calls.map(callCard).join('') : '<p class="empty body-s">No calls yet. Create a room in LiveKit (see the README) and the events appear here.</p>';
  document.getElementById('deliveries').innerHTML = deliveries.map((d) =>
    `<tr><td>${new Date(d.received_at).toLocaleTimeString()}</td><td><code>${esc(d.event || '-')}</code></td><td><code>${esc(d.event_id || '-')}</code></td><td>${d.verified ? (d.duplicate ? 'duplicate' : 'applied') : `rejected: ${esc(d.error)}`}</td></tr>`).join('');
}

async function loadChaos() {
  const state = await (await fetch('/api/state')).json();
  document.getElementById('chaosState').textContent = state.fail_next || state.delay_seconds
    ? `Active: fail next ${state.fail_next}, delay ${state.delay_seconds}s`
    : '';
}

document.getElementById('chaosBtn').addEventListener('click', async () => {
  await fetch('/api/chaos', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fail_next: document.getElementById('failNext').value, delay_seconds: document.getElementById('delay').value }),
  });
  loadChaos();
});

refresh();
loadChaos();
setInterval(() => { if (document.getElementById('autoRefresh').checked) { refresh(); loadChaos(); } }, 2000);
