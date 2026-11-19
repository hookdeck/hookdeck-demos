// Mounts the shared topology pane (public/topology-pane/, from _shared/topology-pane) with this
// demo's scene bundle (/scenes/scenes.js, global HookdeckScenes) and feeds.
//
// Webhooks come from the shared feed: the app's /api/answered (fast: the app's own record of what
// it answered) and /api/flow (Event Gateway's requests, events and attempts, for duplicates and
// anything the app never saw). The one outbound edge, `start`, is the app asking LiveKit's Ingress API to
// pull a scene's soundtrack into the room (the storyteller triggers it); it comes from the app's /api/outbound.
(function () {
  let last_fail = 0;
  let state_timer = null;
  let feed_ref = null;
  let outbound_timer = null;

  // "Fail the next N deliveries" (the failure injection card) shows on the app node before any delivery arrives.
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
    } catch (error) { console.warn(`topology: /api/state failed: ${error?.message || error} (the next poll retries)`); }
  }

  // The app's own record of calls it made to LiveKit's Ingress API.
  function watchOutbound(live) {
    const seen = new Set();
    let first = true;
    const poll = async () => {
      try {
        const list = await (await fetch('/api/outbound', { cache: 'no-store' })).json();
        for (const item of list) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          if (first) continue; // history is not replayed
          live.badge('app', `soundtrack: ${item.scene}`, 'blue', 6);
          live.send('start', { data: { outbound: item.kind } }).then(() => {
            live.badge('agent', item.ok ? 'ingress created' : 'ingress failed', item.ok ? 'blue' : 'danger', 6);
          });
        }
      } catch (error) { console.warn(`topology: /api/outbound failed: ${error?.message || error} (the next poll retries)`); }
      first = false;
    };
    poll();
    return setInterval(poll, 700);
  }

  const pane = TopologyPane.mount({
    kit: window.HookdeckScenes,
    title: 'Data flow',
    endpoint: '/api/flow',
    idleCaption: 'Waiting for a webhook. Join a call above and the webhooks start to arrive.',
    activeCaption: 'Click a packet or a node to see the details of that webhook below.',
    deliveries: {
      endpoint: '/api/answered',
      map: (d) => ({ id: d.id, event_id: d.hookdeck_event_id || null, label: d.type, bytes: d.bytes, status: d.status_code, at: d.received_at }),
    },
    onLive(live, feed) {
      feed_ref = feed;
      last_fail = 0;
      clearInterval(state_timer);
      clearInterval(outbound_timer);
      pollState(live);
      state_timer = setInterval(() => pollState(live), 1000);
      outbound_timer = watchOutbound(live);
    },
  });
  window.__topology = pane;
})();
