/*
 * Topology pane: the scene kit's live topology (and its scripted scenes) in a pane at the bottom of
 * the page, in place of a per-message list. Load ds/styles.css, scenes.css and topology-pane.css,
 * the demo's scene bundle (global HookdeckScenes, see _shared/scenes), then:
 *
 *   TopologyPane.mount({
 *     kit: HookdeckScenes,                 // { scenes, scenarios, createFlowFeed, desktopCrop, PHONE_BREAKPOINT }
 *     endpoint: '/api/flow',               // the flow state, see _shared/flow-drawer/server.ts
 *     deliveries: { endpoint, map },       // the app's own fast feed (see scenes/host/flow-feed.ts)
 *     onLive: (live, feed) => {},          // called each time the live scene mounts
 *   });
 *
 * The flow state may carry `team_id` (the Hookdeck project); with it, the detail strip links to the
 * request or event in the Hookdeck dashboard: https://dashboard.hookdeck.com/{requests|events}/{id}?team_id=...
 * Clicking a node or a packet in the live view fills the detail strip with that message.
 */
(function () {
  const DASHBOARD = 'https://dashboard.hookdeck.com';
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function mount(options) {
    const kit = options.kit;
    const { scenes, scenarios, createFlowFeed, desktopCrop, PHONE_BREAKPOINT } = kit;
    const title = options.title || 'Data flow';
    const views = [{ id: 'live', title: 'Live' }, ...scenarios.map((s) => ({ id: s.id, title: s.title }))];

    const root = document.createElement('aside');
    root.className = 'tp-root';
    root.setAttribute('aria-label', title);
    root.innerHTML = `
      <div class="tp-bar">
        <button type="button" class="tp-toggle" id="tp-toggle" aria-expanded="true" aria-controls="tp-body">
          <span class="tp-chevron" aria-hidden="true">&#9650;</span><span class="tp-live" aria-hidden="true"></span><span class="tp-title">${esc(title)}</span>
        </button>
        <div class="tp-tabs" id="tp-tabs" role="tablist" aria-label="Topology view"></div>
        <div class="tp-controls">
          <span class="tp-count" id="tp-count"></span>
          <button type="button" class="button button--secondary button--small" id="tp-prev" hidden>Back</button>
          <button type="button" class="button button--secondary button--small" id="tp-next" hidden>Next</button>
          <button type="button" class="button button--secondary button--small" id="tp-replay">Replay latest</button>
        </div>
      </div>
      <div class="tp-body" id="tp-body">
        <div class="tp-canvas" id="tp-canvas" aria-hidden="true"></div>
        <p class="tp-caption body-s" id="tp-caption" aria-live="polite"></p>
        <div class="tp-detail tp-empty" id="tp-detail" aria-live="polite"></div>
      </div>`;
    document.body.append(root);
    document.body.classList.add('tp-enabled');
    const $ = (id) => root.querySelector('#' + id);
    const [canvas, tabs, caption, count, detail, toggle] = ['tp-canvas', 'tp-tabs', 'tp-caption', 'tp-count', 'tp-detail', 'tp-toggle'].map($);
    const [prev, next, replay] = ['tp-prev', 'tp-next', 'tp-replay'].map($);

    let current = 'live';
    let layout = null;
    let scene = null;
    let feed = null;
    let step = 0;
    let selected = null; // { request_id, event_id } of the message in the detail strip
    let flow = null; // last /api/flow response
    let detail_timer = null;

    // ---- Open and closed ----
    function setOpen(open) {
      root.classList.toggle('tp-open', open);
      document.body.classList.toggle('tp-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      try { sessionStorage.setItem('tp-open', open ? '1' : '0'); } catch { /* storage can be blocked */ }
    }
    let remembered = null;
    try { remembered = sessionStorage.getItem('tp-open'); } catch { /* storage can be blocked */ }
    setOpen(remembered !== '0');
    toggle.addEventListener('click', () => setOpen(!root.classList.contains('tp-open')));

    // ---- Tabs ----
    tabs.innerHTML = views.map((v) => `<button type="button" role="tab" data-id="${esc(v.id)}" aria-selected="${v.id === current}">${esc(v.title)}</button>`).join('');
    tabs.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-id]');
      if (!button) return;
      current = button.dataset.id;
      for (const b of tabs.querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.id === current));
      button.scrollIntoView({ inline: 'nearest', block: 'nearest' });
      mountScene();
    });

    const layoutForWidth = () => (canvas.clientWidth < PHONE_BREAKPOINT ? 'phone' : 'desktop');

    function renderCaption(text) {
      caption.replaceChildren(...String(text || '').split(/(`[^`]+`)/).filter(Boolean).map((part) => {
        if (part.length > 2 && part[0] === '`' && part.endsWith('`')) {
          const code = document.createElement('code');
          code.textContent = part.slice(1, -1);
          return code;
        }
        return document.createTextNode(part);
      }));
    }

    function teardown() {
      feed?.stop();
      feed = null;
      clearInterval(detail_timer);
      scene?.destroy();
      scene = null;
    }

    function mountScene() {
      teardown();
      layout = layoutForWidth();
      canvas.dataset.layout = layout;
      const is_live = current === 'live';
      scene = scenes[current + (layout === 'phone' ? '-mobile' : '')](canvas, { captions: false });
      if (layout === 'desktop') canvas.querySelector('svg').setAttribute('viewBox', desktopCrop);
      for (const el of [prev, next]) el.hidden = is_live;
      replay.textContent = is_live ? 'Replay latest' : 'Replay';
      detail.hidden = !is_live;
      if (is_live) mountLive();
      else {
        step = 0;
        if (reduced()) scene.goTo(0); else scene.playIntro();
        renderStep();
      }
    }

    function renderStep() {
      if (current === 'live') return;
      renderCaption(scene.captions[step]);
      count.textContent = `${step + 1} / ${scene.steps + 1}`;
      prev.disabled = step === 0;
      next.disabled = step === scene.steps;
    }

    function go(n, animate) {
      step = Math.max(0, Math.min(scene.steps, n));
      if (animate && !reduced() && step > 0) {
        scene.goTo(step - 1);
        scene.goTo(step, { animate: true });
      } else scene.goTo(step);
      renderStep();
    }
    prev.addEventListener('click', () => go(step - 1));
    next.addEventListener('click', () => go(step + 1, true));
    replay.addEventListener('click', () => {
      if (current === 'live') feed?.replay();
      else { step = 0; scene.playIntro(); renderStep(); }
    });

    // ---- Live ----
    function mountLive() {
      count.textContent = '';
      selected = null;
      renderCaption(options.idleCaption || 'Waiting for a webhook. Packets move as real ones arrive; click a node or a packet to see its details below.');
      renderDetail();
      const live = scene.live;
      feed = createFlowFeed({
        live,
        endpoint: options.endpoint || '/api/flow',
        deliveries: options.deliveries,
        onFlow: (state) => { flow = state; },
        onActivity: () => renderCaption(options.activeCaption || 'Click a packet or a node to see the details of that webhook below.'),
      });
      live.onSelect((selection) => {
        const data = (selection.kind === 'packet' && selection.data) || {};
        const latest = feed.latest();
        selected = selection.kind === 'packet' && (data.request_id || data.event_id)
          ? { request_id: data.request_id || null, event_id: data.event_id || null }
          : latest ? { request_id: latest.request_id, event_id: null } : null;
        renderDetail();
      });
      feed.start();
      options.onLive?.(live, feed);
      // The flow state arrives a few seconds after the packet; keep the strip current.
      detail_timer = setInterval(renderDetail, 1000);
    }

    // ---- The detail strip ----
    function findMessage() {
      const messages = feed?.messages() || [];
      if (!selected) return null;
      return messages.find((m) => selected.request_id && m.request_id === selected.request_id)
        || messages.find((m) => selected.event_id && m.events.some((e) => e.id === selected.event_id))
        || null;
    }

    const seconds = (ms) => (ms >= 10000 ? `${Math.round(ms / 1000)} s` : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);

    function link(message, event) {
      const team = flow?.team_id;
      if (!team) return '';
      const [kind, id] = event ? ['events', event.id] : ['requests', message.request_id];
      const href = `${DASHBOARD}/${kind}/${encodeURIComponent(id)}?team_id=${encodeURIComponent(team)}`;
      return `<a class="tp-link" href="${esc(href)}" target="_blank" rel="noopener">View in Hookdeck &#8599;</a>`;
    }

    function renderDetail() {
      if (current !== 'live') return;
      if (!selected) {
        detail.className = 'tp-detail tp-empty';
        detail.innerHTML = 'Click a node or a packet to see that webhook here: verification, each delivery attempt, what the app answered.';
        return;
      }
      const message = findMessage();
      if (!message) {
        detail.className = 'tp-detail tp-empty';
        detail.innerHTML = 'Hookdeck is still listing this request (its API lags about 3 s for a request and up to 10 s for its events). It will appear here.';
        return;
      }
      detail.className = 'tp-detail';
      const sender = flow?.sender_label || 'Sender';
      const time = new Date(message.received_at).toLocaleTimeString([], { hour12: false });
      const duplicate = !message.rejected && message.events.length === 0 && (message.ignored_count ?? 0) > 0;
      const verified = message.rejected
        ? `<span class="tp-pill tp-bad">Rejected: signature did not verify</span>`
        : message.verified === false ? `<span class="tp-pill tp-bad">Not verified</span>`
        : message.verified === true ? `<span class="tp-pill tp-ok">Verified</span>`
        : ''; // null: the source does not verify, so there is nothing to claim
      const sender_got = `<span class="tp-pill">${esc(sender)} got ${esc(message.sender_status)}</span>`;
      const lines = [];
      const focus = message.events.find((e) => selected.event_id && e.id === selected.event_id) || message.events[0];
      lines.push(`<div class="tp-line"><span class="tp-label">${esc(message.label)}</span><span class="tp-time">${esc(time)}</span><span class="tp-id">${esc(message.request_id)}</span>${verified}${sender_got}${link(message, focus)}</div>`);
      if (message.rejected) {
        lines.push('<div class="tp-line"><span class="tp-pill tp-warn">No event created, nothing delivered</span></div>');
      } else if (duplicate) {
        lines.push('<div class="tp-line"><span class="tp-pill tp-warn">Duplicate: accepted, then dropped by the deduplication rule</span><span class="tp-gap">no event, nothing delivered</span></div>');
      } else if (!message.events.length) {
        lines.push('<div class="tp-line tp-gap">Waiting for Hookdeck to create the event.</div>');
      }
      for (const event of message.events) {
        const parts = [];
        event.attempts.forEach((a, i) => {
          if (i > 0) {
            const gap = Date.parse(a.at) - Date.parse(event.attempts[i - 1].at);
            parts.push(`<span class="tp-gap">retry after ${seconds(gap)}</span>`);
          }
          const ok = a.status === 'SUCCESSFUL';
          const what = a.response_status ?? a.error_code ?? 'no answer';
          const latency = a.response_latency != null ? ` &middot; ${seconds(a.response_latency)}` : '';
          parts.push(`<span class="tp-pill ${ok ? 'tp-ok' : 'tp-bad'}">attempt ${esc(a.number)}: ${esc(what)}${latency}</span>`);
        });
        if (event.next_attempt_at && event.status !== 'SUCCESSFUL' && event.status !== 'FAILED') {
          const wait = Math.max(0, Math.round((Date.parse(event.next_attempt_at) - Date.now()) / 1000));
          parts.push(`<span class="tp-gap">next attempt in ${wait} s</span>`);
        }
        const app = event.app.map((x) => `<span class="tp-pill">${esc(flow?.app_label || 'App')}: ${esc(x.label)}${x.detail ? ` (${esc(x.detail)})` : ''}</span>`).join('');
        lines.push(`<div class="tp-line"><span class="tp-attempts">${parts.join('') || '<span class="tp-gap">No delivery attempt yet</span>'}</span>${app}</div>`);
      }
      detail.innerHTML = lines.join('');
    }

    new ResizeObserver(() => {
      if (scene && layoutForWidth() !== layout) mountScene();
    }).observe(canvas);
    mountScene();

    return {
      get scene() { return scene; },
      get feed() { return feed; },
      open: () => setOpen(true),
      close: () => setOpen(false),
      /** Selects a message by request id (or the latest) and fills the detail strip. */
      select(request_id) {
        const latest = feed?.latest();
        selected = request_id ? { request_id, event_id: null } : latest ? { request_id: latest.request_id, event_id: null } : null;
        renderDetail();
      },
    };
  }

  window.TopologyPane = { mount };
})();
