import { gsap } from 'gsap'
import { accepted, bounce, captions, down, draw, drawable, dropAt, packet, pulse, show, swap, travel, up } from './kit/anim'
import { createLive } from './kit/live'
import { chipRow, connectorLabel, statusChip, type Tone, type ToneChip, toneTo } from './kit/parts'
import { defineScene, type SceneBuild } from './kit/scene'
import { type Canvas, connector, type Connector, node, type Node, type Point, type Stage } from './kit/stage'

// The Retell outbound-lead-calling topology, defined once, run three ways:
//
//   live      the demo page's bottom pane: `createLiveScene` builds the components and a live driver
//             (`scene.live`) that the page feeds from the app's delivery log and /api/flow;
//   scripted  four scenes with captions (call lifecycle, duplicate dropped, bad signature, app down
//             then retry), each with a desktop layout (1920x1080) and a portrait layout for phones
//             (640 wide), the same steps and captions. The website embeds them with `steppedDiagram`
//             in its voice-ai set, so the scene names carry a `retell-` prefix; the capture script
//             renders them to MP4;
//   detail    clicking a node or packet fills the pane's detail strip (host code, not here).
//
// Retell is two-directional. The app starts a call through Retell's API (edge `start`, app to
// Retell), and Retell reports the call back through Event Gateway (edges `in`, `out`, `local`).
// The optional live function (ENABLE_LIVE_INJECTION) reuses the same edges: the agent's function
// request goes in, out and local to the app, and the app's update-live-call result goes back on
// `start`. Only the live view shows it.
//
// No host code in this file: it imports gsap and the kit, nothing else.

// ---- Facts the scenes show, with their evidence (handoffs/.../demos/retell.md; scripts/setup.ts) ----

export const facts = {
  /** call_started body for a real web call (live run 2026-11-12: 1515 B). */
  startedSize: '1.5 KB',
  /** call_ended body for the same call (2875 B). */
  endedSize: '2.8 KB',
  /** call_analyzed body for the same call (3193 B). It arrived at the same instant as call_ended. */
  analyzedSize: '3.1 KB',
  /** Header Retell signs each webhook with (`v=<unix ms>,d=<digest>`). */
  signatureHeader: 'x-retell-signature',
  /** Dedup rule in scripts/setup.ts: the same event for the same call inside the window. */
  dedupFields: 'body.event + body.call.call_id',
  dedupWindowMinutes: 10,
  /** Retry rule in scripts/setup.ts: exponential, 8 attempts, first interval 30 s. */
  retryFirstSeconds: 30,
  retryCount: 8,
  /** The app's failure switch answers 503 (src/server.ts). */
  failStatus: 503,
} as const

// One whole sentence per resting state: the opening state, then each step. Terms in backticks
// render as code on the website.
export const captionsBy = {
  'retell-call-lifecycle': [
    'The demo app starts calls through Retell\'s API, and Retell reports each call back through Event Gateway.',
    'A lead arrives and the app creates the call through Retell\'s API. The lead is Calling.',
    `The call connects. Retell sends \`call_started\` (${facts.startedSize}) to Event Gateway, which delivers it through \`hookdeck listen\` to the app. The lead is In call.`,
    `When the call ends, Retell sends \`call_ended\` (${facts.endedSize}) and \`call_analyzed\` together. \`call_ended\` is delivered first: the lead is Call ended.`,
    `\`call_analyzed\` (${facts.analyzedSize}) follows straight behind it with the summary. The lead is Analyzed.`,
  ],
  'retell-duplicate-dropped': [
    'The app has handled this call\'s `call_ended`: the lead is Call ended.',
    'Retell sends the same `call_ended` again, because senders can deliver an event more than once.',
    `Event Gateway sees the same \`${facts.dedupFields}\` inside the ${facts.dedupWindowMinutes} minute window and drops it. Retell still gets a 200.`,
    'Nothing is forwarded: the app is not called a second time and the lead stays as it was.',
  ],
  'retell-bad-signature': [
    'A request claims to come from Retell, but its signature was made with the wrong key.',
    'Event Gateway accepts the request, then checks its signature.',
    `Verification of \`${facts.signatureHeader}\` fails. The request is recorded as \`VERIFICATION_FAILED\` and no event is created.`,
    'The sender still gets a 200, and your app is never called.',
  ],
  'retell-app-down': [
    `The app is down: it answers every delivery with a ${facts.failStatus}.`,
    'The call ends and Retell sends `call_ended`. Event Gateway stores it and answers Retell with a 200.',
    `Event Gateway delivers it through \`hookdeck listen\`. Attempt 1 gets a ${facts.failStatus} from the app.`,
    `Event Gateway keeps the event and retries with exponential backoff: the first retry is ${facts.retryFirstSeconds} seconds after the failed attempt, then it waits longer each time, up to ${facts.retryCount} retries.`,
    `The app recovers. Attempt 2 succeeds about ${facts.retryFirstSeconds} seconds later, and the event is delivered once.`,
  ],
} as const

