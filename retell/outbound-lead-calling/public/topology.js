// Mounts the shared topology pane (public/topology-pane/, from _shared/topology-pane) with this
// demo's scene bundle (/scenes/scenes.js, global HookdeckScenes) and feeds.
//
// Inbound webhooks come from the shared feed (the app's /api/deliveries, fast, and /api/flow for
// rejected requests and duplicates). Retell is two-directional, so this host adds the outbound
// side: when the app starts a call (or, with ENABLE_LIVE_INJECTION, injects a function result into
// a live call) a packet travels the `start` edge from the app to Retell.
(function () {
  let last_fail = 0;
  let state_timer = null;
  let outbound_timer = null;
  let feed_ref = null;

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
    } catch { /* the next poll retries */ }
  }

  // The app's own record of calls it made to Retell's API.
  function watchOutbound(live) {
    const seen = new Set();
    let first = true;
    let live_injection = false;
    const poll = async () => {
      try {
        const list = await (await fetch('/api/outbound', { cache: 'no-store' })).json();
        try { live_injection = (await (await fetch('/api/state', { cache: 'no-store' })).json()).live_injection; } catch { /* keep the last value */ }
        for (const item of list) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          if (first) continue; // history is not replayed
          if (item.kind === 'update_live_call' && !live_injection) continue; // the optional path shows only when it is on
          const start_call = item.kind === 'start_call';
          live.badge('app', start_call ? 'Calling' : 'adding context', 'blue', 6);
          live.send('start', { data: { outbound: item.kind } }).then(() => {
            live.badge('agent', start_call ? 'call created' : item.ok ? 'context added' : 'update failed', item.ok ? 'blue' : 'danger', 6);
          });
        }
      } catch { /* the next poll retries */ }
      first = false;
    };
    poll();
    return setInterval(poll, 700);
  }

  const pane = TopologyPane.mount({
    kit: window.HookdeckScenes,
    title: 'Data flow',
    endpoint: '/api/flow',
    idleCaption: 'Waiting for a call. Start one above, or run npm run simulate in a terminal.',
    activeCaption: 'Click a packet or a node to see the details of that webhook below.',
    // The app's own record of what it answered: the fast path (see scenes/kit/host/flow-feed.ts).
    deliveries: {
      endpoint: '/api/deliveries',
      map: (d) => ({ id: d.id, event_id: d.hookdeck_event_id || null, label: d.type.replace(/^call_/, ''), bytes: d.bytes, status: d.status_code, at: d.received_at }),
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
