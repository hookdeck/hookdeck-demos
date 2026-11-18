import { gsap } from 'gsap'
import { accepted, bounce, captions, down, draw, drawable, dropAt, packet, pulse, show, swap, travel, up } from './kit/anim'
import { createLive } from './kit/live'
import { chipRow, connectorLabel, statusChip, type Tone, type ToneChip, toneTo } from './kit/parts'
import { defineScene, type SceneBuild } from './kit/scene'
import { type Canvas, connector, type Connector, node, type Node, type Point, type Stage } from './kit/stage'

// The LiveKit voice-adventure topology, defined once, run three ways:
//
//   live      the demo page's bottom pane: `createLiveScene` builds the components and a live driver
//             (`scene.live`) that the page feeds from the app's delivery log and /api/flow;
//   scripted  four scenes with captions (call lifecycle, duplicate dropped, bad signature, app down
//             then retry), each with a desktop layout (1920x1080) and a portrait layout for phones
//             (640 wide), the same steps and captions. The website embeds them with `steppedDiagram`
//             in its voice-ai set, so the scene names carry a `livekit-` prefix; the capture script
//             renders them to MP4;
//   detail    clicking a node or packet fills the pane's detail strip (host code, not here).
//
// LiveKit sends webhooks to this app: LiveKit Cloud, Event Gateway, `hookdeck listen`, the app. The
// live view adds one outbound edge, `start`: when the game master starts a scene, the app calls
// LiveKit's Ingress API to pull that scene's soundtrack into the room, and the ingress webhooks come
// back through the same path. The scripted scenes show the webhook path only. LiveKit signs each webhook with a JWT in the `Authorization` header
// and the app verifies it with `WebhookReceiver`, so the first chip is `Receive`, not `Verify`: the
// source is a generic webhook source, and the bad-signature scene shows the app doing the check.
// (The chip keeps the id `verify` because the kit's live feed addresses it by that id.)
//
// No host code in this file: it imports gsap and the kit, nothing else.

// ---- Facts the scenes show, with their evidence (handoffs/.../demos/livekit.md; scripts/setup-hookdeck.ts) ----

export const facts = {
  /** Header LiveKit signs each webhook with: a JWT whose `sha256` claim is the hash of the body (LiveKit's webhook docs). */
  signatureHeader: 'Authorization',
  /** Dedup rule in scripts/setup-hookdeck.ts: the same LiveKit event id inside the window. */
  dedupFields: 'body.id',
  dedupWindowMinutes: 10,
  /** Retry rule in scripts/setup-hookdeck.ts: exponential, 8 attempts, first interval 30 s. */
  retryFirstSeconds: 30,
  retryCount: 8,
  /** The app's failure switch answers 503 (src/server.ts). */
  failStatus: 503,
  /** The app answers 401 when WebhookReceiver rejects a delivery (src/server.ts). */
  rejectStatus: 401,
} as const

// One whole sentence per resting state: the opening state, then each step. Terms in backticks
// render as code on the website.
export const captionsBy = {
  'livekit-call-lifecycle': [
    'LiveKit sends a webhook for each room and participant event, and Event Gateway delivers each one to the call log.',
    'A room opens. LiveKit sends `room_started` to Event Gateway, which delivers it through `hookdeck listen` to the app. The call is in progress.',
    'A participant joins. `participant_joined` arrives the same way, and the app adds the participant to the call.',
    'The participant leaves. `participant_left` is delivered, and the app marks them as left.',
    'The room closes. `room_finished` is delivered, and the call log shows the call as ended, with its start, end and duration.',
  ],
  'livekit-duplicate-dropped': [
    'The app has handled this room\'s `room_finished`: the call is ended.',
    'LiveKit sends the same `room_finished` again, because senders can deliver an event more than once.',
    `Event Gateway sees the same \`${facts.dedupFields}\` inside the ${facts.dedupWindowMinutes} minute window and drops it. LiveKit still gets a 200.`,
    'Nothing is forwarded: the app is not called a second time and the call log stays as it was.',
  ],
  'livekit-bad-signature': [
    'A request claims to come from LiveKit, but its token was signed with the wrong key.',
    'Event Gateway receives and stores the request, answers LiveKit with a 200, and delivers it through `hookdeck listen` to the app.',
    `The app checks the \`${facts.signatureHeader}\` token and the body hash with \`WebhookReceiver\` from \`livekit-server-sdk\`. The check fails.`,
    `The app answers ${facts.rejectStatus} and leaves the call log alone. Event Gateway records the failed attempt.`,
  ],
  'livekit-app-down': [
    `The app is down: it answers every delivery with a ${facts.failStatus}.`,
    'The room closes and LiveKit sends `room_finished`. Event Gateway stores it and answers LiveKit with a 200.',
    `Event Gateway delivers it through \`hookdeck listen\`. Attempt 1 gets a ${facts.failStatus} from the app.`,
    `Event Gateway keeps the event and retries with exponential backoff: the first retry is ${facts.retryFirstSeconds} seconds after the failed attempt, then it waits longer each time, up to ${facts.retryCount} retries.`,
    `The app recovers. Attempt 2 succeeds about ${facts.retryFirstSeconds} seconds later, and the event is delivered once.`,
  ],
} as const

