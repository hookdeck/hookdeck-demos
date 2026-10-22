/*
 * The demo's data-flow view. One render function draws the MCP server, Event
 * Gateway and the agent, and moves each event between them. Two modes feed it:
 *
 * - Live (default): polls /api/state every second. A stage animates when the
 *   page first sees it, so what moves is what the sender, Event Gateway's API
 *   and the agent report.
 * - Scripted (?scene=<name>): a fixed timeline per scene, for capturing GIFs.
 *   &t=<seconds> freezes the clock at one frame; &delivery=http|cli and
 *   &auth=bearer change the setup; &theme=dark switches tokens.
 */
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const Y = 300;
  const X = { senderOut: 300, egIn: 544, eg: 600, egOut: 656, listenIn: 755, listenOut: 925, agentIn: 960, agent: 1070 };
  const TRAVEL = 1100;
  const BEAT = 450;
  const SETTLE = 3500;
  const TO_STACK = 700;
  const smooth = (u) => u * u * (3 - 2 * u);
  const clamp = (u) => Math.max(0, Math.min(1, u));
  const short = (id) => (id ? `${id.slice(0, 4)}…${id.slice(-6)}` : '');
  const params = new URLSearchParams(location.search);

  // ---- SVG helpers ----

  const el = (name, attrs = {}, parent) => {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v);
    parent?.appendChild(node);
    return node;
  };
  const text = (parent, x, y, content, attrs = {}) => {
    const node = el('text', { x, y, ...attrs }, parent);
    node.textContent = content;
    return node;
  };
  /** A mono label in a small rounded box, as the design system's badges. */
  const tag = (parent, x, y, label, tone = '', anchor = 'middle') => {
    const g = el('g', { class: `tag ${tone}` }, parent);
    const w = label.length * 7.25 + 16;
    const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'start' ? x : x - w;
    el('rect', { x: x0, y: y - 11, width: w, height: 22, rx: 4 }, g);
    text(g, x0 + w / 2, y + 4, label, { 'text-anchor': 'middle' });
    return g;
  };
  const node = (svg, { x, y, w, h, icon, eyebrow, title, dim }) => {
    const g = el('g', {}, svg);
    el('rect', { x, y, width: w, height: h, rx: 10, class: `node${dim ? ' dim' : ''}` }, g);
    el('rect', { x: x + 14, y: y + h / 2 - 18, width: 36, height: 36, rx: 6, class: 'chip-bg', opacity: dim ? 0.5 : 1 }, g);
    text(g, x + 32, y + h / 2 + 9, icon, { class: 'ms', 'text-anchor': 'middle', opacity: dim ? 0.5 : 1 });
    text(g, x + 62, y + h / 2 - 7, eyebrow, { class: 'mono muted', 'font-size': 11 });
    text(g, x + 62, y + h / 2 + 15, title, { 'font-size': 17, 'font-weight': 500, opacity: dim ? 0.6 : 1 });
    return g;
  };

  /** A point along a polyline, `u` from 0 to 1 by length. */
  const along = (pts, u) => {
    if (pts.length === 1) return pts[0];
    const lengths = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
    let d = clamp(u) * lengths.reduce((a, b) => a + b, 0);
    for (let i = 0; i < lengths.length; i++) {
      if (d <= lengths[i] || i === lengths.length - 1) {
        const f = lengths[i] ? Math.min(1, d / lengths[i]) : 1;
        return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * f, y: pts[i].y + (pts[i + 1].y - pts[i].y) * f };
      }
      d -= lengths[i];
    }
    return pts.at(-1);
  };
  const line = (...xs) => xs.map((x) => ({ x, y: Y }));

  // ---- What each stage looks like, and what the caption says ----

  /** The route to the agent: through the `hookdeck listen` pill in CLI mode. */
  const toAgent = (v) => (v.delivery === 'cli' ? [X.eg, X.egOut, X.listenIn, X.listenOut, X.agentIn] : [X.eg, X.egOut, X.agentIn]);

  const STAGES = {
    sent: () => ({ pts: line(X.senderOut, X.egIn), dur: TRAVEL, tone: 'info', label: 'POST', finish: 'info' }),
    refused: (v, s) => ({ pts: line(X.egIn), dur: TRAVEL, tone: 'bad', label: s.count > 1 ? `401 ×${s.count}` : '401', back: '401', terminal: 'eg' }),
    stored: () => ({ pts: line(X.egIn, X.eg), dur: 700, tone: 'info', label: 'STORED · 200' }),
    parked: () => ({ pts: line(X.eg), dur: BEAT, tone: 'warn', label: 'STORED · NO EVENT' }),
    recovered: () => ({ pts: line(X.eg), dur: BEAT, tone: 'info', label: 'REQUEST RETRIED' }),
    bounced: (v, s) => ({
      pts: line(...toAgent(v), ...toAgent(v).reverse().slice(1)),
      dur: TRAVEL * 1.7,
      tone: 'info',
      finish: 'warn',
      label: `${s.status ?? s.code ?? 'ERROR'} · RETRY`,
    }),
    handled: (v, s) => ({ pts: line(...toAgent(v)), dur: TRAVEL * 1.2, tone: 'info', finish: 'ok', label: `HANDLED${s.attempt ? ` · ATTEMPT ${s.attempt}` : ''}`, terminal: 'agent' }),
    failed: () => ({ pts: line(X.eg), dur: BEAT, tone: 'bad', label: 'FAILED', terminal: 'eg' }),
    dropped: () => ({ pts: line(X.senderOut, X.egIn, X.eg), dur: TRAVEL, tone: 'muted', finish: 'muted', label: 'DUPLICATE · DROPPED', terminal: 'eg' }),
  };

  const captionFor = (stage, v) =>
    ({
      sent: 'The MCP server POSTs incident.created to the callback URL, the Event Gateway source, signed with the subscription’s secret.',
      refused: 'Event Gateway checks the signature with the subscription’s secret. It doesn’t verify, so the server gets 401 and the event is never delivered.',
      stored: 'The signature verifies. Event Gateway stores the request before it answers 200, so the agent’s downtime never counts against the server.',
      parked:
        'hookdeck listen is down. Event Gateway stores the request, but no event is created, and it doesn’t yet deliver it when listen reconnects.',
      recovered: 'listen is back. The agent’s recover.ts retries the stored request, which creates the event.',
      bounced:
        v.auth === 'BEARER_TOKEN'
          ? 'The agent didn’t take it. The retry rule tries again, with the bearer token.'
          : 'The agent didn’t take it. The retry rule tries again, re-signed with a fresh webhook-timestamp.',
      handled:
        v.auth === 'BEARER_TOKEN'
          ? 'Delivered with Authorization: Bearer, as an API gateway in front of the agent requires. The agent handles each eventId once.'
          : 'Delivered, re-signed with a fresh webhook-timestamp. The agent verifies it with the 5-minute window and handles each eventId once.',
      failed: 'Retries ran out and the event settled as FAILED. The agent’s recovery retries it.',
      dropped: 'The same webhook-id again within the hour: the deduplicate rule drops it, and the agent never sees it.',
      provision: 'The agent creates an MCP Events source holding a fresh whsec_ secret, and a connection back to itself.',
      subscribe: 'It calls events/subscribe with the source URL as the callback, and the secret.',
      refresh: 'Before refreshBefore, the agent calls events/subscribe again with the same name, arguments, URL and secret.',
      challenge: 'The MCP server sends a signed verification challenge to the source URL.',
      echo: 'Event Gateway verifies it with the secret and echoes the challenge. The agent never sees it.',
      granted: 'The server returns the subscription id and refreshBefore. Events can flow.',
    })[stage];

  // The subscribe flow runs on lanes above the main line.
  const LANE = { top: 120, mid: 175 };
  const SUB = {
    provision: () => ({ pts: [{ x: 1030, y: 258 }, { x: 1030, y: LANE.mid }, { x: 620, y: LANE.mid }, { x: 620, y: 244 }], label: 'CREATE SOURCE + CONNECTION' }),
    subscribe: () => ({ pts: [{ x: 1110, y: 258 }, { x: 1110, y: LANE.top }, { x: 150, y: LANE.top }, { x: 150, y: 258 }], label: 'events/subscribe · url = source URL' }),
    refresh: () => ({ pts: [{ x: 1110, y: 258 }, { x: 1110, y: LANE.top }, { x: 150, y: LANE.top }, { x: 150, y: 258 }], label: 'events/subscribe · refresh' }),
    challenge: () => ({ pts: [{ x: 240, y: 258 }, { x: 240, y: LANE.mid }, { x: 580, y: LANE.mid }, { x: 580, y: 244 }], label: 'SIGNED CHALLENGE' }),
    echo: () => ({ pts: [{ x: 580, y: 244 }, { x: 580, y: LANE.mid }, { x: 240, y: LANE.mid }, { x: 240, y: 258 }], label: 'CHALLENGE ECHOED', finish: 'ok' }),
    granted: () => ({ pts: [{ x: 150, y: 258 }, { x: 150, y: LANE.top }, { x: 1110, y: LANE.top }, { x: 1110, y: 258 }], label: 'id · refreshBefore', finish: 'ok' }),
  };

  /** Lays a list of stages end to end: each starts when it was seen, or when the one before it ends. */
  const timeline = (stages, table, v) => {
    let t = -Infinity;
    return stages.map((s) => {
      const spec = table[s.stage](v, s);
      const dur = spec.dur ?? TRAVEL * 1.2;
      const start = Math.max(s.at, t);
      t = start + dur;
      return { ...spec, stage: s.stage, start, end: t, dur };
    });
  };

  // ---- The render ----

  /** Whether a point on the main line is over a node, so its label goes above the node. */
  const overNode = (x, cli) => x <= 305 || (x >= 540 && x <= 660) || (cli && x >= 750 && x <= 930) || x >= 955;

  function render(svg, v, now) {
    svg.replaceChildren();
    const cli = v.delivery === 'cli';
    const listenUp = !cli || v.listening !== false;

    // Subscription summary.
    if (v.subscription) {
      const refresh = v.subscription.refreshBefore ? ` · REFRESH BEFORE ${new Date(v.subscription.refreshBefore).toISOString().slice(11, 19)}Z` : '';
      tag(svg, 600, 48, `SUBSCRIBED ${short(v.subscription.id)}${refresh}`, 'ok');
    } else {
      tag(svg, 600, 48, v.agentDown ? 'AGENT NOT RUNNING' : 'NOT SUBSCRIBED', v.agentDown ? 'bad' : '');
    }

    // Connectors.
    el('line', { x1: X.senderOut, y1: Y, x2: X.egIn, y2: Y, class: 'conn' }, svg);
    if (cli) {
      el('line', { x1: X.egOut, y1: Y, x2: X.listenIn, y2: Y, class: `conn${listenUp ? '' : ' down'}` }, svg);
      el('line', { x1: X.listenOut, y1: Y, x2: X.agentIn, y2: Y, class: `conn${listenUp ? '' : ' down'}` }, svg);
    } else {
      el('line', { x1: X.egOut, y1: Y, x2: X.agentIn, y2: Y, class: 'conn' }, svg);
      tag(svg, (X.egOut + X.agentIn) / 2, Y - 26, 'HTTPS · PUBLIC URL');
    }
    tag(svg, (X.senderOut + X.egIn) / 2, Y - 26, 'WEBHOOK POST');
    tag(svg, (X.egOut + X.agentIn) / 2, Y + 48, v.auth === 'BEARER_TOKEN' ? 'AUTHORIZATION: BEARER' : 'RE-SIGNED · STANDARD WEBHOOKS', 'info');

    // Nodes.
    node(svg, { x: 60, y: Y - 42, w: 240, h: 84, icon: 'dns', eyebrow: 'MCP SERVER', title: 'Stand-in sender' });
    tag(svg, 180, Y + 70, 'incident.created', 'info');

    el('rect', { x: X.eg - 56, y: Y - 56, width: 112, height: 112, rx: 12, class: 'eg' }, svg);
    el('image', { href: 'ds/assets/brand/logo-icon.svg', x: X.eg - 22, y: Y - 46, width: 44, height: 31 }, svg);
    text(svg, X.eg, Y + 42, 'EVENT GATEWAY', { class: 'mono muted', 'font-size': 10, 'text-anchor': 'middle' });
    ['VERIFY', 'STORE', 'DEDUP', 'RETRY'].forEach((label, i) => tag(svg, X.eg + (i - 1.5) * 78, Y + 82, label));

    let listenNode = null;
    if (cli) {
      listenNode = node(svg, { x: X.listenIn, y: Y - 28, w: X.listenOut - X.listenIn, h: 56, icon: 'terminal', eyebrow: 'HOOKDECK LISTEN', title: listenUp ? 'connected' : 'stopped', dim: !listenUp });
    }

    node(svg, { x: X.agentIn, y: Y - 42, w: 220, h: 84, icon: 'smart_toy', eyebrow: 'AGENT', title: 'MCP client' });
    tag(svg, X.agent, Y + 70, v.auth === 'BEARER_TOKEN' ? 'CHECKS THE TOKEN' : 'SIGNATURE · 5-MIN WINDOW');
    tag(svg, X.agent, Y + 98, 'EACH eventId ONCE');
    if (v.failing) tag(svg, X.agentIn + 220, Y - 64, 'ANSWERING 503', 'bad', 'end');

    // The subscribe flow.
    const captions = [];
    const subs = timeline(v.sub ?? [], SUB, v);
    const lastSub = subs.at(-1);
    if (lastSub && now >= subs[0].start && now < lastSub.end + 2500) {
      for (const seg of subs) {
        if (now < seg.start) continue;
        el('polyline', { points: seg.pts.map((p) => `${p.x},${p.y}`).join(' '), class: 'lane' }, svg);
        const mid = along(seg.pts, 0.5);
        tag(svg, mid.x, mid.y - 16, seg.label, now >= seg.end ? seg.finish ?? '' : 'info');
      }
      for (const seg of subs) {
        if (now < seg.start || now >= seg.end) continue;
        const p = along(seg.pts, smooth((now - seg.start) / seg.dur));
        el('circle', { cx: p.x, cy: p.y, r: 8, class: 'dot info' }, svg);
        captions.push({ start: seg.start, text: captionFor(seg.stage, v) });
      }
      const done = subs.filter((s) => now >= s.end).at(-1);
      if (done) captions.push({ start: done.start, text: captionFor(done.stage, v) });
    }

    // Events.
    const stacks = { agent: [], eg: [] };
    const resting = new Map();
    const draws = [];
    for (const packet of v.packets) {
      const segs = timeline(packet.stages, STAGES, v);
      if (!segs.length || now < segs[0].start) continue;
      const active = segs.find((s) => now >= s.start && now < s.end);
      const last = segs.filter((s) => now >= s.start).at(-1);
      captions.push(...segs.filter((s) => now >= s.start).map((s) => ({ start: s.start, text: captionFor(s.stage, v) })));
      if (active) {
        const u = (now - active.start) / active.dur;
        const p = along(active.pts, smooth(u));
        const tone = u > 0.85 && active.finish ? active.finish : active.tone;
        draws.push({ p, tone, label: active.label, back: active.back && { u } });
        continue;
      }
      if (last.terminal && now > last.end + SETTLE) {
        stacks[last.terminal].push({ tone: last.finish ?? last.tone, since: last.end + SETTLE, from: last.pts.at(-1) });
        continue;
      }
      const at = last.pts.at(-1);
      const key = `${at.x},${at.y}`;
      const index = resting.get(key) ?? 0;
      resting.set(key, index + 1);
      const tone = last.finish ?? last.tone;
      draws.push({ p: { x: at.x + index * 22, y: at.y }, tone, label: index === 0 ? last.label : null });
    }

    // Settled events stack up under the agent (handled) and under Event Gateway (refused, dropped, failed).
    const stackAt = { agent: { x: X.agentIn + 16, y: Y + 132 }, eg: { x: X.eg - 112, y: Y + 132 } };
    for (const [where, items] of Object.entries(stacks)) {
      if (!items.length) continue;
      text(svg, stackAt[where].x - 4, stackAt[where].y + 30, where === 'agent' ? 'HANDLED' : 'REFUSED, DROPPED OR FAILED', { class: 'mono muted', 'font-size': 11 });
      items.slice(-10).forEach((item, i) => {
        const slot = { x: stackAt[where].x + i * 22, y: stackAt[where].y };
        const u = smooth(clamp((now - item.since) / TO_STACK));
        const p = { x: item.from.x + (slot.x - item.from.x) * u, y: item.from.y + (slot.y - item.from.y) * u };
        el('circle', { cx: p.x, cy: p.y, r: 8 - 2 * u, class: `dot ${item.tone}` }, svg);
      });
    }
    for (const d of draws) {
      if (d.tone === 'info') el('circle', { cx: d.p.x, cy: d.p.y, r: 16, class: 'halo' }, svg);
      el('circle', { cx: d.p.x, cy: d.p.y, r: 9, class: `dot ${d.tone}` }, svg);
      if (d.label) tag(svg, d.p.x, overNode(d.p.x, cli) ? Y - 70 : d.p.y - 30, d.label, d.tone === 'muted' ? '' : d.tone);
      if (d.back) {
        // The 401 travels back to the sender.
        const b = along(line(X.egIn, X.senderOut), smooth(d.back.u));
        tag(svg, b.x, Y + 28, '401', 'bad');
      }
    }

    // Events pass under `hookdeck listen`, as through a tunnel.
    if (listenNode) svg.appendChild(listenNode);

    const latest = captions.sort((a, b) => b.start - a.start)[0];
    return latest && now - latest.start < 9000 ? latest.text : null;
  }

  // ---- Scripted scenes ----

  const seq = (first, ...rest) => [{ ...first }, ...rest.map((s) => ({ at: 0, ...s }))];
  const SCENES = {
    subscribe: {
      duration: 11000,
      view: () => ({ sub: seq({ stage: 'provision', at: 600 }, { stage: 'subscribe' }, { stage: 'challenge' }, { stage: 'echo' }, { stage: 'granted' }), packets: [] }),
      subscribed: (t) => t > 6600,
    },
    delivery: {
      duration: 8000,
      view: () => ({ packets: [{ stages: seq({ stage: 'sent', at: 600 }, { stage: 'stored' }, { stage: 'handled', attempt: 1 }) }] }),
    },
    duplicate: {
      duration: 10000,
      view: () => ({
        packets: [
          { stages: seq({ stage: 'sent', at: 600 }, { stage: 'stored' }, { stage: 'handled', attempt: 1 }) },
          { stages: [{ stage: 'dropped', at: 4600 }] },
        ],
      }),
    },
    'bad-signature': {
      duration: 7500,
      view: () => ({ packets: [{ stages: seq({ stage: 'sent', at: 600 }, { stage: 'refused', count: 3 }) }] }),
    },
    'agent-down': {
      duration: 11500,
      view: (t) => ({
        failing: t < 5600,
        packets: [{ stages: seq({ stage: 'sent', at: 600 }, { stage: 'stored' }, { stage: 'bounced', status: 503 }, { stage: 'handled', at: 6200, attempt: 2 }) }],
      }),
    },
    'listen-gap': {
      duration: 12500,
      delivery: 'cli',
      view: (t) => ({
        listening: t > 5200,
        packets: [{ stages: seq({ stage: 'sent', at: 600 }, { stage: 'stored' }, { stage: 'parked' }, { stage: 'recovered', at: 6000 }, { stage: 'handled', attempt: 1 }) }],
      }),
    },
  };

  function runScene(name) {
    const scene = SCENES[name];
    if (!scene) throw new Error(`Unknown scene ${name}. Scenes: ${Object.keys(SCENES).join(', ')}`);
    document.body.classList.add('scene');
    const svg = document.getElementById('diagram');
    const caption = document.getElementById('caption');
    const base = {
      delivery: params.get('delivery') || scene.delivery || 'cli',
      auth: params.get('auth') === 'bearer' ? 'BEARER_TOKEN' : 'STANDARD_WEBHOOKS',
      listening: true,
      failing: false,
    };
    const subscription = { id: 'sub_9f3a1c0e5b7d4a2f8c6e1d0b3a5f7c9e', refreshBefore: null };
    const frame = (t) => {
      const v = { ...base, ...scene.view(t) };
      v.subscription = !scene.subscribed || scene.subscribed(t) ? subscription : null;
      caption.textContent = render(svg, v, t) ?? ' ';
    };
    const fixed = params.get('t');
    if (fixed !== null) {
      frame(Number(fixed) * 1000);
      document.body.dataset.ready = 'true';
      return;
    }
    const t0 = performance.now();
    const loop = () => {
      frame((performance.now() - t0) % scene.duration);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ---- Live ----

  function runLive() {
    const svg = document.getElementById('diagram');
    const caption = document.getElementById('caption');
    const statusEl = document.getElementById('status');
    const controls = document.getElementById('controls');
    const log = document.getElementById('log');
    const seen = new Map();
    let state = null;
    let first = true;
    let sub = [];
    let lastSub = null;
    let error = null;

    /** When the page first saw a stage. Events already old on the first poll appear settled. */
    const mark = (key, sentAt) => {
      if (!seen.has(key)) seen.set(key, first && Date.now() - Date.parse(sentAt) > 20_000 ? -1e9 : performance.now());
      return seen.get(key);
    };

    const stagesOf = (p) => {
      const out = [];
      const add = (key, stage, extra = {}) => out.push({ stage, at: mark(`${p.eventId}:${key}`, p.sentAt), ...extra });
      add('sent', 'sent');
      const refusedCount = p.sender.filter((a) => a.status === 401).length;
      if (p.gateway.verificationFailed || refusedCount) {
        add('refused', 'refused', { count: refusedCount });
        return out;
      }
      if (!(p.gateway.requests > 0 || p.sender.some((a) => a.status && a.status < 300))) return out;
      add('stored', 'stored');
      const ev = p.gateway.event;
      if (p.gateway.cliDisconnected) add('parked', 'parked');
      if (p.gateway.cliDisconnected && (ev || p.agent)) add('recovered', 'recovered');
      const failedAttempts = ev ? Math.max(0, ev.attempts - (p.agent || ev.status === 'SUCCESSFUL' ? 1 : 0)) : 0;
      for (let i = 1; i <= failedAttempts; i++) add(`bounced${i}`, 'bounced', { status: ev.responseStatus, code: ev.errorCode });
      if (p.agent) add('handled', 'handled', { attempt: p.agent.attempt });
      else if (ev && ev.status === 'FAILED' && !ev.nextAttemptAt) add('failed', 'failed');
      return out;
    };

    const view = () => {
      const a = state?.agent;
      const packets = (state?.packets ?? []).flatMap((p) => {
        const list = [{ stages: stagesOf(p) }];
        if (p.kind === 'duplicate' && p.gateway.deduplicated > 0) list.push({ stages: [{ stage: 'dropped', at: mark(`${p.eventId}:dropped`, p.sentAt) }] });
        return list;
      });
      return {
        delivery: a?.delivery ?? 'cli',
        auth: a?.destinationAuth ?? 'STANDARD_WEBHOOKS',
        listening: a?.listening,
        failing: a?.failing,
        agentDown: state && !a,
        subscription: a?.subscription ?? null,
        sub,
        packets,
      };
    };

    /** Plays the subscribe flow when the subscription is new, or refreshed, after the page loaded. */
    const trackSubscription = () => {
      const now = performance.now();
      const current = { id: state?.agent?.subscription?.id, verifiedAt: state?.sender?.verifiedAt, refreshedAt: state?.sender?.refreshedAt };
      if (lastSub && current.id) {
        if (current.id !== lastSub.id || current.verifiedAt !== lastSub.verifiedAt) {
          sub = seq({ stage: 'provision', at: now }, { stage: 'subscribe' }, { stage: 'challenge' }, { stage: 'echo' }, { stage: 'granted' });
        } else if (current.refreshedAt !== lastSub.refreshedAt) {
          sub = seq({ stage: 'refresh', at: now }, { stage: 'granted' });
        }
      }
      if (current.id) lastSub = current;
    };

    const badge = (label, tone = '') => `<span class="badge ${tone ? `badge--${tone}` : ''}">${label}</span>`;
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

    const drawStatus = () => {
      const a = state?.agent;
      const parts = [];
      if (error) parts.push(badge(`VIZ SERVER · ${esc(error)}`, 'danger'));
      parts.push(state?.senderReachable ? badge('MCP SERVER · UP', 'success') : badge('MCP SERVER · NOT RUNNING', 'danger'));
      if (!a) parts.push(badge('AGENT · NOT RUNNING', 'danger'));
      else {
        parts.push(badge(a.delivery === 'cli' ? `DELIVERY · HOOKDECK LISTEN · ${a.listening ? 'CONNECTED' : 'STOPPED'}` : 'DELIVERY · HTTPS', a.delivery === 'cli' && !a.listening ? 'warning' : ''));
        parts.push(badge(`EVENT GATEWAY → AGENT · ${a.destinationAuth === 'BEARER_TOKEN' ? 'BEARER TOKEN' : 'STANDARD WEBHOOKS'}`, 'primary'));
        if (a.failing) parts.push(badge('AGENT · ANSWERING 503', 'danger'));
      }
      if (state?.gatewayError) parts.push(badge(`EVENT GATEWAY API · ${esc(state.gatewayError.slice(0, 60))}`, 'warning'));
      statusEl.innerHTML = parts.join('');
    };

    const drawControls = () => {
      const a = state?.agent;
      const groups = [
        `<div class="group"><span class="eyebrow body-xs">MCP server</span>
          <button data-action="emit">Send an event</button>
          <button class="button--secondary" data-action="duplicate">Send it twice</button>
          <button class="button--secondary" data-action="bad-signature">Wrong signature</button></div>`,
        `<div class="group"><span class="eyebrow body-xs">Agent</span>
          <button class="button--secondary" data-action="${a?.failing ? 'fail-off' : 'fail-on'}" ${a ? '' : 'disabled'}>${a?.failing ? 'Stop answering 503' : 'Answer 503'}</button></div>`,
      ];
      if (a?.delivery === 'cli') {
        groups.push(`<div class="group"><span class="eyebrow body-xs">hookdeck listen</span>
          <button class="button--secondary" data-action="listen-stop" ${a.listening ? '' : 'disabled'}>Stop</button>
          <button class="button--secondary" data-action="listen-kill" ${a.listening ? '' : 'disabled'}>Kill</button>
          <button class="button--secondary" data-action="listen-start" ${a.listening ? 'disabled' : ''}>Start</button></div>`);
      }
      const html = groups.join('');
      if (controls.dataset.html !== html) {
        controls.innerHTML = html;
        controls.dataset.html = html;
      }
    };

    const drawLog = () => {
      const packets = [...(state?.packets ?? [])].reverse();
      if (!packets.length) {
        log.innerHTML = `<tr><td class="empty">No events yet. Send one with the buttons above, or <code>npm run emit</code>.</td></tr>`;
        return;
      }
      const senderCell = (p) =>
        p.sender.length ? p.sender.map((s) => badge(s.status ?? s.error, s.status && s.status < 300 ? 'success' : s.status === 401 ? 'danger' : 'warning')).join('') : badge('sending…');
      const gatewayCell = (p) => {
        const g = p.gateway;
        const out = [];
        if (g.verificationFailed) out.push(badge('VERIFICATION_FAILED', 'danger'));
        else if (g.requests) out.push(badge(`${g.requests} request${g.requests > 1 ? 's' : ''} stored`));
        if (g.deduplicated) out.push(badge('duplicate dropped'));
        if (g.cliDisconnected) out.push(badge('CLI_DISCONNECTED', 'warning'));
        if (g.retriedByAgent) out.push(badge('retried by the agent', 'primary'));
        if (g.event) {
          const tone = { SUCCESSFUL: 'success', FAILED: 'danger', SCHEDULED: 'warning' }[g.event.status] ?? '';
          out.push(badge(`event ${g.event.status} · ${g.event.attempts} attempt${g.event.attempts === 1 ? '' : 's'}`, tone));
        }
        return out.join('') || badge('waiting…');
      };
      const agentCell = (p) => (p.agent ? badge(`handled · attempt ${p.agent.attempt ?? '?'}`, 'success') : badge('—'));
      log.innerHTML =
        '<tr><th>Event</th><th>MCP server saw</th><th>Event Gateway</th><th>Agent</th></tr>' +
        packets
          .map((p) => `<tr><td><code>${short(p.eventId)}</code><br>${esc(p.title)}</td><td>${senderCell(p)}</td><td>${gatewayCell(p)}</td><td>${agentCell(p)}</td></tr>`)
          .join('');
    };

    controls.addEventListener('click', async (e) => {
      const button = e.target.closest('button[data-action]');
      if (!button) return;
      button.disabled = true;
      await fetch(`/api/action/${button.dataset.action}`, { method: 'POST' }).catch(() => {});
      poll();
    });

    let polling = false;
    async function poll() {
      if (polling) return;
      polling = true;
      try {
        const response = await fetch('/api/state');
        state = await response.json();
        error = null;
        trackSubscription();
        view(); // marks stages as seen on this poll
        first = false;
      } catch (e) {
        error = 'unreachable';
      } finally {
        polling = false;
      }
      drawStatus();
      drawControls();
      drawLog();
    }

    poll();
    setInterval(poll, 1000);
    const idle = 'Send an event to watch it move. Each step comes from the MCP server, Event Gateway’s API, or the agent.';
    const loop = () => {
      caption.textContent = render(svg, view(), performance.now()) ?? idle;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  const theme = params.get('theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches && !params.get('scene') ? 'dark' : 'light');
  if (theme === 'dark') document.documentElement.classList.add('dark');
  if (params.get('scene')) runScene(params.get('scene'));
  else runLive();
  window.ForwardProxyViz = { SCENES, render };
})();