// The opening diagram of a tutorial: the flow as it runs once your app is deployed. No
// `hookdeck listen`: Event Gateway delivers to your app's HTTPS endpoint. Not a tab in the demo
// page, which shows what the demo runs.
export const deployedCaptionsBy = [
  'Your app starts calls through Retell\'s API, and Retell reports each call back through Event Gateway, which delivers to your app over HTTPS.',
  'A lead arrives and your app creates the call through Retell\'s API. The lead is Calling.',
  `The call connects. Retell sends \`call_started\` (${facts.startedSize}) to Event Gateway, which delivers it to your app over HTTPS and signs the delivery. Your app verifies the Hookdeck signature. The lead is In call.`,
  `When the call ends, Retell sends \`call_ended\` (${facts.endedSize}) and \`call_analyzed\` together. \`call_ended\` is delivered first: the lead is Call ended.`,
  `\`call_analyzed\` (${facts.analyzedSize}) follows straight behind it with the summary. The lead is Analyzed.`,
] as const

export type ScenarioId = keyof typeof captionsBy

// ---- Layouts: where the components sit ----

interface Layout {
  canvas: Canvas
  dir: 'h' | 'v'
  /** Node scale: 1 on both canvases, which are sized so 1 reads on both. */
  k: number
  agent: { x: number, y: number, w: number, h: number }
  gateway: { x: number, y: number, w: number, h: number }
  listen: { x: number, y: number, w: number, h: number }
  app: { x: number, y: number, w: number, h: number }
  /** Where each node's status chip sits, relative to the node's center. */
  status: { agent: Point, gateway: Point, listen: Point, app: Point }
  chips: Point
  edgeLabels: { in: Point, out: Point, local: Point, start: Point }
  /** How far the app-to-Retell connector bulges out of the row (down on desktop, right on phones). */
  startBulge: number
  caption: { x: number, y: number, max: number, size: number }
  /** The part of the canvas the diagram uses, for a page that crops to it (SVG viewBox). */
  crop: string
}

const DESKTOP: Layout = {
  canvas: { width: 1920, height: 1080 },
  dir: 'h',
  k: 1,
  agent: { x: 205, y: 470, w: 300, h: 150 },
  gateway: { x: 690, y: 470, w: 390, h: 210 },
  listen: { x: 1225, y: 470, w: 400, h: 150 },
  app: { x: 1715, y: 470, w: 300, h: 150 },
  status: {
    agent: { x: 0, y: -118 },
    gateway: { x: 0, y: -150 },
    listen: { x: 0, y: 118 },
    app: { x: 0, y: -118 },
  },
  chips: { x: 690, y: 624 },
  edgeLabels: { in: { x: 425, y: 512 }, out: { x: 957, y: 512 }, local: { x: 1475, y: 512 }, start: { x: 960, y: 717 } },
  startBulge: 230,
  caption: { x: 60, y: 870, max: 78, size: 38 },
  crop: '30 270 1860 520',
}

const PHONE: Layout = {
  canvas: { width: 640, height: 1090 },
  dir: 'v',
  k: 0.9,
  agent: { x: 300, y: 90, w: 440, h: 120 },
  gateway: { x: 300, y: 410, w: 460, h: 170 },
  listen: { x: 300, y: 745, w: 440, h: 120 },
  app: { x: 300, y: 975, w: 440, h: 120 },
  status: {
    agent: { x: 0, y: 100 },
    gateway: { x: 0, y: 180 },
    listen: { x: 0, y: 85 },
    app: { x: 0, y: 85 },
  },
  chips: { x: 300, y: 540 },
  edgeLabels: { in: { x: 300, y: 262 }, out: { x: 300, y: 650 }, local: { x: 300, y: 888 }, start: { x: 596, y: 532 } },
  startBulge: 110,
  caption: { x: 0, y: 0, max: 0, size: 0 },
  crop: '0 0 640 1090',
}

