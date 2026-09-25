/* Shared drawing for the scripted GIFs and the live demo.
 *
 * render(svg, scene, state) is the whole picture. The scripted loop derives
 * state from a clock; the live page derives the same state from machine
 * processes, local delivery logs, and the Hookdeck API.
 */
(function () {
  const SVG_NS = "http://www.w3.org/2000/svg";

  const WIDTH = 960;
  const HEIGHT = 520;
  const DURATION = 14;

  const MACHINES = [
    { name: "group-a-host-01", agent: "host 01" },
    { name: "group-a-host-02", agent: "host 02" },
    { name: "group-a-host-03", agent: "host 03" },
  ];

  // A GIF cannot be scrubbed, so whatever is held longest is what people
  // actually see. The failure is the point, so it holds longest: the healthy
  // warm-up is only long enough to establish the fan-out.
  const SCRIPTED_EVENTS = [
    { color: "#6ea8fe", label: "push · service-api", start: 0.4, dur: 1.5 },
    { color: "#f0b429", label: "push · service-worker", start: 1.85, dur: 1.5 },
    { color: "#5dcaa5", label: "push · service-api", start: 4.4, dur: 1.5 },
  ];

  const DROP_START = 3.3;
  const DROP_END = 3.95;
  const CALLOUT_AT = 5.6;
  const RISE_START = 10.4;
  const RISE_END = 11.05;
  const RETRY_START = 11.45;
  const RETRY_DUR = 1.55;

  const C = {
    bg: "#12151c",
    border: "#2a3142",
    text: "#e8eaef",
    muted: "#939bab",
    faint: "#6b7384",
    line: "#8b95a8",
    lineDown: "#7a5a58",
    sourceFill: "#1a2333",
    sourceStroke: "#42597d",
    sessionFill: "#17241f",
    sessionStroke: "#3f6e5e",
    sessionDownFill: "#281c20",
    sessionDownStroke: "#8a4b55",
    // Offline is not down: the machine is up, only its link to Hookdeck is
    // gone, and it keeps its session. Amber rather than red, so the two read
    // as different problems at a glance.
    lineOffline: "#8a6f3f",
    // No session is a deliberate state, not a fault: muted rather than alarming.
    lineNoSession: "#4a5468",
    sessionNoneFill: "#161a22",
    sessionNoneStroke: "#4a5468",
    sessionOfflineFill: "#25200f",
    sessionOfflineStroke: "#8a6f3f",
    warn: "#f0b429",
    calloutFill: "#181c27",
    ok: "#8fd4ae",
    bad: "#f09196",
    pending: "#aeb6c6",
  };

  function clamp01(n) {
    return Math.max(0, Math.min(1, n));
  }

  function smooth(u) {
    return u * u * (3 - 2 * u);
  }

  function el(parent, name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null) continue;
      node.setAttribute(key, String(value));
    }
    parent.appendChild(node);
    return node;
  }

  function text(parent, x, y, value, attrs) {
    const node = el(parent, "text", Object.assign({ x, y }, attrs));
    node.textContent = value;
    return node;
  }

  function presenceOf(name, t) {
    if (name !== "group-a-host-03") return 1;
    if (t < DROP_START) return 1;
    if (t < DROP_END) return 1 - smooth((t - DROP_START) / (DROP_END - DROP_START));
    if (t < RISE_START) return 0;
    if (t >= RISE_END) return 1;
    return smooth((t - RISE_START) / (RISE_END - RISE_START));
  }

  function scriptedState(scene, t) {
    const machines = MACHINES.map((m) => {
      const presence = presenceOf(m.name, t);
      return { name: m.name, agent: m.agent, presence, up: presence > 0.5 };
    });

    const events = [];
    SCRIPTED_EVENTS.forEach((ev, index) => {
      const linear = clamp01((t - ev.start) / ev.dur);
      if (linear <= 0) return;
      const afterDrop = index === 2;
      const lanes = [];
      for (const m of MACHINES) {
        const missed = afterDrop && m.name === "group-a-host-03";
        if (missed && scene === "per-group") continue;
        if (missed && scene === "per-machine") {
          const stop = 0.58;
          // The miss stays on the wire until the host is back. The retry is a
          // new trip from the source, only on this connection.
          if (t < RISE_END) {
            const u = Math.min(linear, stop);
            lanes.push({
              machine: m.name,
              progress: smooth(u / stop) * stop,
              outcome: linear >= stop ? "disconnected" : "inflight",
              cause: "CLI_DISCONNECTED",
            });
          } else if (t >= RETRY_START) {
            const retry = clamp01((t - RETRY_START) / RETRY_DUR);
            lanes.push({
              machine: m.name,
              progress: smooth(retry),
              outcome: retry >= 1 ? "delivered" : "inflight",
            });
          }
          continue;
        }
        lanes.push({
          machine: m.name,
          progress: smooth(linear),
          outcome: linear >= 1 ? "delivered" : "inflight",
        });
      }
      events.push({ id: "e" + index, color: ev.color, label: ev.label, lanes });
    });

    let callout = null;
    let calloutTone = null;
    if (t >= CALLOUT_AT) {
      if (scene === "per-machine") {
        const retry = clamp01((t - RETRY_START) / RETRY_DUR);
        if (t >= RETRY_START && retry >= 1) {
          callout = "retried group-a-host-03 · delivered";
          calloutTone = "ok";
        } else if (t >= RETRY_START) {
          callout = "fetching the miss for group-a-host-03";
          calloutTone = "pending";
        } else {
          callout = "CLI_DISCONNECTED on group-a-host-03";
          calloutTone = "bad";
        }
      } else if (t >= RISE_END) {
        // The host being back does not resolve anything here: no record was
        // ever made, so there is nothing to aim a retry at. Ending the loop on
        // a green "resolved" line would say the opposite of the point.
        callout = "host 03 is back · nothing records what it missed";
        calloutTone = "bad";
      } else {
        callout = "delivered · nothing notes the miss";
        calloutTone = "ok";
      }
    }

    return {
      machines,
      events,
      callout,
      calloutTone,
      legend: SCRIPTED_EVENTS.map((ev) => ({ color: ev.color, label: ev.label })),
    };
  }

  function createSvg() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("xmlns", SVG_NS);
    svg.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
    svg.setAttribute("width", String(WIDTH));
    svg.setAttribute("height", String(HEIGHT));
    svg.setAttribute("role", "img");
    return svg;
  }

  function machineByName(state, name) {
    return (
      state.machines.find((m) => m.name === name) || {
        name,
        agent: name,
        presence: 1,
        up: true,
        offline: false,
      }
    );
  }

  function agentFor(name) {
    const known = MACHINES.find((m) => m.name === name);
    return known ? known.agent : name;
  }

  function render(svg, scene, state) {
    // The scripted GIFs pass no groups and keep the fixed frame. The live page
    // passes every group from the selected scenario and the frame grows to fit.
    if (state.groups && state.groups.length) {
      renderFleet(svg, scene, state);
      return;
    }
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const title =
      scene === "per-machine" ? "Connection per machine" : "Connection per group";
    const subtitle =
      state.connections === false
        ? "No connections"
        : scene === "per-machine"
          ? "Each line is its own connection"
          : "One connection. Multiple CLI sessions.";
    svg.setAttribute("aria-label", title);

    el(svg, "rect", { width: WIDTH, height: HEIGHT, fill: C.bg });
    el(svg, "rect", {
      x: 0.5,
      y: 0.5,
      width: WIDTH - 1,
      height: HEIGHT - 1,
      fill: "none",
      stroke: C.border,
    });

    text(svg, 28, 36, title, {
      fill: C.text,
      "font-family": "ui-sans-serif, system-ui, sans-serif",
      "font-size": 18,
      "font-weight": 650,
    });
    text(svg, 28, 58, subtitle, {
      fill: C.muted,
      "font-family": "ui-sans-serif, system-ui, sans-serif",
      "font-size": 13,
    });

    drawLegend(svg, state.legend || []);

    if (scene === "per-machine") drawPerMachine(svg, state);
    else drawPerGroup(svg, state);

    if (state.callout) drawCallout(svg, state.callout, state.calloutTone || "pending");
  }

  function drawLegend(svg, legend) {
    if (!legend.length) return;
    const rowH = 18;
    const top = 28;
    const x = 620;
    legend.slice(0, 4).forEach((item, i) => {
      const y = top + i * rowH;
      el(svg, "circle", { cx: x, cy: y - 4, r: 5, fill: item.color });
      text(svg, x + 14, y, item.label, {
        fill: C.muted,
        "font-family": "ui-sans-serif, system-ui, sans-serif",
        "font-size": 12,
      });
    });
  }

  function drawSource(svg, x, y, w, h) {
    el(svg, "rect", {
      x,
      y,
      width: w,
      height: h,
      rx: 10,
      fill: C.sourceFill,
      stroke: C.sourceStroke,
    });
    text(svg, x + w / 2, y + h / 2 - 6, "SCM", {
      fill: C.text,
      "text-anchor": "middle",
      "font-family": "ui-sans-serif, system-ui, sans-serif",
      "font-size": 15,
      "font-weight": 650,
    });
    text(svg, x + w / 2, y + h / 2 + 14, "source", {
      fill: C.muted,
      "text-anchor": "middle",
      "font-family": "ui-sans-serif, system-ui, sans-serif",
      "font-size": 13,
    });
  }

  function lanePoint(x1, x2, y, progress, yOffset) {
    return { x: x1 + (x2 - x1) * progress, y: y + (yOffset || 0) };
  }

  function drawLine(svg, x1, y1, x2, y2, presence, stateName) {
    const style = styleFor(stateName);
    el(svg, "line", {
      x1,
      y1,
      x2,
      y2,
      stroke: style.line ? C[style.line] : C.line,
      "stroke-width": 2,
      "stroke-linecap": "round",
      "stroke-dasharray": style.dash ? "7 6" : null,
      opacity: stateName === "down" ? 0.45 + 0.55 * presence : style.dash ? 0.75 : 1,
    });
  }

  function drawDot(svg, x, y, color, r) {
    el(svg, "circle", {
      cx: x,
      cy: y,
      r: r == null ? 8 : r,
      fill: color,
      stroke: "#0e1218",
      "stroke-width": 2,
    });
  }

  function drawPerMachine(svg, state) {
    const lanes = [150, 252, 354];
    const sourceX = 28;
    const sourceY = 108;
    const sourceW = 136;
    const sourceH = 292;
    const x1 = sourceX + sourceW;
    const x2 = 636;
    drawSource(svg, sourceX, sourceY, sourceW, sourceH);
    if (state.connections === false) return;

    lanes.forEach((y, i) => {
      const spec = MACHINES[i];
      const machine = machineByName(state, spec.name);
      const presence = machine.presence == null ? (machine.up ? 1 : 0) : machine.presence;
      const mstate = stateOfMachine(state, spec.name);
      drawLine(svg, x1, y, x2, y, presence, mstate);

      text(svg, x1 + 18, y - 12, spec.name, {
        fill: styleFor(mstate).line ? C[styleFor(mstate).line] : C.muted,
        "font-family": "ui-sans-serif, system-ui, sans-serif",
        "font-size": 12,
      });

      drawSessionCard(svg, x2, y - 18, 168, 36, "CLI session", presence, mstate);
      const agent = machine.agent || spec.agent;
      text(svg, x2 + 184, y + 5, agent + styleFor(mstate).suffix, {
        fill: styleFor(mstate).text ? C[styleFor(mstate).text] : C.text,
        "font-family": "ui-sans-serif, system-ui, sans-serif",
        "font-size": 13,
      });

      const delivered = deliveredColors(state, spec.name);
      // First delivery keeps the right-hand slot. Later ones append to its left.
      drawDotRow(svg, x2 + 148, y, delivered, 5);
    });

    state.events.forEach((event, index) => {
      event.lanes.forEach((lane) => {
        if (lane.outcome !== "inflight" && lane.outcome !== "disconnected") return;
        const laneIndex = MACHINES.findIndex((m) => m.name === lane.machine);
        if (laneIndex < 0) return;
        const y = lanes[laneIndex];
        const point = lanePoint(x1, x2, y, lane.progress, (index - 1) * 0);
        drawDot(svg, point.x, point.y, event.color);
        if (lane.outcome === "disconnected") {
          text(svg, point.x, point.y + 22, lane.cause || "CLI_DISCONNECTED", {
            fill: C.bad,
            "text-anchor": "middle",
            "font-family": "ui-sans-serif, system-ui, sans-serif",
            "font-size": 11,
            "font-weight": 650,
          });
        }
      });
    });
  }

  function drawPerGroup(svg, state) {
    const sourceX = 28;
    const sourceY = 186;
    const sourceW = 144;
    const sourceH = 92;
    const lineY = sourceY + sourceH / 2;
    const x1 = sourceX + sourceW;
    const stackX = 548;
    const cardW = 230;
    const cardH = 58;
    const peek = 22;
    const frontY = lineY - cardH / 2;

    drawSource(svg, sourceX, sourceY, sourceW, sourceH);
    if (state.connections === false) return;

    // One connection, one line per CLI session, packed so they read as a single route.
    const sessionGap = 12;
    const sessionLineY = (index) => lineY + (index - 1) * sessionGap;
    MACHINES.forEach((spec, i) => {
      const machine = machineByName(state, spec.name);
      const presence = machine.presence == null ? (machine.up ? 1 : 0) : machine.presence;
      drawLine(svg, x1, sessionLineY(i), stackX, sessionLineY(i), presence, stateOfMachine(state, spec.name));
    });

    text(svg, (x1 + stackX) / 2, lineY - 28, "group-a", {
      fill: C.muted,
      "text-anchor": "middle",
      "font-family": "ui-sans-serif, system-ui, sans-serif",
      "font-size": 12,
    });

    // Back to front so each lower session is only a thin edge.
    for (let i = MACHINES.length - 1; i >= 0; i--) {
      const spec = MACHINES[i];
      const machine = machineByName(state, spec.name);
      const presence = machine.presence == null ? (machine.up ? 1 : 0) : machine.presence;
      const y = frontY + i * peek;
      const visibleH = i === 0 ? cardH : peek;
      const gstate = stateOfMachine(state, spec.name);
      drawSessionCard(svg, stackX, y, cardW, cardH, i === 0 ? "CLI sessions" : "", presence, gstate);

      const labelY = i === 0 ? y + cardH / 2 + 4 : y + cardH - visibleH / 2 + 4;
      const agent = machine.agent || agentFor(spec.name);
      text(svg, stackX + cardW + 16, labelY, agent + styleFor(gstate).suffix, {
        fill: styleFor(gstate).text ? C[styleFor(gstate).text] : C.text,
        "font-family": "ui-sans-serif, system-ui, sans-serif",
        "font-size": 13,
      });

      const delivered = deliveredColors(state, spec.name);
      const dotsY = i === 0 ? y + cardH / 2 : y + cardH - visibleH / 2;
      drawDotRow(svg, stackX + 160, dotsY, delivered, 5);
    }

    state.events.forEach((event) => {
      event.lanes.forEach((lane) => {
        if (lane.outcome !== "inflight" && lane.outcome !== "disconnected") return;
        const laneIndex = MACHINES.findIndex((m) => m.name === lane.machine);
        if (laneIndex < 0) return;
        const point = lanePoint(x1, stackX, sessionLineY(laneIndex), lane.progress);
        drawDot(svg, point.x, point.y, event.color, 5);
        if (lane.outcome === "disconnected") {
          text(svg, point.x, point.y + 16, lane.cause || "CLI_DISCONNECTED", {
            fill: C.bad,
            "text-anchor": "middle",
            "font-family": "ui-sans-serif, system-ui, sans-serif",
            "font-size": 11,
            "font-weight": 650,
          });
        }
      });
    });
  }

  function drawSessionCard(svg, x, y, w, h, label, presence, stateName) {
    const style = styleFor(stateName);
    el(svg, "rect", {
      x,
      y,
      width: w,
      height: h,
      rx: 8,
      fill: style.fill ? C[style.fill] : C.sessionFill,
      stroke: style.stroke ? C[style.stroke] : C.sessionStroke,
      "stroke-dasharray": style.dash ? "5 4" : null,
      opacity: stateName === "down" ? 0.55 + 0.45 * presence : style.dash ? 0.85 : 1,
    });
    if (label) {
      text(svg, x + 12, y + h / 2 + 4, label, {
        fill: style.text ? C[style.text] : C.text,
        "font-family": "ui-sans-serif, system-ui, sans-serif",
        "font-size": 12,
      });
    }
  }

  function deliveredColors(state, machine) {
    const colors = [];
    for (const event of state.events) {
      const lane = event.lanes.find((item) => item.machine === machine);
      if (lane && lane.outcome === "delivered") colors.push(event.color);
    }
    return colors;
  }

  /**
   * How many times this machine received the same event more than once. The
   * whole argument for a connection per machine is recovery without
   * duplicates, so a duplicate has to be visible when it happens.
   */
  function duplicateCount(state, machine) {
    let extra = 0;
    for (const event of state.events || []) {
      const lane = (event.lanes || []).find((item) => item.machine === machine);
      if (lane && lane.times > 1) extra += lane.times - 1;
    }
    return extra;
  }

  function drawDotRow(svg, rightX, y, colors, r) {
    // colors are oldest-first. The oldest stays at rightX. Each later delivery
    // is drawn one slot to the left, so earlier dots do not move.
    colors.forEach((color, i) => drawDot(svg, rightX - i * 16, y, color, r));
  }

  function drawCallout(svg, message, tone, yOverride) {
    const x = 28;
    const y = yOverride == null ? 424 : yOverride;
    const w = 904;
    const h = 72;
    const stroke = tone === "bad" ? "#8a4b55" : tone === "ok" ? "#3f6e5e" : C.border;
    const fill = tone === "bad" ? C.bad : tone === "ok" ? C.ok : C.pending;
    el(svg, "rect", { x, y, width: w, height: h, rx: 10, fill: C.calloutFill, stroke });
    text(svg, x + 18, y + 26, "request record", {
      fill: C.faint,
      "font-family": "ui-sans-serif, system-ui, sans-serif",
      "font-size": 11,
      "letter-spacing": 0.4,
    });
    const lines = wrapWords(message, 78).slice(0, 2);
    lines.forEach((line, i) => {
      text(svg, x + 18, y + 48 + i * 18, line, {
        fill,
        "font-family": "ui-sans-serif, system-ui, sans-serif",
        "font-size": 15,
        "font-weight": 650,
      });
    });
  }

  function wrapWords(value, max) {
    const words = String(value).split(/\s+/);
    const lines = [];
    let current = "";
    for (const word of words) {
      const next = current ? current + " " + word : word;
      if (next.length > max && current) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  function font(size, extra) {
    return Object.assign(
      {
        "font-family": "ui-sans-serif, system-ui, sans-serif",
        "font-size": size,
      },
      extra || {},
    );
  }

  function hostLabel(groupName, hostName) {
    const prefix = groupName + "-";
    return hostName.startsWith(prefix) ? hostName.slice(prefix.length) : hostName;
  }

  function presenceOfMachine(state, name) {
    const machine = machineByName(state, name);
    return machine.presence == null ? (machine.up ? 1 : 0) : machine.presence;
  }

  function offlineOfMachine(state, name) {
    return !!machineByName(state, name).offline;
  }

  /**
   * A machine is in exactly one of these, in order of severity:
   *
   *   down       the machine is not running
   *   nosession  running, but `hookdeck listen` is stopped - no CLI session,
   *              so events are ignored with CLI_DISCONNECTED
   *   offline    session exists but its link is gone - events fail instead
   *   up         everything working
   */
  function stateOfMachine(state, name) {
    const machine = machineByName(state, name);
    const presence = machine.presence == null ? (machine.up ? 1 : 0) : machine.presence;
    if (presence < 0.55) return "down";
    if (machine.listening === false) return "nosession";
    return machine.offline ? "offline" : "up";
  }

  const STATE_STYLE = {
    up: { line: null, fill: null, stroke: null, text: null, dash: null, suffix: "" },
    offline: {
      line: "lineOffline", fill: "sessionOfflineFill", stroke: "sessionOfflineStroke",
      text: "warn", dash: true, suffix: "  offline",
    },
    nosession: {
      line: "lineNoSession", fill: "sessionNoneFill", stroke: "sessionNoneStroke",
      text: "pending", dash: true, suffix: "  no session",
    },
    down: {
      line: "lineDown", fill: "sessionDownFill", stroke: "sessionDownStroke",
      text: "bad", dash: true, suffix: "  down",
    },
  };

  const styleFor = (name) => STATE_STYLE[name] || STATE_STYLE.up;

  function sizeSvg(svg, height) {
    svg.setAttribute("viewBox", `0 0 ${WIDTH} ${height}`);
    svg.setAttribute("width", String(WIDTH));
    svg.setAttribute("height", String(height));
  }

  function paintFrame(svg, height, title) {
    sizeSvg(svg, height);
    svg.setAttribute("aria-label", title);
    el(svg, "rect", { width: WIDTH, height, fill: C.bg });
    el(svg, "rect", {
      x: 0.5,
      y: 0.5,
      width: WIDTH - 1,
      height: height - 1,
      fill: "none",
      stroke: C.border,
    });
  }

  function renderFleet(svg, scene, state) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const connected = state.connections !== false;
    const laid = connected
      ? scene === "per-machine"
        ? layoutMachines(state.groups)
        : layoutGroups(state.groups)
      : null;
    const title = scene === "per-machine" ? "Connection per machine" : "Connection per group";
    const subtitle = connected
      ? scene === "per-machine"
        ? "Each line is its own connection"
        : "One connection. Multiple CLI sessions."
      : "No connections";
    paintFrame(svg, laid ? laid.height : 96, title);
    text(svg, 28, 36, title, font(18, { fill: C.text, "font-weight": 650 }));
    text(svg, 28, 58, subtitle, font(13, { fill: C.muted }));
    if (!laid) return;
    drawLegend(svg, state.legend || []);
    drawSource(svg, 28, laid.sourceY, laid.sourceW, laid.sourceH);
    if (scene === "per-machine") drawFleetMachines(svg, state, laid);
    else drawFleetGroups(svg, state, laid);
    if (state.callout) drawCallout(svg, state.callout, state.calloutTone || "pending", laid.calloutY);
  }

  function layoutMachines(groups) {
    const pitch = 88;
    const blocks = [];
    let y = 108;
    for (const group of groups) {
      const hosts = group.hosts || [];
      const labelY = y;
      y += 56;
      const lanes = hosts.map((name) => {
        const lane = { name, y };
        y += pitch;
        return lane;
      });
      if (!lanes.length) y += pitch;
      blocks.push({ name: group.name, lanes, labelY });
      y += 16;
    }
    const first = blocks.flatMap((block) => block.lanes)[0];
    const last = blocks.flatMap((block) => block.lanes).at(-1);
    const sourceY = first ? first.y - 36 : 108;
    const sourceH = first && last ? Math.max(92, last.y - first.y + 72) : 92;
    const calloutY = Math.max(y, sourceY + sourceH) + 28;
    return {
      blocks,
      sourceY,
      sourceH,
      sourceW: 136,
      x1: 164,
      x2: 600,
      calloutY,
      height: calloutY + 72 + 24,
    };
  }

  function layoutGroups(groups) {
    const blocks = [];
    let y = 96;
    for (const group of groups) {
      const hosts = group.hosts || [];
      const n = Math.max(hosts.length, 1);
      const multi = hosts.length > 1;
      const cardH = multi ? 58 : 36;
      const peek = 22;
      const gap = 12;
      const stackH = multi ? cardH + (n - 1) * peek : cardH;
      const top = y + 18;
      const center = top + stackH / 2;
      const lanes = (hosts.length ? hosts : [""]).map((name, i) => ({
        name,
        lineY: center + (i - (n - 1) / 2) * (multi ? gap : 0),
        cardY: top + (multi ? i * peek : 0),
        front: i === 0,
      }));
      const bottom = top + stackH;
      blocks.push({ name: group.name, lanes, labelY: y, cardH, cardW: multi ? 230 : 188, multi, bottom });
      y = bottom + 40;
    }
    const centers = blocks.flatMap((block) => block.lanes.map((lane) => lane.lineY));
    const sourceY = (centers[0] ?? 140) - 46;
    const sourceH = Math.max(92, (centers.at(-1) ?? sourceY + 92) - sourceY + 46);
    const calloutY = y + 12;
    return {
      blocks,
      sourceY,
      sourceH,
      sourceW: 144,
      x1: 172,
      stackX: 520,
      calloutY,
      height: calloutY + 72 + 24,
    };
  }

  function drawFleetMachines(svg, state, laid) {
    const yOf = new Map();
    for (const block of laid.blocks) {
      text(svg, laid.x1 + 18, block.labelY + 12, block.name, font(12, { fill: C.faint }));
      for (const lane of block.lanes) {
        yOf.set(lane.name, lane.y);
        const presence = presenceOfMachine(state, lane.name);
        const lstate = stateOfMachine(state, lane.name);
        drawLine(svg, laid.x1, lane.y, laid.x2, lane.y, presence, lstate);
        text(svg, laid.x1 + 18, lane.y - 20, lane.name, font(12, { fill: presence < 0.55 ? C.lineDown : C.muted }));
        drawSessionCard(svg, laid.x2, lane.y - 18, 188, 36, "CLI session", presence, lstate);
        const agent = hostLabel(block.name, lane.name);
        text(
          svg,
          laid.x2 + 204,
          lane.y + 5,
          agent + styleFor(lstate).suffix,
          font(13, { fill: styleFor(lstate).text ? C[styleFor(lstate).text] : C.text }),
        );
        drawDotRow(svg, laid.x2 + 168, lane.y, deliveredColors(state, lane.name), 5);
        const dupes = duplicateCount(state, lane.name);
        if (dupes > 0) {
          text(
            svg,
            laid.x2 + 204,
            lane.y + 22,
            dupes === 1 ? "1 duplicate" : dupes + " duplicates",
            font(11, { fill: C.bad }),
          );
        }
      }
    }
    for (const event of state.events || []) {
      for (const lane of event.lanes) {
        if (lane.outcome !== "inflight" && lane.outcome !== "disconnected") continue;
        const y = yOf.get(lane.machine);
        if (y == null) continue;
        const point = lanePoint(laid.x1, laid.x2, y, lane.progress);
        drawDot(svg, point.x, point.y, event.color);
        if (lane.outcome === "disconnected") {
          text(svg, point.x, point.y + 22, lane.cause || "CLI_DISCONNECTED", font(11, { fill: C.bad, "text-anchor": "middle", "font-weight": 650 }));
        }
      }
    }
  }

  function drawFleetGroups(svg, state, laid) {
    const yOf = new Map();
    for (const block of laid.blocks) {
      text(svg, (laid.x1 + laid.stackX) / 2, block.labelY + 12, block.name, font(12, { fill: C.muted, "text-anchor": "middle" }));
      for (const lane of block.lanes) {
        if (!lane.name) continue;
        yOf.set(lane.name, lane.lineY);
        const presence = presenceOfMachine(state, lane.name);
        drawLine(svg, laid.x1, lane.lineY, laid.stackX, lane.lineY, presence, stateOfMachine(state, lane.name));
      }
      for (let i = block.lanes.length - 1; i >= 0; i--) {
        const lane = block.lanes[i];
        if (!lane.name) continue;
        const presence = presenceOfMachine(state, lane.name);
        const gstate2 = stateOfMachine(state, lane.name);
        drawSessionCard(
          svg,
          laid.stackX,
          lane.cardY,
          block.cardW,
          block.cardH,
          lane.front ? (block.multi ? "CLI sessions" : "CLI session") : "",
          presence,
          gstate2,
        );
        const visibleH = lane.front || !block.multi ? block.cardH : 22;
        const labelY = lane.front || !block.multi ? lane.cardY + block.cardH / 2 + 4 : lane.cardY + block.cardH - visibleH / 2 + 4;
        const agent = hostLabel(block.name, lane.name);
        text(
          svg,
          laid.stackX + block.cardW + 16,
          labelY,
          agent + styleFor(gstate2).suffix,
          font(13, { fill: styleFor(gstate2).text ? C[styleFor(gstate2).text] : C.text }),
        );
        const dotsY = lane.front || !block.multi ? lane.cardY + block.cardH / 2 : lane.cardY + block.cardH - visibleH / 2;
        drawDotRow(svg, laid.stackX + block.cardW - 70, dotsY, deliveredColors(state, lane.name), 5);
      }
    }
    for (const event of state.events || []) {
      for (const lane of event.lanes) {
        if (lane.outcome !== "inflight" && lane.outcome !== "disconnected") continue;
        const y = yOf.get(lane.machine);
        if (y == null) continue;
        const point = lanePoint(laid.x1, laid.stackX, y, lane.progress);
        drawDot(svg, point.x, point.y, event.color, 5);
        if (lane.outcome === "disconnected") {
          text(svg, point.x, point.y + 16, lane.cause || "CLI_DISCONNECTED", font(11, { fill: C.bad, "text-anchor": "middle", "font-weight": 650 }));
        }
      }
    }
  }

  window.FleetViz = {
    WIDTH,
    HEIGHT,
    DURATION,
    MACHINES,
    COLORS: ["#6ea8fe", "#f0b429", "#5dcaa5", "#d2a8ff", "#ff8b6a"],
    scriptedState,
    createSvg,
    render,
  };
})();
