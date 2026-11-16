// Mounts the shared topology pane (public/topology-pane/, from _shared/topology-pane) with this
// demo's scene bundle (/scenes/scenes.js, global HookdeckScenes) and feeds.
//
// Webhooks come from the shared feed: the app's /api/answered (fast: the app's own record of what
// it answered) and /api/flow (Event Gateway's requests, events and attempts, for duplicates and
// anything the app never saw). LiveKit only sends to this app, so there is no outbound edge.
(function () {
  let last_fail = 0;
  let state_timer = null;
  let feed_ref = null;

  // "Fail the next N deliveries" (the failure injection card) shows on the app node before any delivery arrives.
  async function pollState(live) {
    try {
      const { fail_next, source_type } = await (await fetch('/api/state', { cache: 'no-store' })).json();
      // Only a LIVEKIT source type verifies in Event Gateway; the default WEBHOOK source leaves it to the app.
      document.body.classList.toggle('no-verify', source_type !== 'LIVEKIT');
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
    idleCaption: 'Waiting for a webhook. Run npm run activity in a terminal, or create a room in LiveKit.',
    activeCaption: 'Click a packet or a node to see the details of that webhook below.',
    deliveries: {
      endpoint: '/api/answered',
      map: (d) => ({ id: d.id, event_id: d.hookdeck_event_id || null, label: d.type, bytes: d.bytes, status: d.status_code, at: d.received_at }),
    },
    onLive(live, feed) {
      feed_ref = feed;
      last_fail = 0;
      clearInterval(state_timer);
      // The default source verifies nothing in Event Gateway, so the first chip says Receive and the
      // feed's "verified · stored" badge reads "stored".
      const badge = live.badge;
      live.badge = (node, label, tone, ttl) => badge(node, label === 'verified · stored' ? 'stored' : label, tone, ttl);
      pollState(live);
      state_timer = setInterval(() => pollState(live), 1000);
    },
  });
  window.__topology = pane;
})();