// ---- Components ----

const CAPABILITIES = [
  { id: 'verify', label: 'Verify' },
  { id: 'store', label: 'Store' },
  { id: 'dedup', label: 'Dedup' },
  { id: 'retry', label: 'Retry' },
] as const

type NodeId = 'agent' | 'gateway' | 'listen' | 'app'
type EdgeId = 'in' | 'out' | 'local' | 'start'

interface Parts {
  nodes: Record<NodeId, Node>
  edges: Record<EdgeId, Connector>
  edgeLabels: Record<EdgeId, SVGGElement>
  chips: Record<string, ToneChip>
}

/**
 * The connector from the app back to Retell: it leaves the app, loops around the row (under it on
 * desktop, to its right on phones) and arrives at Retell. `connector()` styles the path; the loop
 * replaces its geometry.
 */
function loopConnector(stage: Stage, from: Point, to: Point, dir: 'h' | 'v', bulge: number): Connector {
  const base = connector(stage, from, to, dir)
  const d = dir === 'h'
    ? `M ${from.x} ${from.y} C ${from.x} ${from.y + bulge}, ${to.x} ${to.y + bulge}, ${to.x} ${to.y}`
    : `M ${from.x} ${from.y} C ${from.x + bulge} ${from.y}, ${to.x + bulge} ${to.y}, ${to.x} ${to.y}`
  base.path.setAttribute('d', d)
  return { path: base.path, d, length: base.path.getTotalLength(), dir: 'h' }
}

/**
 * The `tutorial` flag is set by the website for the step diagrams of the guide: the app is "Your
 * app" there, because the reader runs their own. The demo page leaves it off and keeps "Demo app".
 */
function buildParts(build: Pick<SceneBuild, 'stage' | 'options'>, layout: Layout): Parts {
  const { stage } = build
  const L = layout
  const nodes: Record<NodeId, Node> = {
    agent: node(stage, { ...L.agent, eyebrow: 'Retell', title: 'Voice agent', icon: 'mic', scale: L.k, status: L.status.agent }),
    gateway: node(stage, { ...L.gateway, eyebrow: 'Hookdeck', title: 'Event Gateway', icon: 'hookdeck', variant: 'work', scale: L.k, status: L.status.gateway }),
    listen: node(stage, { ...L.listen, eyebrow: 'Hookdeck CLI', title: 'hookdeck listen', icon: 'terminal', scale: L.k, status: L.status.listen }),
    app: node(stage, { ...L.app, eyebrow: 'Localhost', title: build.options.flags?.tutorial ? 'Your app' : 'Demo app', icon: 'dns', scale: L.k, status: L.status.app }),
  }
  const ends = L.dir === 'h'
    ? { from: ['right', 'right', 'right'], to: ['left', 'left', 'left'] } as const
    : { from: ['bottom', 'bottom', 'bottom'], to: ['top', 'top', 'top'] } as const
  const start_from = L.dir === 'h' ? nodes.app.bottom : nodes.app.right
  const start_to = L.dir === 'h' ? nodes.agent.bottom : nodes.agent.right
  const edges: Record<EdgeId, Connector> = {
    in: connector(stage, nodes.agent[ends.from[0]], nodes.gateway[ends.to[0]], L.dir),
    out: connector(stage, nodes.gateway[ends.from[1]], nodes.listen[ends.to[1]], L.dir),
    local: connector(stage, nodes.listen[ends.from[2]], nodes.app[ends.to[2]], L.dir),
    start: loopConnector(stage, start_from, start_to, L.dir, L.startBulge),
  }
  const edgeLabels: Record<EdgeId, SVGGElement> = {
    in: connectorLabel(stage, { ...L.edgeLabels.in, label: 'POST' }),
    out: connectorLabel(stage, { ...L.edgeLabels.out, label: 'WSS' }),
    local: connectorLabel(stage, { ...L.edgeLabels.local, label: 'HTTP' }),
    start: connectorLabel(stage, { ...L.edgeLabels.start, label: 'API' }),
  }
  const chips = chipRow(stage.overlay, { ...L.chips, items: [...CAPABILITIES], size: L.dir === 'h' ? 20 : 17, gap: L.dir === 'h' ? 14 : 8 })
  return { nodes, edges, edgeLabels, chips }
}

