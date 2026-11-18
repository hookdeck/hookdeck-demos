// Mounts the shared topology pane (public/topology-pane/, from _shared/topology-pane) with this
// demo's scene bundle (/scenes/scenes.js, global HookdeckScenes) and feeds.
(function () {
  let last_fail = 0;
  let state_timer = null;
  let feed_ref = null;

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
          if (feed_ref && feed_ref.lastAppActivity() < at) { live.state('app', null); live.badge('app', null); }
        }, 1500);
      }
      last_fail = fail_next;
    } catch { /* the next poll retries */ }
  }

  const pane = TopologyPane.mount({
    kit: window.HookdeckScenes,
    title: 'Data flow',
    endpoint: '/api/flow',
    idleCaption: 'Waiting for a webhook. Start a call above, or run npm run call or npm run send in a terminal.',
    activeCaption: 'Click a packet or a node to see the details of that webhook below.',
    // The app's own record of what it answered: the fast path (see scenes/kit/host/flow-feed.ts).
    deliveries: {
      endpoint: '/api/deliveries',
      map: (d) => ({ id: d.id, event_id: d.hookdeck_event_id || null, label: d.type, bytes: d.bytes, status: d.status_code, at: d.received_at }),
    },
    onLive(live, feed) {
      feed_ref = feed;
      last_fail = 0;
      clearInterval(state_timer);
      pollState(live);
      state_timer = setInterval(() => pollState(live), 1000);
    },
  });
  window.__topology = pane;
})();
