// Generated from `_shared/flow-drawer/client/flow-drawer.js`; edit there and run `npm run sync-shared`.
/**
 * Data-flow drawer: a bottom drawer, closed by default, that shows each message moving from the
 * sending platform through Event Gateway to the app, live.
 *
 *   <link rel="stylesheet" href="ds/styles.css">
 *   <link rel="stylesheet" href="flow-drawer/flow-drawer.css">
 *   <script src="flow-drawer/flow-drawer.js"></script>
 *   <script>FlowDrawer.mount({ endpoint: '/api/flow' });</script>
 *
 * The state comes from the demo's server (flow-drawer-server.ts), which reads Event Gateway with
 * the API key. The browser never sees the key. Open the page with ?flow=open to start with the
 * drawer open.
 *
 * Options: endpoint (default '/api/flow'), pollMs (open: 1500), idlePollMs (closed: 5000),
 * title (default 'Data flow').
 */
(function () {
  const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const short = (id) => (id ? String(id).slice(-6) : '');
  const ms = (value) => (value == null ? '' : value >= 1000 ? (value / 1000).toFixed(1) + ' s' : Math.round(value) + ' ms');
  const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour12: false });
  const offset = (iso, from) => {
    const diff = new Date(iso) - new Date(from);
    return (diff >= 0 ? '+' : '-') + ms(Math.abs(diff));
  };

  function mount(options = {}) {
    const endpoint = options.endpoint || '/api/flow';
    const open_poll = options.pollMs || 1500;
    const idle_poll = options.idlePollMs || 5000;
    const title = options.title || 'Data flow';

    let state = null;
    let open = new URLSearchParams(location.search).get('flow') === 'open';
    let filter = 'all';
    let since = null; // "Clear" hides messages received before this
    let last_json = '';
    let timer = null;
    const seen = new Set();
    let first_render = true;

    const root = document.createElement('div');
    root.className = 'fd-root';
    root.innerHTML = `
      <section class="fd-panel" id="fd-panel" aria-label="${esc(title)}">
        <div class="fd-head">
          <span class="fd-title title-xs">${esc(title)}</span>
          <span class="fd-legend" id="fd-legend"></span>
          <span class="fd-error" id="fd-error" role="status"></span>
          <span class="fd-filters" id="fd-filters"></span>
        </div>
        <div class="fd-list" id="fd-list" aria-live="polite"></div>
      </section>
      <button type="button" class="fd-handle" id="fd-handle" aria-expanded="false" aria-controls="fd-panel">
        <span class="fd-chevron" aria-hidden="true">&#9650;</span>
        <span>${esc(title)}</span>
        <span class="fd-live fd-off" id="fd-live" aria-hidden="true"></span>
        <span class="badge badge--mono" id="fd-count">0</span>
        <span class="fd-hint body-xs" id="fd-hint">See each message move through Event Gateway</span>
      </button>`;
    document.body.appendChild(root);
    document.body.classList.add('fd-enabled');

    const $ = (id) => root.querySelector('#' + id);

    function setOpen(value) {
      open = value;
      root.classList.toggle('fd-open', open);
      document.body.classList.toggle('fd-open', open);
      $('fd-handle').setAttribute('aria-expanded', String(open));
      $('fd-hint').textContent = open ? 'Close' : 'See each message move through Event Gateway';
      schedule(0);
    }
    $('fd-handle').addEventListener('click', () => setOpen(!open));
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && open) setOpen(false); });
    $('fd-filters').addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.clear) since = state ? state.now : new Date().toISOString();
      else filter = button.dataset.filter;
      last_json = '';
      render();
    });

    function visibleMessages() {
      if (!state) return [];
      return state.messages.filter((m) => (filter === 'all' || m.source === filter) && (!since || m.received_at > since));
    }

    function stageSender(m) {
      return `<div class="fd-stage"><div class="fd-stage-label">${esc(state.sender_label)}</div>
        <span class="badge badge--mono">POST</span>
        <div class="fd-sub">to the ${esc(m.source_label)} source</div></div>`;
    }

    // `rejected` is set by the server; older payloads only had sender_status 401
    const isRejected = (m) => m.rejected ?? m.sender_status === 401;

    function stageGateway(m) {
      return `<div class="fd-stage"><div class="fd-stage-label">Event Gateway</div>
        ${isRejected(m)
          ? `<span class="badge badge--danger">Rejected &middot; ${m.sender_status}</span>
             <div class="fd-sub">${esc((m.rejection_cause || 'VERIFICATION_FAILED').toLowerCase().replace(/_/g, ' '))}; ${m.sender_status === 200
               ? 'the sender still gets 200, because this source type is verified after ingestion'
               : `the sender gets ${m.sender_status}`}</div>`
          : m.verified
            ? `<span class="badge badge--success">Verified &middot; 200</span>
               <div class="fd-sub">request <code>${esc(short(m.request_id))}</code> received</div>`
            : `<span class="badge badge--mono">Received &middot; 200</span>
               <div class="fd-sub">request <code>${esc(short(m.request_id))}</code>${m.verified === false ? '' : ', not verified'}</div>`}
      </div>`;
    }

    const EVENT_BADGE = { SUCCESSFUL: 'badge--success', FAILED: 'badge--danger', SCHEDULED: 'badge--warning', QUEUED: 'badge--warning', HOLD: 'badge--warning' };

    function stageEvent(m) {
      if (isRejected(m)) {
        return `<div class="fd-stage fd-skipped"><div class="fd-stage-label">Event</div><span class="badge badge--mono">none</span><div class="fd-sub">nothing is created or delivered</div></div>`;
      }
      if (!m.events.length) {
        return `<div class="fd-stage fd-pending"><div class="fd-stage-label">Event</div><span class="badge badge--mono"><span class="fd-spinner"></span>waiting</span><div class="fd-sub">no event yet</div></div>`;
      }
      return `<div class="fd-stage"><div class="fd-stage-label">Event</div>${m.events.map((e) => `
        <div class="fd-attempt"><span class="badge ${EVENT_BADGE[e.status] || 'badge--mono'}">${esc(e.status.toLowerCase())}</span>
        <div class="fd-sub"><code>${esc(short(e.id))}</code> &middot; ${e.attempts.length} attempt${e.attempts.length === 1 ? '' : 's'} &middot; ${offset(e.created_at, m.received_at)}</div></div>`).join('')}</div>`;
    }

    function stageDelivery(m) {
      if (isRejected(m) || !m.events.length) {
        return `<div class="fd-stage fd-skipped"><div class="fd-stage-label">Delivery to ${esc(state.app_label)}</div><span class="badge badge--mono">${isRejected(m) ? 'none' : 'waiting'}</span></div>`;
      }
      const rows = m.events.flatMap((e) => {
        const items = e.attempts.map((a) => {
          const ok = a.status === 'SUCCESSFUL';
          const retry = a.number > 1;
          return `<div class="fd-attempt"><span class="badge ${ok ? 'badge--success' : 'badge--danger'}">#${a.number} &middot; ${a.response_status ?? esc(a.error_code || a.status.toLowerCase())}${a.response_latency != null ? ' &middot; ' + ms(a.response_latency) : ''}</span>
            <div class="fd-sub">${retry ? `retry (${esc((a.trigger || '').toLowerCase())}) ` : ''}${offset(a.at, m.received_at)}${a.delivery_latency != null && !retry ? ' &middot; queued ' + ms(a.delivery_latency) : ''}</div></div>`;
        });
        if (!e.attempts.length && e.status !== 'SUCCESSFUL' && e.status !== 'FAILED') {
          items.push(`<div class="fd-attempt fd-pending"><span class="badge badge--mono"><span class="fd-spinner"></span>delivering</span></div>`);
        }
        if (e.next_attempt_at && e.status !== 'SUCCESSFUL' && e.status !== 'FAILED') {
          items.push(`<div class="fd-sub">next retry ${esc(clock(e.next_attempt_at))}</div>`);
        }
        return items;
      });
      return `<div class="fd-stage"><div class="fd-stage-label">Delivery to ${esc(state.app_label)}</div>${rows.join('')}</div>`;
    }

    function stageApp(m) {
      const entries = m.events.flatMap((e) => e.app);
      if (isRejected(m) || !m.events.length) {
        return `<div class="fd-stage fd-skipped"><div class="fd-stage-label">${esc(state.app_label)}</div><span class="badge badge--mono">${isRejected(m) ? 'never called' : 'waiting'}</span></div>`;
      }
      if (!entries.length) {
        return `<div class="fd-stage fd-pending"><div class="fd-stage-label">${esc(state.app_label)}</div><span class="badge badge--mono"><span class="fd-spinner"></span>waiting</span></div>`;
      }
      return `<div class="fd-stage"><div class="fd-stage-label">${esc(state.app_label)}</div>${entries.map((a) => `
        <div class="fd-attempt"><span class="badge ${a.ok === false ? 'badge--danger' : 'badge--success'}">${esc(a.label)}${a.duration_ms != null ? ' &middot; ' + ms(a.duration_ms) : ''}</span>
        ${a.detail ? `<div class="fd-sub">${esc(a.detail)}</div>` : ''}</div>`).join('')}</div>`;
    }

    function outbound(m) {
      const calls = m.events.flatMap((e) => e.outbound);
      return calls.map((c) => `<div class="fd-outbound"><span class="fd-stage-label">${esc(state.app_label)} calls out</span>
        <span class="badge ${c.ok === false ? 'badge--danger' : 'badge--primary'}">${esc(c.label)}${c.status != null ? ' &middot; ' + c.status : ''}${c.duration_ms != null ? ' &middot; ' + ms(c.duration_ms) : ''}</span>
        <span class="fd-sub">${offset(c.at, m.received_at)}${c.detail ? ' &middot; ' + esc(c.detail) : ''}</span></div>`).join('');
    }

    function message(m, is_new) {
      return `<article class="fd-msg${isRejected(m) ? ' fd-rejected' : ''}${is_new ? ' fd-new' : ''}">
        <div class="fd-msg-head"><span class="fd-time">${esc(clock(m.received_at))}</span>
          <span class="badge badge--primary">${esc(m.source_label)}</span>
          <span class="fd-label">${esc(m.label)}</span>
          ${m.group ? `<span class="fd-group" title="${esc(m.group)}">${esc(String(m.group).slice(0, 8))}</span>` : ''}</div>
        <div class="fd-flow">${stageSender(m)}${stageGateway(m)}${stageEvent(m)}${stageDelivery(m)}${stageApp(m)}</div>
        ${outbound(m)}</article>`;
    }

    function render() {
      if (!state) return;
      const messages = visibleMessages();
      $('fd-count').textContent = String(messages.length);
      $('fd-error').textContent = state.error || '';
      $('fd-legend').innerHTML = `${esc(state.sender_label)} &rarr; Event Gateway &rarr; ${esc(state.app_label)}`;
      $('fd-filters').innerHTML =
        (state.sources.length > 1
          ? [{ name: 'all', label: 'All' }, ...state.sources].map((s) => `<button type="button" class="button button--minimal" data-filter="${esc(s.name)}" aria-pressed="${filter === s.name}">${esc(s.label)}</button>`).join('')
          : '') + `<button type="button" class="button button--minimal" data-clear="1">Clear</button>`;
      if (!open) return;
      const key = JSON.stringify([messages, filter]);
      if (key === last_json) return;
      last_json = key;
      const list = $('fd-list');
      const top = list.scrollTop;
      list.innerHTML = messages.length
        ? messages.map((m) => message(m, !first_render && !seen.has(m.request_id))).join('')
        : `<div class="fd-empty body-s">No messages yet. Start a call, or send a webhook to one of the sources, and it will appear here.</div>`;
      list.scrollTop = top;
      messages.forEach((m) => seen.add(m.request_id));
      first_render = false;
    }

    async function poll() {
      try {
        const response = await fetch(endpoint, { cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        state = await response.json();
        $('fd-live').classList.remove('fd-off');
      } catch (error) {
        $('fd-live').classList.add('fd-off');
        $('fd-error').textContent = 'Could not load ' + endpoint;
        schedule(idle_poll);
        return;
      }
      render();
      schedule(open ? open_poll : idle_poll);
    }

    function schedule(delay) {
      clearTimeout(timer);
      timer = setTimeout(poll, delay);
    }

    setOpen(open);
  }

  window.FlowDrawer = { mount };
})();