// The opening diagram of a tutorial: the flow as it runs once your app is deployed. No
// `hookdeck listen`: Event Gateway delivers to your app's HTTPS endpoint. Not a tab in the demo
// page, which shows what the demo runs.
export const deployedCaptionsBy = [
  'LiveKit sends a webhook for each room and participant event, and Event Gateway delivers each one to your app over HTTPS.',
  'A room opens. LiveKit sends `room_started` to Event Gateway, which delivers it to your app over HTTPS and signs the delivery. Your app verifies the Hookdeck signature, and the call is in progress.',
  'A participant joins. `participant_joined` arrives the same way, and your app adds the participant to the call.',
  'The participant leaves. `participant_left` is delivered, and your app marks them as left.',
  'The room closes. `room_finished` is delivered, and the call log shows the call as ended, with its start, end and duration.',
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
  /** How far the app-to-LiveKit connector bulges out of the row (down on desktop, right on phones). Live view only. */
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
    agent: { x: 0, y: 118 },
    gateway: { x: 0, y: -150 },
    listen: { x: 0, y: 118 },
    app: { x: 0, y: 118 },
  },
  chips: { x: 690, y: 624 },
  edgeLabels: { in: { x: 425, y: 512 }, out: { x: 957, y: 512 }, local: { x: 1475, y: 512 }, start: { x: 960, y: 717 } },
  startBulge: 230,
  caption: { x: 60, y: 870, max: 78, size: 38 },
  crop: '30 270 1860 420',
}

const PHONE: Layout = {
  canvas: { width: 640, height: 1090 },
  dir: 'v',
  k: 0.9,
  agent: { x: 320, y: 90, w: 440, h: 120 },
  gateway: { x: 320, y: 410, w: 500, h: 170 },
  listen: { x: 320, y: 745, w: 440, h: 120 },
  app: { x: 320, y: 975, w: 440, h: 120 },
  status: {
    agent: { x: 0, y: 100 },
    gateway: { x: 0, y: 180 },
    listen: { x: 0, y: 85 },
    app: { x: 0, y: 85 },
  },
  chips: { x: 320, y: 540 },
  edgeLabels: { in: { x: 320, y: 262 }, out: { x: 320, y: 650 }, local: { x: 320, y: 888 }, start: { x: 596, y: 532 } },
  startBulge: 110,
  caption: { x: 0, y: 0, max: 0, size: 0 },
  crop: '0 0 640 1090',
}

/** The live view's layouts: room for the outbound `start` edge, so LiveKit's status chip sits above its node. */
const LIVE_DESKTOP: Layout = {
  ...DESKTOP,
  status: { agent: { x: 0, y: -118 }, gateway: { x: 0, y: -150 }, listen: { x: 0, y: 118 }, app: { x: 0, y: -118 } },
  crop: '30 270 1860 520',
}
const LIVE_PHONE: Layout = {
  ...PHONE,
  agent: { x: 300, y: 90, w: 440, h: 120 },
  gateway: { x: 300, y: 410, w: 460, h: 170 },
  listen: { x: 300, y: 745, w: 440, h: 120 },
  app: { x: 300, y: 975, w: 440, h: 120 },
  edgeLabels: { in: { x: 300, y: 262 }, out: { x: 300, y: 650 }, local: { x: 300, y: 888 }, start: { x: 596, y: 532 } },
}

