// Mounts the shared topology pane (public/topology-pane/, from _shared/topology-pane) with this
// demo's scene bundle (/scenes/scenes.js, global HookdeckScenes) and feeds.
//
// Inbound webhooks come from the shared feed, one per client (scenes/entry.ts): the app's own
// /api/deliveries (fast) and /api/flow for rejected requests and duplicates. Vapi is
// two-directional: when an endpoint finishes its background lookup and posts the result to the
// call's controlUrl, this host sends a packet along that client's `return` edge.
(function () {
  const CLIENTS = ['acme', 'globex'];
  let last_fail = {};
  let state_timer = null;
  let outbound_timer = null;
  let feed_ref = null;

  // "Fail the next N deliveries" (each client's failure injection card) shows on that client's endpoint before any delivery arrives.
  async function pollState(live) {
    try {
      const chaos = await (await fetch('/api/chaos', { cache: 'no-store' })).json();
      for (const slug of CLIENTS) {
        const fail_next = chaos[slug]?.fail_next ?? 0;
        const was = last_fail[slug] ?? 0;
        if (fail_next > 0 && fail_next !== was) {
          live.state('app_' + slug, 'down');
          live.badge('app_' + slug, `failing next ${fail_next}`, 'danger');
        } else if (fail_next === 0 && was > 0) {
          const at = Date.now();
          setTimeout(() => {
            // The feed owns the badge once a delivery has been answered; clear only an idle one.
            if (feed_ref && feed_ref.lastAppActivity() < at) { live.state('app_' + slug, null); live.badge('app_' + slug, null); }
          }, 1500);
        }
        last_fail[slug] = fail_next;
      }
    } catch { /* the next poll retries */ }
  }

  // The app's own record of results it posted into live calls.
  function watchOutbound(live) {
    const seen = new Set();
    let first = true;
    const poll = async () => {
      try {
        const list = await (await fetch('/api/outbound', { cache: 'no-store' })).json();
        for (const item of list) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          if (first || !CLIENTS.includes(item.client)) continue; // history is not replayed
          live.badge('app_' + item.client, item.ok ? 'result ready' : 'lookup failed', item.ok ? 'blue' : 'danger', 6);
          live.send('return_' + item.client, { label: 'add-message', data: { outbound: item.label } }).then(() => {
            live.badge('agent_' + item.client, item.ok ? 'result spoken' : 'not delivered', item.ok ? 'success' : 'danger', 6);
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
      map: (d) => ({ id: d.id, event_id: d.hookdeck_event_id || null, label: d.type, bytes: d.bytes, status: d.status_code, at: d.received_at }),
    },
    onLive(live, feed) {
      feed_ref = feed;
      last_fail = {};
      clearInterval(state_timer);
      clearInterval(outbound_timer);
      pollState(live);
      state_timer = setInterval(() => pollState(live), 1000);
      outbound_timer = watchOutbound(live);
    },
  });
  window.__topology = pane;
})();