/** The state every scene opens on: components on stage, connectors drawn. Hidden until `introAnimation`. */
function hideForIntro(parts: Parts) {
  for (const n of Object.values(parts.nodes))
    gsap.set(n.g, { autoAlpha: 0 })
  for (const e of Object.values(parts.edges))
    drawable(e.path)
  for (const l of Object.values(parts.edgeLabels))
    gsap.set(l, { autoAlpha: 0 })
  for (const c of Object.values(parts.chips))
    gsap.set(c.g, { autoAlpha: 0 })
}

function introAnimation(tl: gsap.core.Timeline, parts: Parts): number {
  const order: NodeId[] = ['agent', 'gateway', 'listen', 'app']
  order.forEach((id, i) => show(tl, parts.nodes[id].g, 0.15 + i * 0.18))
  ;(['in', 'out', 'local', 'start'] as const).forEach((id, i) => {
    draw(tl, parts.edges[id].path, 0.55 + i * 0.18, 0.5)
    show(tl, parts.edgeLabels[id], 0.95 + i * 0.18)
  })
  return Math.max(show(tl, Object.values(parts.chips).map(c => c.g), 1.0), 1.7)
}

// ---- Scripted helpers ----

interface Ctx {
  stage: SceneBuild['stage']
  tl: gsap.core.Timeline
  parts: Parts
  /** Status chips by node: `set` crossfades to a new chip. */
  status: Record<NodeId, { set: (at: number, label: string, tone?: Tone) => number }>
  caption: ReturnType<typeof captions>
}

function makeCtx(b: SceneBuild, parts: Parts, layout: Layout, id: ScenarioId): Ctx {
  const { tl, stage } = b
  const size = layout.dir === 'h' ? 21 : 18
  const status = {} as Ctx['status']
  for (const key of Object.keys(parts.nodes) as NodeId[]) {
    let current: SVGGElement | null = null
    status[key] = {
      set(at, label, tone = 'neutral') {
        const chip = statusChip(stage, parts.nodes[key], label, tone, size)
        const t = swap(tl, current, chip, at)
        current = chip
        return t
      },
    }
  }
  const caption = captions(stage, [...captionsBy[id]], { x: layout.caption.x, y: layout.caption.y }, b.options.captions && layout.dir === 'h', { max: layout.caption.max, size: layout.caption.size })
  return { stage, tl, parts, status, caption }
}

/** Sends a packet along an edge. Returns the time it arrives. */
function send(c: Ctx, edge: EdgeId, at: number, o: { label?: string, big?: boolean, end?: 'into' | 'arrive' }): number {
  const p = packet(c.stage, c.parts.edges[edge], { big: o.big, label: o.label })
  return travel(c.tl, p, at, o.end ?? 'into', o.big ? 1.9 : 1.2)
}

/** Capability chips do their work: tone and a pulse. */
function work(c: Ctx, ids: string[], tone: Tone, at: number): number {
  let t = at
  for (const id of ids) {
    toneTo(c.tl, c.parts.chips[id], tone, t)
    pulse(c.tl, c.parts.chips[id].g, t)
    t += 0.4
  }
  return t
}

function resetChips(c: Ctx, at: number) {
  for (const chip of Object.values(c.parts.chips))
    toneTo(c.tl, chip, 'neutral', at)
}

