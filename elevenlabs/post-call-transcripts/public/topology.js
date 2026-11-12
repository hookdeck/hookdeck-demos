// The live topology: the scene kit's ElevenLabs scene (scenes/post-call.ts, bundled into
// /scenes/scenes.js as HookdeckScenes), driven by /api/flow. The tabs also play the four scripted
// scenarios with captions, the same scenes the website embeds and the capture script renders.
(function () {
  const { scenes, scenarios, createFlowFeed, desktopCrop, PHONE_BREAKPOINT } = window.HookdeckScenes;
  const canvas = document.getElementById('topoCanvas');
  const tabs = document.getElementById('topoTabs');
  const caption = document.getElementById('topoCaption');
  const count = document.getElementById('topoCount');
  const hint = document.getElementById('topoHint');
  const [prev, next, replay] = ['topoPrev', 'topoNext', 'topoReplay'].map((id) => document.getElementById(id));
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  const views = [{ id: 'live', title: 'Live' }, ...scenarios.map((s) => ({ id: s.id, title: s.title, captions: s.captions }))];
  let current = 'live';
  let layout = null;
  let scene = null;
  let feed = null;
  let step = 0;
  let state_timer = null;
  let last_fail = 0;

  tabs.innerHTML = views.map((v) => `<button type="button" role="tab" data-id="${v.id}" aria-selected="${v.id === current}">${v.title}</button>`).join('');
  tabs.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-id]');
    if (!button) return;
    current = button.dataset.id;
    for (const b of tabs.querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.id === current));
    mount();
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
    clearInterval(state_timer);
    scene?.destroy();
    scene = null;
  }

  function mount() {
    teardown();
    layout = layoutForWidth();
    canvas.dataset.layout = layout;
    const is_live = current === 'live';
    const name = current + (layout === 'phone' ? '-mobile' : '');
    scene = scenes[name](canvas, { captions: false });
    if (layout === 'desktop') canvas.querySelector('svg').setAttribute('viewBox', desktopCrop);
    for (const el of [prev, next]) el.hidden = is_live;
    replay.textContent = is_live ? 'Replay latest' : 'Replay';
    hint.textContent = is_live
      ? 'Packets move as real webhooks arrive. Click a node or a packet to open it in Data flow.'
      : 'A scripted run of the same scene: step through it with Next.';
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

  // ---- Live ----

  function mountLive() {
    count.textContent = '';
    renderCaption('Waiting for a webhook. Start a call below, or run npm run call or npm run send in a terminal.');
    const live = scene.live;
    feed = createFlowFeed({
      live,
      // The app's own record of what it answered: the fast path (see flow-feed.ts).
      deliveries: {
        endpoint: '/api/deliveries',
        map: (d) => ({ id: d.id, event_id: d.hookdeck_event_id || null, label: d.type, bytes: d.bytes, status: d.status_code, at: d.received_at }),
      },
      onActivity: () => renderCaption('Webhook in flight. Click the packet, or a node, to see its request in Data flow.'),
    });
    live.onSelect((selection) => {
      const data = (selection.kind === 'packet' && selection.data) || {};
      const messages = feed.messages();
      openDrawerAt(
        messages.find((m) => m.request_id === data.request_id) ||
        messages.find((m) => data.event_id && m.events.some((e) => e.id === data.event_id)) ||
        feed.latest(),
      );
    });
    feed.start();
    pollState(live);
    state_timer = setInterval(() => pollState(live), 1000);
  }

  // "Fail the next N deliveries" (the Retry demo) shows on the app node before any delivery arrives.
  async function pollState(live) {
    try {
      const { fail_next } = await (await fetch('/api/state', { cache: 'no-store' })).json();
      if (fail_next > 0 && fail_next !== last_fail) {
        live.state('app', 'down');
        live.badge('app', `failing next ${fail_next}`, 'danger');
      } else if (fail_next === 0 && last_fail > 0) {
        const at = Date.now();
        setTimeout(() => {
          // The feed owns the badge once a delivery has been answered; clear only an idle one.
          if (feed && feed.lastAppActivity() < at) { live.state('app', null); live.badge('app', null); }
        }, 1500);
      }
      last_fail = fail_next;
    } catch { /* the next poll retries */ }
  }

  replay.addEventListener('click', () => {
    if (current === 'live') { if (feed) feed.replay(); } else { step = 0; scene.playIntro(); renderStep(); }
  });

  // ---- Click-through: open the flow drawer at a message ----

  function openDrawerAt(message) {
    const handle = document.getElementById('fd-handle');
    if (!handle) return;
    if (!document.body.classList.contains('fd-open')) handle.click();
    if (!message) return;
    const clock = new Date(message.received_at).toLocaleTimeString([], { hour12: false });
    let tries = 0;
    const find = () => {
      const article = [...document.querySelectorAll('.fd-msg')].find((a) =>
        a.querySelector('.fd-time')?.textContent === clock &&
        a.querySelector('.fd-label')?.textContent === message.label &&
        (!message.group || a.querySelector('.fd-group')?.getAttribute('title') === message.group));
      if (article) {
        document.querySelectorAll('.fd-focus').forEach((e) => e.classList.remove('fd-focus'));
        article.classList.add('fd-focus');
        article.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else if (++tries < 20) setTimeout(find, 150);
    };
    find();
  }

  new ResizeObserver(() => {
    if (scene && layoutForWidth() !== layout) mount();
  }).observe(canvas);
  mount();
  window.__topology = { get scene() { return scene; }, get feed() { return feed; } };
})();
