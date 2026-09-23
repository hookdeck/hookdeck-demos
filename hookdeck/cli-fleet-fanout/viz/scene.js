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
  const DURATION = 10;

  const MACHINES = [
    { name: "build-a-01", agent: "CI agent 01" },
    { name: "build-a-02", agent: "CI agent 02" },
    { name: "build-a-03", agent: "CI agent 03" },
  ];

  const SCRIPTED_EVENTS = [
    { color: "#6ea8fe", label: "push · service-api", start: 0.45, dur: 1.65 },
    { color: "#f0b429", label: "push · service-worker", start: 2.35, dur: 1.65 },
    { color: "#5dcaa5", label: "push · service-api", start: 5.25, dur: 1.65 },
  ];

  const DROP_START = 4.25;
  const DROP_END = 4.95;
  const CALLOUT_AT = 7.15;

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
    if (name !== "build-a-03") return 1;
    if (t < DROP_START) return 1;
    if (t >= DROP_END) return 0;
    return 1 - smooth((t - DROP_START) / (DROP_END - DROP_START));
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
        const missed = afterDrop && m.name === "build-a-03";
        if (missed && scene === "per-group") continue;
        if (missed && scene === "per-machine") {
          const stop = 0.58;
          const u = Math.min(linear, stop);
          lanes.push({
            machine: m.name,
            progress: smooth(u / stop) * stop,
            outcome: linear >= stop ? "disconnected" : "inflight",
          });
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
        callout = "CLI_DISCONNECTED on build-a-03";
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
    return state.machines.find((m) => m.name === name) || { name, agent: name, presence: 1, up: true };
  }

  function agentFor(name) {
    const known = MACHINES.find((m) => m.name === name);
    return known ? known.agent : name;
  }

  function render(svg, scene, state) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const title =
      scene === "per-machine" ? "Approach 1 · connection per machine" : "Approach 2 · connection per group";
    const subtitle =
      scene === "per-machine"
        ? "Each line is its own connection"
        : "One connection. Sessions sit just underneath each other";
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

  function drawLine(svg, x1, y1, x2, y2, presence) {
    const down = presence < 0.55;
    el(svg, "line", {
      x1,
      y1,
      x2,
      y2,
      stroke: down ? C.lineDown : C.line,
      "stroke-width": 2,
      "stroke-linecap": "round",
      "stroke-dasharray": down ? "7 6" : null,
      opacity: 0.45 + 0.55 * presence,
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

    lanes.forEach((y, i) => {
      const spec = MACHINES[i];
      const machine = machineByName(state, spec.name);
      const presence = machine.presence == null ? (machine.up ? 1 : 0) : machine.presence;
      drawLine(svg, x1, y, x2, y, presence);

      text(svg, x1 + 18, y - 12, spec.name, {
        fill: presence < 0.55 ? C.lineDown : C.muted,
        "font-family": "ui-sans-serif, system-ui, sans-serif",
        "font-size": 12,
      });

      drawSessionCard(svg, x2, y - 18, 168, 36, "CLI session", presence);
      const agent = machine.agent || spec.agent;
      text(svg, x2 + 184, y + 5, presence < 0.55 ? agent + "  down" : agent, {
        fill: presence < 0.55 ? C.bad : C.text,
        "font-family": "ui-sans-serif, system-ui, sans-serif",
        "font-size": 13,
      });

      const delivered = deliveredColors(state, spec.name);
      drawDotRow(svg, x2 + 150 - Math.max(0, delivered.length - 1) * 16, y, delivered, 5);
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
          text(svg, point.x, point.y + 22, "CLI_DISCONNECTED", {
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
    const peek = 14;
    const frontY = lineY - cardH / 2;

    drawSource(svg, sourceX, sourceY, sourceW, sourceH);

    const groupPresence = Math.min(
      ...MACHINES.map((m) => {
        const machine = machineByName(state, m.name);
        return machine.presence == null ? (machine.up ? 1 : 0) : machine.presence;
      }),
    );
    // The connection stays up when any session is up. Dash it only when the
    // whole group is down. A single down session does not break the line.
    const anyUp = MACHINES.some((m) => {
      const machine = machineByName(state, m.name);
      const presence = machine.presence == null ? (machine.up ? 1 : 0) : machine.presence;
      return presence >= 0.55;
    });
    drawLine(svg, x1, lineY, stackX, lineY, anyUp ? 1 : groupPresence);

    text(svg, (x1 + stackX) / 2, lineY - 14, "group-a", {
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
      drawSessionCard(svg, stackX, y, cardW, cardH, i === 0 ? "CLI sessions" : "", presence);

      const labelY = i === 0 ? y + cardH / 2 + 4 : y + cardH - visibleH / 2 + 4;
      const agent = machine.agent || agentFor(spec.name);
      text(svg, stackX + cardW + 16, labelY, presence < 0.55 ? agent + "  down" : agent, {
        fill: presence < 0.55 ? C.bad : C.text,
        "font-family": "ui-sans-serif, system-ui, sans-serif",
        "font-size": 13,
      });

      const delivered = deliveredColors(state, spec.name);
      const dotsY = i === 0 ? y + cardH / 2 : y + cardH - visibleH / 2;
      drawDotRow(svg, stackX + cardW - 18 - Math.max(0, delivered.length - 1) * 16, dotsY, delivered, 5);
    }

    state.events.forEach((event, index) => {
      const moving = event.lanes.find((lane) => lane.outcome === "inflight" || lane.outcome === "disconnected");
      if (!moving) return;
      const point = lanePoint(x1, stackX, lineY, moving.progress, (index - 1) * 11);
      drawDot(svg, point.x, point.y, event.color);
    });
  }

  function drawSessionCard(svg, x, y, w, h, label, presence) {
    const down = presence < 0.55;
    el(svg, "rect", {
      x,
      y,
      width: w,
      height: h,
      rx: 8,
      fill: down ? C.sessionDownFill : C.sessionFill,
      stroke: down ? C.sessionDownStroke : C.sessionStroke,
      "stroke-dasharray": down ? "5 4" : null,
      opacity: 0.55 + 0.45 * presence,
    });
    if (label) {
      text(svg, x + 12, y + h / 2 + 4, label, {
        fill: down ? C.bad : C.text,
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

  function drawDotRow(svg, x, y, colors, r) {
    colors.forEach((color, i) => drawDot(svg, x + i * 16, y, color, r));
  }

  function drawCallout(svg, message, tone) {
    const x = 28;
    const y = 424;
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