/** One webhook's whole delivery: in to Event Gateway (verify and store), out to the CLI, local to the app. Returns the time the app has it. */
function deliver(c: Ctx, at: number, label: string, lead: { text: string, tone?: Tone }): number {
  let t = send(c, 'in', at, { label })
  c.status.agent.set(t - 0.1, 'sent', 'blue')
  t = work(c, ['verify', 'store'], 'success', t)
  c.status.gateway.set(t - 0.3, 'verified · stored', 'success')
  c.status.agent.set(t, 'got 200', 'success')
  t = send(c, 'out', t, { label })
  c.status.listen.set(t - 0.2, 'forwarding', 'blue')
  t = send(c, 'local', t, { label })
  accepted(c.tl, c.parts.nodes.app, t - 0.15)
  c.status.listen.set(t, 'connected')
  return c.status.app.set(t, lead.text, lead.tone ?? 'success')
}

// Packet labels drop the `call_` prefix: the connectors between nodes are short.
const STARTED = `started ${facts.startedSize}`
const ENDED = `ended ${facts.endedSize}`
const ANALYZED = `analyzed ${facts.analyzedSize}`

// ---- The scenarios ----

const scenarios: Record<ScenarioId, (b: SceneBuild, c: Ctx) => void> = {
  'retell-call-lifecycle': (b, c) => {
    const { tl } = c
    b.intro(() => introAnimation(tl, c.parts))
    b.step((at) => {
      c.caption.to(tl, 1, at)
      // The app starts the call: a packet from the app to Retell on the outbound edge.
      const t = send(c, 'start', at, {})
      c.status.app.set(at + 0.1, 'Calling', 'blue')
      return c.status.agent.set(t - 0.1, 'call created', 'blue')
    })
    b.step((at) => {
      c.caption.to(tl, 2, at)
      return deliver(c, at, STARTED, { text: 'In call' })
    })
    b.step((at) => {
      c.caption.to(tl, 3, at)
      resetChips(c, at)
      // The two events travel in together; call_ended is delivered first.
      return deliver(c, at + 0.2, ENDED, { text: 'Call ended' })
    })
    b.step((at) => {
      c.caption.to(tl, 4, at)
      resetChips(c, at)
      return deliver(c, at + 0.2, ANALYZED, { text: 'Analyzed' })
    })
  },

  'retell-duplicate-dropped': (b, c) => {
    const { tl } = c
    let again: ReturnType<typeof packet>
    b.intro(() => {
      const t = introAnimation(tl, c.parts)
      accepted(tl, c.parts.nodes.app, t - 0.2)
      c.status.app.set(t - 0.1, 'Call ended', 'success')
      return c.status.gateway.set(t, 'verified · stored', 'success')
    })
    b.step((at) => {
      c.caption.to(tl, 1, at)
      // The repeat stops at Event Gateway's edge and stays there until step 2.
      again = packet(c.stage, c.parts.edges.in, { label: ENDED })
      const t = travel(tl, again, at, 'arrive', 1.2)
      return c.status.agent.set(t - 0.1, 'sent again', 'blue')
    })
    b.step((at) => {
      c.caption.to(tl, 2, at)
      dropAt(tl, again, at + 0.3)
      const t = work(c, ['dedup'], 'warn', at + 0.1)
      c.status.gateway.set(t - 0.3, 'duplicate · dropped', 'warn')
      return c.status.agent.set(t, 'got 200', 'success')
    })
    b.step((at) => {
      c.caption.to(tl, 3, at)
      return c.status.listen.set(at + 0.2, 'nothing to forward', 'neutral')
    })
  },

  'retell-bad-signature': (b, c) => {
    const { tl } = c
    let forged: ReturnType<typeof packet>
    b.intro(() => introAnimation(tl, c.parts))
    b.step((at) => {
      c.caption.to(tl, 1, at)
      forged = packet(c.stage, c.parts.edges.in, { label: 'bad signature' })
      const t = travel(tl, forged, at, 'arrive', 1.2)
      return c.status.agent.set(t - 0.1, 'sent', 'blue')
    })
    b.step((at) => {
      c.caption.to(tl, 2, at)
      const t = work(c, ['verify'], 'danger', at + 0.1)
      down(tl, c.parts.nodes.gateway, at + 0.1)
      dropAt(tl, forged, at + 0.3, true)
      return c.status.gateway.set(t - 0.2, 'verification failed', 'danger')
    })
    b.step((at) => {
      c.caption.to(tl, 3, at)
      c.status.agent.set(at + 0.1, 'got 200', 'success')
      return c.status.app.set(at + 0.2, 'never called', 'neutral')
    })
  },

  'retell-app-down': (b, c) => {
    const { tl } = c
    b.intro(() => {
      const t = introAnimation(tl, c.parts)
      down(tl, c.parts.nodes.app, t - 0.2)
      return c.status.app.set(t, `answering ${facts.failStatus}`, 'danger')
    })
    b.step((at) => {
      c.caption.to(tl, 1, at)
      let t = send(c, 'in', at, { label: ENDED })
      c.status.agent.set(t - 0.1, 'sent', 'blue')
      t = work(c, ['verify', 'store'], 'success', t)
      c.status.gateway.set(t - 0.3, 'verified · stored', 'success')
      return c.status.agent.set(t, 'got 200', 'success')
    })
    b.step((at) => {
      c.caption.to(tl, 2, at)
      let t = send(c, 'out', at, { label: ENDED })
      c.status.listen.set(t - 0.2, 'forwarding', 'blue')
      const attempt = packet(c.stage, c.parts.edges.local, { label: ENDED })
      t = travel(tl, attempt, t, 'arrive', 1.2)
      bounce(tl, attempt, t)
      c.status.app.set(t, `attempt 1 · ${facts.failStatus}`, 'danger')
      return c.status.gateway.set(t + 0.3, 'attempt 1 failed', 'danger')
    })
    b.step((at) => {
      c.caption.to(tl, 3, at)
      const t = work(c, ['retry'], 'warn', at + 0.1)
      return c.status.gateway.set(t, `retry in ${facts.retryFirstSeconds} s`, 'warn')
    })
    b.step((at) => {
      c.caption.to(tl, 4, at)
      up(tl, c.parts.nodes.app, at)
      c.status.app.set(at, 'recovered', 'success')
      let t = send(c, 'out', at + 0.5, { label: ENDED })
      c.status.listen.set(t, 'connected')
      t = send(c, 'local', t, { label: ENDED })
      accepted(tl, c.parts.nodes.app, t - 0.15)
      toneTo(tl, c.parts.chips.retry, 'success', t)
      c.status.gateway.set(t, 'delivered · attempt 2', 'success')
      return c.status.app.set(t, 'handled · attempt 2', 'success')
    })
  },
}