// ---- Components ----

const CAPABILITIES = [
  { id: 'verify', label: 'Receive' },
  { id: 'store', label: 'Store' },
  { id: 'dedup', label: 'Dedup' },
  { id: 'retry', label: 'Retry' },
] as const

type NodeId = 'agent' | 'gateway' | 'listen' | 'app'
type EdgeId = 'in' | 'out' | 'local' | 'start'

interface Parts {
  nodes: Record<NodeId, Node>
  /** `start` exists only in the live view. */
  edges: Partial<Record<EdgeId, Connector>> & Record<'in' | 'out' | 'local', Connector>
  edgeLabels: Partial<Record<EdgeId, SVGGElement>> & Record<'in' | 'out' | 'local', SVGGElement>
  chips: Record<string, ToneChip>
}

/**
 * The connector from the app back to LiveKit: it leaves the app, loops around the row (under it on
 * desktop, to its right on phones) and arrives at LiveKit. `connector()` styles the path; the loop
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
 * app" there, because the reader runs their own. The demo page leaves it off and keeps "Call log".
 */
function buildParts(build: Pick<SceneBuild, 'stage' | 'options'>, layout: Layout, with_start = false): Parts {
  const { stage } = build
  const L = layout
  const nodes: Record<NodeId, Node> = {
    agent: node(stage, { ...L.agent, eyebrow: 'LiveKit Cloud', title: 'Rooms', icon: 'record_voice_over', scale: L.k, status: L.status.agent }),
    gateway: node(stage, { ...L.gateway, eyebrow: 'Hookdeck', title: 'Event Gateway', icon: 'hookdeck', variant: 'work', scale: L.k, status: L.status.gateway }),
    listen: node(stage, { ...L.listen, eyebrow: 'Hookdeck CLI', title: 'hookdeck listen', icon: 'terminal', scale: L.k, status: L.status.listen }),
    app: node(stage, { ...L.app, eyebrow: 'Localhost', title: build.options.flags?.tutorial ? 'Your app' : 'Call log', icon: 'dns', scale: L.k, status: L.status.app }),
  }
  const ends = L.dir === 'h'
    ? { from: ['right', 'right', 'right'], to: ['left', 'left', 'left'] } as const
    : { from: ['bottom', 'bottom', 'bottom'], to: ['top', 'top', 'top'] } as const
  const edges: Parts['edges'] = {
    in: connector(stage, nodes.agent[ends.from[0]], nodes.gateway[ends.to[0]], L.dir),
    out: connector(stage, nodes.gateway[ends.from[1]], nodes.listen[ends.to[1]], L.dir),
    local: connector(stage, nodes.listen[ends.from[2]], nodes.app[ends.to[2]], L.dir),
  }
  const edgeLabels: Parts['edgeLabels'] = {
    in: connectorLabel(stage, { ...L.edgeLabels.in, label: 'POST' }),
    out: connectorLabel(stage, { ...L.edgeLabels.out, label: 'WSS' }),
    local: connectorLabel(stage, { ...L.edgeLabels.local, label: 'HTTP' }),
  }
  if (with_start) {
    edges.start = loopConnector(stage, L.dir === 'h' ? nodes.app.bottom : nodes.app.right, L.dir === 'h' ? nodes.agent.bottom : nodes.agent.right, L.dir, L.startBulge)
    edgeLabels.start = connectorLabel(stage, { ...L.edgeLabels.start, label: 'INGRESS' })
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
  ;(['in', 'out', 'local'] as const).forEach((id, i) => {
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
function send(c: Ctx, edge: 'in' | 'out' | 'local', at: number, o: { label?: string, big?: boolean, end?: 'into' | 'arrive' }): number {
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

/** One webhook's whole delivery: in to Event Gateway (receive and store), out to the CLI, local to the app. Returns the time the app has it. */
function deliver(c: Ctx, at: number, label: string, app: { text: string, tone?: Tone }): number {
  let t = send(c, 'in', at, { label })
  c.status.agent.set(t - 0.1, 'sent', 'blue')
  t = work(c, ['verify', 'store'], 'success', t)
  c.status.gateway.set(t - 0.3, 'stored', 'success')
  c.status.agent.set(t, 'got 200', 'success')
  t = send(c, 'out', t, { label })
  c.status.listen.set(t - 0.2, 'forwarding', 'blue')
  t = send(c, 'local', t, { label })
  accepted(c.tl, c.parts.nodes.app, t - 0.15)
  c.status.listen.set(t, 'connected')
  return c.status.app.set(t, app.text, app.tone ?? 'success')
}

// Packet labels are the event names.
const STARTED = 'room_started'
const JOINED = 'participant_joined'
const LEFT = 'participant_left'
const FINISHED = 'room_finished'

// ---- The scenarios ----

const scenarios: Record<ScenarioId, (b: SceneBuild, c: Ctx) => void> = {
  'livekit-call-lifecycle': (b, c) => {
    const { tl } = c
    b.intro(() => introAnimation(tl, c.parts))
    b.step((at) => {
      c.caption.to(tl, 1, at)
      return deliver(c, at, STARTED, { text: 'In progress' })
    })
    b.step((at) => {
      c.caption.to(tl, 2, at)
      resetChips(c, at)
      return deliver(c, at, JOINED, { text: '1 in room' })
    })
    b.step((at) => {
      c.caption.to(tl, 3, at)
      resetChips(c, at)
      return deliver(c, at, LEFT, { text: '0 in room' })
    })
    b.step((at) => {
      c.caption.to(tl, 4, at)
      resetChips(c, at)
      return deliver(c, at, FINISHED, { text: 'Call ended' })
    })
  },

  'livekit-duplicate-dropped': (b, c) => {
    const { tl } = c
    let again: ReturnType<typeof packet>
    b.intro(() => {
      const t = introAnimation(tl, c.parts)
      accepted(tl, c.parts.nodes.app, t - 0.2)
      c.status.app.set(t - 0.1, 'Call ended', 'success')
      return c.status.gateway.set(t, 'stored', 'success')
    })
    b.step((at) => {
      c.caption.to(tl, 1, at)
      // The repeat stops at Event Gateway and stays there until step 2.
      again = packet(c.stage, c.parts.edges.in, { label: FINISHED })
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

  'livekit-bad-signature': (b, c) => {
    const { tl } = c
    let forged: ReturnType<typeof packet>
    b.intro(() => introAnimation(tl, c.parts))
    b.step((at) => {
      c.caption.to(tl, 1, at)
      forged = packet(c.stage, c.parts.edges.in, { label: 'bad token' })
      const t = travel(tl, forged, at, 'into', 1.2)
      c.status.agent.set(t - 0.1, 'sent', 'blue')
      const stored = work(c, ['verify', 'store'], 'success', t)
      c.status.gateway.set(stored - 0.3, 'stored', 'success')
      c.status.agent.set(stored, 'got 200', 'success')
      // The same request travels on to the app.
      let u = send(c, 'out', stored, { label: 'bad token' })
      c.status.listen.set(u - 0.2, 'forwarding', 'blue')
      forged = packet(c.stage, c.parts.edges.local, { label: 'bad token' })
      u = travel(tl, forged, u, 'arrive', 1.2)
      return c.status.listen.set(u, 'connected')
    })
    b.step((at) => {
      c.caption.to(tl, 2, at)
      return c.status.app.set(at + 0.2, 'checking token', 'blue')
    })
    b.step((at) => {
      c.caption.to(tl, 3, at)
      down(tl, c.parts.nodes.app, at + 0.1)
      bounce(tl, forged, at + 0.1)
      c.status.app.set(at + 0.2, `rejected · ${facts.rejectStatus}`, 'danger')
      return c.status.gateway.set(at + 0.6, 'attempt 1 failed', 'danger')
    })
  },

  'livekit-app-down': (b, c) => {
    const { tl } = c
    b.intro(() => {
      const t = introAnimation(tl, c.parts)
      down(tl, c.parts.nodes.app, t - 0.2)
      return c.status.app.set(t, `answering ${facts.failStatus}`, 'danger')
    })
    b.step((at) => {
      c.caption.to(tl, 1, at)
      let t = send(c, 'in', at, { label: FINISHED })
      c.status.agent.set(t - 0.1, 'sent', 'blue')
      t = work(c, ['verify', 'store'], 'success', t)
      c.status.gateway.set(t - 0.3, 'stored', 'success')
      return c.status.agent.set(t, 'got 200', 'success')
    })
    b.step((at) => {
      c.caption.to(tl, 2, at)
      let t = send(c, 'out', at, { label: FINISHED })
      c.status.listen.set(t - 0.2, 'forwarding', 'blue')
      const attempt = packet(c.stage, c.parts.edges.local, { label: FINISHED })
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
      let t = send(c, 'out', at + 0.5, { label: FINISHED })
      c.status.listen.set(t, 'connected')
      t = send(c, 'local', t, { label: FINISHED })
      accepted(tl, c.parts.nodes.app, t - 0.15)
      toneTo(tl, c.parts.chips.retry, 'success', t)
      c.status.gateway.set(t, 'delivered · attempt 2', 'success')
      return c.status.app.set(t, 'handled · attempt 2', 'success')
    })
  },
}

// ---- The deployed view: LiveKit -> Event Gateway -> your app, no `hookdeck listen` ----

interface DeployedLayout {
  canvas: Canvas
  dir: 'h' | 'v'
  k: number
  agent: { x: number, y: number, w: number, h: number }
  gateway: { x: number, y: number, w: number, h: number }
  app: { x: number, y: number, w: number, h: number }
  status: { agent: Point, gateway: Point, app: Point }
  chips: Point
  edgeLabels: { in: Point, out: Point }
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
  status: { agent: { x: 0, y: 118 }, gateway: { x: 0, y: -150 }, app: { x: 0, y: 118 } },
  chips: { x: 960, y: 624 },
  edgeLabels: { in: { x: 605, y: 512 }, out: { x: 1315, y: 512 } },
  caption: { x: 60, y: 870, max: 78, size: 38 },
  crop: '30 270 1860 420',
}

const DEPLOYED_PHONE: DeployedLayout = {
  canvas: { width: 640, height: 880 },
  dir: 'v',
  k: 0.9,
  agent: { x: 320, y: 90, w: 440, h: 120 },
  gateway: { x: 320, y: 410, w: 500, h: 170 },
  app: { x: 320, y: 745, w: 440, h: 120 },
  status: { agent: { x: 0, y: 100 }, gateway: { x: 0, y: 180 }, app: { x: 0, y: 85 } },
  chips: { x: 320, y: 540 },
  edgeLabels: { in: { x: 320, y: 262 }, out: { x: 320, y: 650 } },
  caption: { x: 0, y: 0, max: 0, size: 0 },
  crop: '0 0 640 880',
}

function deployedScene(layout: DeployedLayout, name: string) {
  return defineScene(name, (b) => {
    const { stage, tl } = b
    const L = layout
    const nodes = {
      agent: node(stage, { ...L.agent, eyebrow: 'LiveKit Cloud', title: 'Rooms', icon: 'record_voice_over', scale: L.k, status: L.status.agent }),
      gateway: node(stage, { ...L.gateway, eyebrow: 'Hookdeck', title: 'Event Gateway', icon: 'hookdeck', variant: 'work', scale: L.k, status: L.status.gateway }),
      app: node(stage, { ...L.app, eyebrow: 'Deployed', title: 'Your app', icon: 'dns', scale: L.k, status: L.status.app }),
    }
    const ends = L.dir === 'h' ? { from: 'right', to: 'left' } as const : { from: 'bottom', to: 'top' } as const
    const edges = {
      in: connector(stage, nodes.agent[ends.from], nodes.gateway[ends.to], L.dir),
      out: connector(stage, nodes.gateway[ends.from], nodes.app[ends.to], L.dir),
    }
    const edgeLabels = [
      connectorLabel(stage, { ...L.edgeLabels.in, label: 'POST' }),
      connectorLabel(stage, { ...L.edgeLabels.out, label: 'HTTPS' }),
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
    const send = (edge: keyof typeof edges, at: number, label: string) =>
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
    /** One webhook's whole delivery: in to Event Gateway (receive and store), out to your app over HTTPS. */
    const deliver = (at: number, label: string, lead: string) => {
      let t = send('in', at, label)
      status.agent.set(t - 0.1, 'sent', 'blue')
      t = work(['verify', 'store'], t)
      status.gateway.set(t - 0.3, 'stored', 'success')
      status.agent.set(t, 'got 200', 'success')
      t = send('out', t, label)
      accepted(tl, nodes.app, t - 0.15)
      return status.app.set(t, lead, 'success')
    }

    b.intro(() => {
      ;(['agent', 'gateway', 'app'] as const).forEach((id, i) => show(tl, nodes[id].g, 0.15 + i * 0.18))
      ;(['in', 'out'] as const).forEach((id, i) => {
        draw(tl, edges[id].path, 0.55 + i * 0.18, 0.5)
        show(tl, edgeLabels[i], 0.95 + i * 0.18)
      })
      return Math.max(show(tl, Object.values(chips).map(c => c.g), 1.0), 1.7)
    })
    b.step((at) => {
      caption.to(tl, 1, at)
      return deliver(at, STARTED, 'In progress')
    })
    b.step((at) => {
      caption.to(tl, 2, at)
      resetChips(at)
      return deliver(at, JOINED, '1 in room')
    })
    b.step((at) => {
      caption.to(tl, 3, at)
      resetChips(at)
      return deliver(at, LEFT, '0 in room')
    })
    b.step((at) => {
      caption.to(tl, 4, at)
      resetChips(at)
      return deliver(at, FINISHED, 'Call ended')
    })
  }, { canvas: layout.canvas })
}

export const createDeployedScene = deployedScene(DEPLOYED_DESKTOP, 'livekit-deployed')
export const createDeployedMobileScene = deployedScene(DEPLOYED_PHONE, 'livekit-deployed-mobile')
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

export const createCallLifecycleScene = scripted('livekit-call-lifecycle', DESKTOP, 'livekit-call-lifecycle')
export const createCallLifecycleMobileScene = scripted('livekit-call-lifecycle', PHONE, 'livekit-call-lifecycle-mobile')
export const createDuplicateScene = scripted('livekit-duplicate-dropped', DESKTOP, 'livekit-duplicate-dropped')
export const createDuplicateMobileScene = scripted('livekit-duplicate-dropped', PHONE, 'livekit-duplicate-dropped-mobile')
export const createBadSignatureScene = scripted('livekit-bad-signature', DESKTOP, 'livekit-bad-signature')
export const createBadSignatureMobileScene = scripted('livekit-bad-signature', PHONE, 'livekit-bad-signature-mobile')
export const createAppDownScene = scripted('livekit-app-down', DESKTOP, 'livekit-app-down')
export const createAppDownMobileScene = scripted('livekit-app-down', PHONE, 'livekit-app-down-mobile')

// The captions arrays the website's sync reads (strings only).
export const callLifecycleCaptions = captionsBy['livekit-call-lifecycle']
export const duplicateCaptions = captionsBy['livekit-duplicate-dropped']
export const badSignatureCaptions = captionsBy['livekit-bad-signature']
export const appDownCaptions = captionsBy['livekit-app-down']

/** Per-scene crop of the desktop canvas (SVG viewBox), for a page that shows the diagram without the empty slide around it. */
export const desktopCrop = LIVE_DESKTOP.crop

/**
 * The live scene: the same components, no steps. Everything is on stage from the start, and
 * `scene.live` (a LiveDriver) launches packets and sets badges as the page's feeds report events.
 * Node ids: agent, gateway, listen, app. Edge ids: in, out, local, start (app to LiveKit's Ingress API). Chip ids: verify (labelled Receive), store, dedup, retry.
 */
function live(layout: Layout, name: string) {
  return defineScene(name, (b) => {
    const parts = buildParts(b, layout, true)
    b.live(createLive({ stage: b.stage, nodes: parts.nodes, edges: parts.edges as Record<string, Connector>, chips: parts.chips }))
    for (const l of Object.values(parts.edgeLabels))
      gsap.set(l, { autoAlpha: 1 })
    for (const c of Object.values(parts.chips))
      gsap.set(c.g, { autoAlpha: 1 })
  }, { canvas: layout.canvas })
}

export const createLiveScene = live(LIVE_DESKTOP, 'live')
export const createLiveMobileScene = live(LIVE_PHONE, 'live-mobile')