// ---- The deployed view: Retell <-> Event Gateway <-> your app, no `hookdeck listen` ----

interface DeployedLayout {
  canvas: Canvas
  dir: 'h' | 'v'
  k: number
  agent: { x: number, y: number, w: number, h: number }
  gateway: { x: number, y: number, w: number, h: number }
  app: { x: number, y: number, w: number, h: number }
  status: { agent: Point, gateway: Point, app: Point }
  chips: Point
  edgeLabels: { in: Point, out: Point, start: Point }
  startBulge: number
  caption: { x: number, y: number, max: number, size: number }
  crop: string
}

const DEPLOYED_DESKTOP: DeployedLayout = {
  canvas: { width: 1920, height: 1080 },
  dir: 'h',
  k: 1,
  agent: { x: 250, y: 470, w: 300, h: 150 },
  gateway: { x: 960, y: 470, w: 390, h: 210 },
  app: { x: 1670, y: 470, w: 300, h: 150 },
  status: { agent: { x: 0, y: -118 }, gateway: { x: 0, y: -150 }, app: { x: 0, y: -118 } },
  chips: { x: 960, y: 624 },
  edgeLabels: { in: { x: 605, y: 512 }, out: { x: 1315, y: 512 }, start: { x: 960, y: 717 } },
  startBulge: 230,
  caption: { x: 60, y: 870, max: 78, size: 38 },
  crop: '30 270 1860 520',
}

const DEPLOYED_PHONE: DeployedLayout = {
  canvas: { width: 640, height: 880 },
  dir: 'v',
  k: 0.9,
  agent: { x: 300, y: 90, w: 440, h: 120 },
  gateway: { x: 300, y: 410, w: 460, h: 170 },
  app: { x: 300, y: 745, w: 440, h: 120 },
  status: { agent: { x: 0, y: 100 }, gateway: { x: 0, y: 180 }, app: { x: 0, y: 85 } },
  chips: { x: 300, y: 540 },
  edgeLabels: { in: { x: 300, y: 262 }, out: { x: 300, y: 650 }, start: { x: 596, y: 417 } },
  startBulge: 110,
  caption: { x: 0, y: 0, max: 0, size: 0 },
  crop: '0 0 640 880',
}

function deployedScene(layout: DeployedLayout, name: string) {
  return defineScene(name, (b) => {
    const { stage, tl } = b
    const L = layout
    const nodes = {
      agent: node(stage, { ...L.agent, eyebrow: 'Retell', title: 'Voice agent', icon: 'mic', scale: L.k, status: L.status.agent }),
      gateway: node(stage, { ...L.gateway, eyebrow: 'Hookdeck', title: 'Event Gateway', icon: 'hookdeck', variant: 'work', scale: L.k, status: L.status.gateway }),
      app: node(stage, { ...L.app, eyebrow: 'Deployed', title: 'Your app', icon: 'dns', scale: L.k, status: L.status.app }),
    }
    const ends = L.dir === 'h' ? { from: 'right', to: 'left' } as const : { from: 'bottom', to: 'top' } as const
    const edges = {
      in: connector(stage, nodes.agent[ends.from], nodes.gateway[ends.to], L.dir),
      out: connector(stage, nodes.gateway[ends.from], nodes.app[ends.to], L.dir),
      start: loopConnector(stage, L.dir === 'h' ? nodes.app.bottom : nodes.app.right, L.dir === 'h' ? nodes.agent.bottom : nodes.agent.right, L.dir, L.startBulge),
    }
    const edgeLabels = [
      connectorLabel(stage, { ...L.edgeLabels.in, label: 'POST' }),
      connectorLabel(stage, { ...L.edgeLabels.out, label: 'HTTPS' }),
      connectorLabel(stage, { ...L.edgeLabels.start, label: 'API' }),
    ]
    const chips = chipRow(stage.overlay, { ...L.chips, items: [...CAPABILITIES], size: L.dir === 'h' ? 20 : 17, gap: L.dir === 'h' ? 14 : 8 })

    for (const n of Object.values(nodes))
      gsap.set(n.g, { autoAlpha: 0 })
    for (const e of Object.values(edges))
      drawable(e.path)
    for (const l of edgeLabels)
      gsap.set(l, { autoAlpha: 0 })
    for (const c of Object.values(chips))
      gsap.set(c.g, { autoAlpha: 0 })

    const size = L.dir === 'h' ? 21 : 18
    const status = {} as Record<keyof typeof nodes, { set: (at: number, label: string, tone?: Tone) => number }>
    for (const key of Object.keys(nodes) as (keyof typeof nodes)[]) {
      let current: SVGGElement | null = null
      status[key] = {
        set(at, label, tone = 'neutral') {
          const chip = statusChip(stage, nodes[key], label, tone, size)
          const t = swap(tl, current, chip, at)
          current = chip
          return t
        },
      }
    }
    const caption = captions(stage, [...deployedCaptionsBy], { x: L.caption.x, y: L.caption.y }, b.options.captions && L.dir === 'h', { max: L.caption.max, size: L.caption.size })
    const send = (edge: keyof typeof edges, at: number, label?: string) =>
      travel(tl, packet(stage, edges[edge], { label }), at, 'into', 1.2)
    const work = (ids: string[], at: number) => {
      let t = at
      for (const id of ids) {
        toneTo(tl, chips[id], 'success', t)
        pulse(tl, chips[id].g, t)
        t += 0.4
      }
      return t
    }
    const resetChips = (at: number) => {
      for (const chip of Object.values(chips))
        toneTo(tl, chip, 'neutral', at)
    }
    /** One webhook's whole delivery: in to Event Gateway (verify and store), out to your app over HTTPS. */
    const deliver = (at: number, label: string, lead: string) => {
      let t = send('in', at, label)
      status.agent.set(t - 0.1, 'sent', 'blue')
      t = work(['verify', 'store'], t)
      status.gateway.set(t - 0.3, 'verified · stored', 'success')
      status.agent.set(t, 'got 200', 'success')
      t = send('out', t, label)
      accepted(tl, nodes.app, t - 0.15)
      return status.app.set(t, lead, 'success')
    }

    b.intro(() => {
      ;(['agent', 'gateway', 'app'] as const).forEach((id, i) => show(tl, nodes[id].g, 0.15 + i * 0.18))
      ;(['in', 'out', 'start'] as const).forEach((id, i) => {
        draw(tl, edges[id].path, 0.55 + i * 0.18, 0.5)
        show(tl, edgeLabels[i], 0.95 + i * 0.18)
      })
      return Math.max(show(tl, Object.values(chips).map(c => c.g), 1.0), 1.7)
    })
    b.step((at) => {
      caption.to(tl, 1, at)
      const t = send('start', at)
      status.app.set(at + 0.1, 'Calling', 'blue')
      return status.agent.set(t - 0.1, 'call created', 'blue')
    })
    b.step((at) => {
      caption.to(tl, 2, at)
      return deliver(at, STARTED, 'In call')
    })
    b.step((at) => {
      caption.to(tl, 3, at)
      resetChips(at)
      return deliver(at + 0.2, ENDED, 'Call ended')
    })
    b.step((at) => {
      caption.to(tl, 4, at)
      resetChips(at)
      return deliver(at + 0.2, ANALYZED, 'Analyzed')
    })
  }, { canvas: layout.canvas })
}

export const createDeployedScene = deployedScene(DEPLOYED_DESKTOP, 'retell-deployed')
export const createDeployedMobileScene = deployedScene(DEPLOYED_PHONE, 'retell-deployed-mobile')
export const deployedCaptions = deployedCaptionsBy
export const deployedCrop = DEPLOYED_DESKTOP.crop

// ---- Scene factories ----

function scripted(id: ScenarioId, layout: Layout, name: string) {
  return defineScene(name, (b) => {
    const parts = buildParts(b, layout)
    hideForIntro(parts)
    const c = makeCtx(b, parts, layout, id)
    scenarios[id](b, c)
  }, { canvas: layout.canvas })
}

export const createCallLifecycleScene = scripted('retell-call-lifecycle', DESKTOP, 'retell-call-lifecycle')
export const createCallLifecycleMobileScene = scripted('retell-call-lifecycle', PHONE, 'retell-call-lifecycle-mobile')
export const createDuplicateScene = scripted('retell-duplicate-dropped', DESKTOP, 'retell-duplicate-dropped')
export const createDuplicateMobileScene = scripted('retell-duplicate-dropped', PHONE, 'retell-duplicate-dropped-mobile')
export const createBadSignatureScene = scripted('retell-bad-signature', DESKTOP, 'retell-bad-signature')
export const createBadSignatureMobileScene = scripted('retell-bad-signature', PHONE, 'retell-bad-signature-mobile')
export const createAppDownScene = scripted('retell-app-down', DESKTOP, 'retell-app-down')
export const createAppDownMobileScene = scripted('retell-app-down', PHONE, 'retell-app-down-mobile')

// The captions arrays the website's sync reads (strings only).
export const callLifecycleCaptions = captionsBy['retell-call-lifecycle']
export const duplicateCaptions = captionsBy['retell-duplicate-dropped']
export const badSignatureCaptions = captionsBy['retell-bad-signature']
export const appDownCaptions = captionsBy['retell-app-down']

/** Per-scene crop of the desktop canvas (SVG viewBox), for a page that shows the diagram without the empty slide around it. */
export const desktopCrop = DESKTOP.crop

/**
 * The live scene: the same components, no steps. Everything is on stage from the start, and
 * `scene.live` (a LiveDriver) launches packets and sets badges as the page's feeds report events.
 * Node ids: agent, gateway, listen, app. Edge ids: in, out, local, start. Chip ids: verify, store, dedup, retry.
 */
function live(layout: Layout, name: string) {
  return defineScene(name, (b) => {
    const parts = buildParts(b, layout)
    b.live(createLive({ stage: b.stage, nodes: parts.nodes, edges: parts.edges, chips: parts.chips }))
    for (const l of Object.values(parts.edgeLabels))
      gsap.set(l, { autoAlpha: 1 })
    for (const c of Object.values(parts.chips))
      gsap.set(c.g, { autoAlpha: 1 })
  }, { canvas: layout.canvas })
}

export const createLiveScene = live(DESKTOP, 'live')
export const createLiveMobileScene = live(PHONE, 'live-mobile')
